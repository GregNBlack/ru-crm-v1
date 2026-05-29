import {
  convertToModelMessages,
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  tool,
  UIMessage,
} from "ai"
import { google } from "@ai-sdk/google"
import { z } from "zod"
import { pipeJsonRender } from "@json-render/core"
import { catalog } from "@/lib/catalog"
import { getServerSession } from "@/lib/get-session"
import {
  getSourceItemMarkdown,
  listSourceItems,
  type SourceItemRow,
} from "@/server/source-items"
import {
  listClientContent,
  listContactContent,
  listDealContent,
} from "@/server/client-content"
import { listClients } from "@/server/clients"
import { listContacts } from "@/server/contacts"
import { listDeals } from "@/server/deals"
import { getGatewayId, getModel } from "@/lib/llm-models"

export const maxDuration = 120

const SYSTEM_PROMPT = `You are a helpful AI assistant for the Truffalo platform. You provide clear, accurate, and concise answers. You can help with general questions, analysis, writing, coding, and more.

${catalog.prompt({ mode: "inline" })}

## Additional display guidelines

- For small results (key-value pairs, 1-3 metrics, tiny tables <5 rows), render inline.
- For charts, large tables (>8 rows), complex JSON, or code files (>30 lines), use displayMode "panel".
- Always explain what the data shows in conversational text, then render the visualization.
- When producing charts, provide real/computed data — never use placeholder values.

## Internal sources tools (when enabled)

When the source tools are available, the user has opted in to searching their stored, parsed sources (emails, chats, drive files, dropped files) and CRM entities (clients, contacts, deals). Two retrieval paths:

### Path A — entity-scoped (preferred when the question names a company, person, or deal)

Use this for questions like "give me a summary about company X", "what's going on with <person>", or "status of the <deal> deal". This grounds the answer in the entity's *curated* relevant content rather than a blind keyword scan. It is a **two-step, user-driven** flow:

**Step 1 — resolve + present candidates (then STOP).**
1. Pick the entity type and call the matching find tool: a company → \`findClients\`; a person → \`findContacts\`; a deal/opportunity → \`findDeals\`. If you can't tell the type, try the most likely one, then fall back to Path B.
2. If the find tool returns **zero** matches, say so plainly (don't invent) and stop. Otherwise write ONE short line inviting the user to pick (e.g. "I found these — click one to get a summary from its sources."). **Do NOT call \`getClientContent\` / \`getContactContent\` / \`getDealContent\` yet, and do NOT call \`getSourceItemContent\` yet.** The candidates render as clickable cards; the user picks one. This applies even when there is exactly one match — present it and wait.

**Step 2 — summarize the picked entity (triggered by the user's follow-up message).**
When the user replies asking to summarize a specific entity (typically "Summarize the client/contact/deal \"<name>\" …" sent by clicking a candidate card):
3. Find that entity's id in your **previous find-tool result** (the candidate list you just produced) — match on the name they gave. Do not re-run the find tool, and do not ask again. If you genuinely cannot find it in the prior result, then re-run the matching find tool and pick the exact-name match.
4. Call \`getClientContent\` / \`getContactContent\` / \`getDealContent\` with that id. It returns brief hits (id, source, subject/filename, summary, date) plus the \`matchTerms\` used. If it returns zero hits, tell the user there's no source content for that entity yet.
5. Call \`getSourceItemContent\` for the most relevant 1–3 hit ids to read full parsed markdown, then write a faithful summary grounded in that content.

### Path B — free-text fallback

When the question isn't about a specific named entity (or no entity resolved), use \`searchSourceItems\` with a free-text query, then \`getSourceItemContent\` on the best 1–3 ids.

### Rules for both paths

- Quote sparingly; prefer short, faithful summaries. If a content tool returns zero hits, tell the user plainly. Do not invent content.
- The user sees matched sources rendered as cards directly in the chat with their own preview buttons. **Do not** emit json-render specs to display source bodies; just write your prose answer.
- Never expose source/entity ids in the user-facing answer — they are internal.`

// Model dictionary lives in src/lib/llm-models.ts so the chat picker, the
// Explore-sources dialog, and this route share one source of truth.
// All requests route through Vercel AI Gateway (auth via AI_GATEWAY_API_KEY).
// Plain "provider/model" strings passed to streamText() are auto-routed by AI SDK v6.

// Builds the source-search tool set. All three execute server-side and
// are scoped to the caller's active organization — listing only that
// org's items, and refusing to read markdown from rows owned by a
// different org. The chat route is technically public, so the tools
// are only registered when an authenticated session AND an active org
// are both present (enforced by the caller).
// Maps a relevance-matched source_item row to the compact hit shape the
// model reasons over (same shape `searchSourceItems` returns). The model
// reads full bodies via `getSourceItemContent` on a hit's `id`.
function toSourceHit(row: SourceItemRow) {
  const md = (row.metadataJson ?? {}) as Record<string, unknown>
  return {
    id: row.id,
    sourceName: row.sourceName,
    sourceProvider: row.sourceProvider,
    filename: row.filename,
    subject: typeof md.subject === "string" ? md.subject : null,
    snippet: typeof md.snippet === "string" ? md.snippet : null,
    summary: typeof md.summary === "string" ? md.summary : null,
    sourceCreatedAt: row.sourceCreatedAt,
  }
}

function buildSourceTools(organizationId: string | null) {
  if (!organizationId) return undefined
  return {
    // ── Entity resolution (find by name) ──────────────────────────────
    // These three resolve a name the user mentioned into concrete CRM
    // entities. The model picks the right one from the question, calls it,
    // and — when more than one row comes back — asks the user to choose
    // before drilling into content.
    findClients: tool({
      description:
        "Find client companies in the user's CRM by name. Use this FIRST when the user asks about a company (e.g. 'summarize company X'). Returns candidate clients with id, name, funnel phase and website. If more than one matches, ask the user which one before continuing. Then pass the chosen id to getClientContent.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe("Company name (or fragment) to search for."),
        limit: z.number().int().min(1).max(20).default(8),
      }),
      execute: async ({ query, limit }) => {
        const q = query.trim().toLowerCase()
        const rows = await listClients()
        const matches = rows
          .filter((c) => c.name.toLowerCase().includes(q))
          .slice(0, limit)
          .map((c) => ({
            id: c.id,
            name: c.name,
            funnelPhase: c.funnelPhase,
            webUrl: c.webUrl,
            status: c.status,
            email: c.email,
          }))
        return { totalMatched: matches.length, matches }
      },
    }),
    findContacts: tool({
      description:
        "Find people (contacts) in the user's CRM by name. Use this FIRST when the user asks about a person. Matches the contact's technical name and native-language name. Returns candidate contacts with id, name, email and the client they belong to. If more than one matches, ask the user which one. Then pass the chosen id to getContactContent.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe("Person name (or fragment) to search for."),
        limit: z.number().int().min(1).max(20).default(8),
      }),
      execute: async ({ query, limit }) => {
        const q = query.trim().toLowerCase()
        const rows = await listContacts()
        const matches = rows
          .filter(
            (c) =>
              c.name.toLowerCase().includes(q) ||
              (c.nameNative?.toLowerCase().includes(q) ?? false),
          )
          .slice(0, limit)
          .map((c) => ({
            id: c.id,
            name: c.name,
            nameNative: c.nameNative,
            email: c.email,
            clientName: c.clientName,
            status: c.status,
          }))
        return { totalMatched: matches.length, matches }
      },
    }),
    findDeals: tool({
      description:
        "Find sales deals in the user's CRM by name. Use this FIRST when the user asks about a deal or opportunity. Returns candidate deals with id, name, funnel stage, client and value. If more than one matches, ask the user which one. Then pass the chosen id to getDealContent.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe("Deal name (or fragment) to search for."),
        limit: z.number().int().min(1).max(20).default(8),
      }),
      execute: async ({ query, limit }) => {
        const q = query.trim().toLowerCase()
        const rows = await listDeals({ includeCancelled: true })
        const matches = rows
          .filter((d) => d.name.toLowerCase().includes(q))
          .slice(0, limit)
          .map((d) => ({
            id: d.id,
            name: d.name,
            funnelStageName: d.funnelStageName,
            clientName: d.clientName,
            value: d.value,
            currency: d.currency,
            status: d.status,
          }))
        return { totalMatched: matches.length, matches }
      },
    }),
    // ── Entity-scoped content (relevant source items) ─────────────────
    // Given a resolved entity id, surface the source items whose metadata
    // matches the entity's identifying signals. Returns brief hits — read
    // the bodies with getSourceItemContent before summarizing.
    getClientContent: tool({
      description:
        "List the source items (emails, chats, files) relevant to one client, matched against the client's name, website, address and its contacts. Pass a clientId from findClients. Returns brief hits — call getSourceItemContent on the most relevant ids to read full content for your summary.",
      inputSchema: z.object({
        clientId: z.string().describe("Client id from findClients."),
        limit: z.number().int().min(1).max(20).default(8),
        dateFrom: z.iso.datetime().optional(),
        dateTo: z.iso.datetime().optional(),
      }),
      execute: async ({ clientId, limit, dateFrom, dateTo }) => {
        try {
          const r = await listClientContent({
            organizationId,
            clientId,
            limit,
            dateFrom: dateFrom ? new Date(dateFrom) : undefined,
            dateTo: dateTo ? new Date(dateTo) : undefined,
          })
          return {
            totalMatched: r.total,
            matchTerms: r.matchTerms,
            hits: r.rows.map(toSourceHit),
          }
        } catch {
          return { totalMatched: 0, matchTerms: [], hits: [] }
        }
      },
    }),
    getContactContent: tool({
      description:
        "List the source items relevant to one contact (person), matched against their name, native name, email and phone. Pass a contactId from findContacts. Returns brief hits — call getSourceItemContent on the most relevant ids to read full content.",
      inputSchema: z.object({
        contactId: z.string().describe("Contact id from findContacts."),
        limit: z.number().int().min(1).max(20).default(8),
        dateFrom: z.iso.datetime().optional(),
        dateTo: z.iso.datetime().optional(),
      }),
      execute: async ({ contactId, limit, dateFrom, dateTo }) => {
        try {
          const r = await listContactContent({
            organizationId,
            contactId,
            limit,
            dateFrom: dateFrom ? new Date(dateFrom) : undefined,
            dateTo: dateTo ? new Date(dateTo) : undefined,
          })
          return {
            totalMatched: r.total,
            matchTerms: r.matchTerms,
            hits: r.rows.map(toSourceHit),
          }
        } catch {
          return { totalMatched: 0, matchTerms: [], hits: [] }
        }
      },
    }),
    getDealContent: tool({
      description:
        "List the source items relevant to one deal — its parent client's signals broadened with the deal name and its linked contacts. Pass a dealId from findDeals. Returns brief hits — call getSourceItemContent on the most relevant ids to read full content.",
      inputSchema: z.object({
        dealId: z.string().describe("Deal id from findDeals."),
        limit: z.number().int().min(1).max(20).default(8),
        dateFrom: z.iso.datetime().optional(),
        dateTo: z.iso.datetime().optional(),
      }),
      execute: async ({ dealId, limit, dateFrom, dateTo }) => {
        try {
          const r = await listDealContent({
            organizationId,
            dealId,
            limit,
            dateFrom: dateFrom ? new Date(dateFrom) : undefined,
            dateTo: dateTo ? new Date(dateTo) : undefined,
          })
          return {
            totalMatched: r.total,
            matchTerms: r.matchTerms,
            hits: r.rows.map(toSourceHit),
          }
        } catch {
          return { totalMatched: 0, matchTerms: [], hits: [] }
        }
      },
    }),
    searchSourceItems: tool({
      description:
        "Search the user's parsed sources (emails, chats, drive files, dropped files) belonging to their organization, by free-text query. Matches against filename and the source's metadata JSON (subjects, snippets, authors). Returns brief hits — call getSourceItemContent on a result's `id` to read the full body.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe("Free-text search query (matched ILIKE on filename + metadata)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(8)
          .describe("Max number of hits to return (1-20)."),
        dateFrom: z
          .iso
          .datetime()
          .optional()
          .describe("Inclusive lower bound on sourceCreatedAt (ISO 8601)."),
        dateTo: z
          .iso
          .datetime()
          .optional()
          .describe("Inclusive upper bound on sourceCreatedAt (ISO 8601)."),
      }),
      execute: async ({ query, limit, dateFrom, dateTo }) => {
        const r = await listSourceItems({
          status: "processed",
          organizationId,
          q: query,
          limit,
          dateFrom: dateFrom ? new Date(dateFrom) : undefined,
          dateTo: dateTo ? new Date(dateTo) : undefined,
        })
        return {
          totalMatched: r.total,
          hits: r.rows.map((row) => {
            const md = (row.metadataJson ?? {}) as Record<string, unknown>
            const subject =
              typeof md.subject === "string" ? md.subject : null
            const snippet =
              typeof md.snippet === "string" ? md.snippet : null
            return {
              id: row.id,
              sourceName: row.sourceName,
              sourceProvider: row.sourceProvider,
              filename: row.filename,
              subject,
              snippet,
              sourceCreatedAt: row.sourceCreatedAt,
            }
          }),
        }
      },
    }),
    getSourceItemContent: tool({
      description:
        "Fetch the full parsed markdown for one source item by its id (returned by searchSourceItems). Use this to read content for reasoning so you can ground your prose answer in the real source. The user sees the matched items as cards in the chat with their own preview buttons — you do not need to display the body yourself.",
      inputSchema: z.object({
        sourceItemId: z.string().describe("The source item id."),
      }),
      execute: async ({ sourceItemId }) => {
        const markdown = await getSourceItemMarkdown(sourceItemId, {
          requireOrganizationId: organizationId,
        })
        if (markdown === null) {
          return { ok: false as const, error: "Not parsed or not found." }
        }
        return { ok: true as const, sourceItemId, markdown }
      },
    }),
  } as const
}

export async function POST(req: Request) {
  try {
    const {
      messages,
      model: modelKey = "gpt-5-mini",
      enableSearch = false,
      enableSources = false,
    }: {
      messages: UIMessage[]
      model?: string
      enableSearch?: boolean
      enableSources?: boolean
    } = await req.json()

    // Mutually exclusive on Gemini: the built-in google_search tool is
    // known not to mix with custom function tools in the same call. The
    // client UI also enforces this, but guard server-side too in case
    // the request body comes from elsewhere (or stale state).
    const provider = getModel(modelKey)?.provider
    const sourcesActive = enableSources
    const searchActive = enableSearch && !sourcesActive

    console.log(
      "[chat] model:",
      modelKey,
      "search:",
      searchActive,
      "sources:",
      sourcesActive,
    )

    const gatewayId = getGatewayId(modelKey)

    // Source tools require an authenticated session AND an active
    // organization — items are tenant-scoped, so without an active org
    // there's nothing to search. Anonymous or org-less callers don't
    // see the tools even if enableSources=true is forged.
    const session = sourcesActive ? await getServerSession() : null
    const sourceOrgId =
      sourcesActive && session ? session.session.activeOrganizationId : null
    const sourceTools = buildSourceTools(sourceOrgId)

    // google_search is Gemini-only (it's Google's own grounding tool, not
    // a user-defined function). Custom source tools are provider-agnostic —
    // OpenAI, Google, and Anthropic all support tool calling natively, and
    // the AI SDK + Vercel AI Gateway translate the Zod-schema tool defs to
    // each provider's wire format.
    const builtinSearchTool =
      searchActive && provider === "google"
        ? { google_search: google.tools.googleSearch({}) }
        : undefined

    const tools = {
      ...(builtinSearchTool ?? {}),
      ...(sourceTools ?? {}),
    }
    const hasTools = Object.keys(tools).length > 0

    console.log(
      "[chat] gateway:",
      gatewayId,
      "provider:",
      provider,
      "tools:",
      Object.keys(tools),
    )

    const result = streamText({
      model: gatewayId,
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      ...(hasTools ? { tools } : {}),
      // Bound the tool-call loop so the model can't spiral. The entity
      // path is the longest chain: find → (disambiguate) → getEntityContent
      // → getSourceItemContent ×N → answer, so allow more headroom than the
      // old free-text-only flow.
      stopWhen: stepCountIs(10),
    })

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        writer.merge(pipeJsonRender(result.toUIMessageStream()))
      },
    })

    return createUIMessageStreamResponse({ stream })
  } catch (error) {
    console.error("[chat] Error:", error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }
}

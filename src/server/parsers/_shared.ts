import "server-only"
import { z } from "zod"

// Junk classification — only the email parser populates this with real
// values (it's the one provider where automated/transactional mail is
// noise). Every other parser writes DEFAULT_RELEVANCE so consumers
// reading source_item.metadata_json see a uniform shape.
export type MetadataRelevance = {
  isJunk: boolean
  category: string | null
  reason: string
}

export const DEFAULT_RELEVANCE: MetadataRelevance = {
  isJunk: false,
  category: null,
  reason: "",
}

// Subset of the LLM analysis result that's denormalised onto
// source_item.metadata_json at parse time (in addition to the YAML
// frontmatter inside the parsed markdown body). contentMarkdown is
// deliberately excluded — it lives only in the markdown body / R2
// blob and would bloat the metadata column for no search benefit.
export type MetadataAnalysis = {
  language: string
  summary: string
  mentions: string[]
  companies: string[]
  products: string[]
  relevance: MetadataRelevance
  // Body-mentioned third parties extracted by the parser's LLM call.
  // Filtered to high-confidence + non-empty email before persist (see
  // filterMentionedPeople). Read by discovery.ts as a third participant
  // source after canonical participants + Nylas envelope.
  mentionedPeople: MentionedPerson[]
}

// A third party referenced inside the body of a source item (not the
// author/sender, not an envelope recipient — those are captured by the
// sync-time `participants` field). Extracted by every parser's existing
// Gemini call via the shared schema + prompt below.
export type MentionedPerson = {
  name: string
  email: string // empty when not quoted in the body
  organization: string // empty when no clear attribution
  confidence: "high" | "medium"
}

export const mentionedPersonSchema = z.object({
  name: z
    .string()
    .describe(
      "Full name of the mentioned person as written in the body. Don't paraphrase.",
    ),
  email: z
    .string()
    .describe(
      "Exact email address QUOTED in the body for this person. Empty string when no email is present. Never fabricate.",
    ),
  organization: z
    .string()
    .describe(
      "Company name explicitly attributed to this person in the body (e.g. 'CEO of Acme', 'Acme's John'). Or, for a 'medium' confidence mention, the author/sender's organization when context makes the affiliation clear ('my colleague Jane'). Empty string when no clear attribution.",
    ),
  confidence: z
    .enum(["high", "medium"])
    .describe(
      "high = email is explicitly quoted in the body OR organization is explicitly attributed to the person. medium = organization is inferred from the author/sender's affiliation (e.g. 'my colleague Jane' said by someone at Acme → Jane at Acme). OMIT the person entirely if neither applies.",
    ),
})

// Reusable system-prompt clause. Each parser appends this PLUS a short
// provider-specific addendum naming who the author/sender is (so the LLM
// knows who NOT to include and where to source the medium-confidence
// org inference). See refs spec § "Per-parser specifics".
export const MENTIONED_PEOPLE_PROMPT = `Beyond the author/sender, scan the body for people EXPLICITLY mentioned who are likely real CRM contacts. For each, emit one entry in mentionedPeople with {name, email, organization, confidence}:

- Quote email verbatim from the body if present; otherwise empty string. NEVER invent or guess an email.
- Set organization to a company explicitly attributed to the person in the body (e.g. "CEO of Acme", "Acme's John Smith"). If the body doesn't attribute them but they're clearly part of the author/sender's own organization (e.g. "my colleague Jane", "our team's Alex"), set organization to the author's company and use confidence="medium".
- Use confidence="high" only when EITHER the email is quoted OR an explicit org attribution exists. Use confidence="medium" for the author-org-inferred case. OMIT the person entirely if neither applies (i.e. a bare name with no email and no clear affiliation).
- Do not include the author/sender themselves — they're captured elsewhere.`

// v1 persist filter (server-side, post-LLM, pre-persist): keep only
// high-confidence entries with a non-empty email, deduped by lowercased
// email. Medium-confidence + email-less entries are emitted by the model
// (future use) but dropped here — discovery dedups by email, so the
// contact-table contract needs the email. See PHASE2.md #14.
export function filterMentionedPeople(
  raw: MentionedPerson[],
): MentionedPerson[] {
  const seen = new Set<string>()
  const out: MentionedPerson[] = []
  for (const p of raw ?? []) {
    if (!p) continue
    if (p.confidence !== "high") continue
    const email = (p.email ?? "").trim().toLowerCase()
    if (!email) continue
    if (seen.has(email)) continue
    seen.add(email)
    out.push({
      name: (p.name ?? "").trim(),
      email,
      organization: (p.organization ?? "").trim(),
      confidence: "high",
    })
  }
  return out
}

// Shape of the YAML frontmatter defined in refs/parsing-sources-template.md.
// Every source parser (email, pdf, chat, drive, …) assembles one of these
// before serialising to markdown.
export type SourceFrontmatter = {
  sourceId: string
  parentSourceId: string | null
  threadId: string | null
  sourceSystem: string
  sourceCreatedAt: string | null
  sourceReceivedAt: string | null
  processedAt: string
  language: string
  senders: string[]
  recipients: string[]
  mentions: string[]
  companies: string[]
  products: string[]
  urls: string[]
}

export function buildFrontmatter(fields: SourceFrontmatter): string {
  // Blank lines between logical groups so the block reads cleanly when
  // rendered as a yaml code block (YAML ignores blank lines between keys).
  const groups: string[][] = [
    [
      `source_id: ${yamlScalar(fields.sourceId)}`,
      `parent_source_id: ${yamlNullable(fields.parentSourceId)}`,
      `thread_id: ${yamlNullable(fields.threadId)}`,
    ],
    [`source_system: ${yamlScalar(fields.sourceSystem)}`],
    [
      `source_created_at: ${yamlNullable(fields.sourceCreatedAt)}`,
      `source_received_at: ${yamlNullable(fields.sourceReceivedAt)}`,
      `processed_at: ${yamlScalar(fields.processedAt)}`,
    ],
    [`language: ${yamlScalar(fields.language)}`],
    [yamlList("senders", fields.senders)],
    [yamlList("recipients", fields.recipients)],
    [yamlList("mentions", fields.mentions)],
    [yamlList("companies", fields.companies)],
    [yamlList("products", fields.products)],
    [yamlList("urls", fields.urls)],
  ]

  const body = groups.map((g) => g.join("\n")).join("\n\n")
  return `---\n${body}\n---`
}

export function assembleMarkdown(
  frontmatter: string,
  summary: string,
  contentMarkdown: string,
): string {
  return (
    `${frontmatter}\n\n` +
    `## Summary\n\n${summary.trim()}\n\n` +
    `## Content\n\n${contentMarkdown.trim()}\n`
  )
}

export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const t = v.trim()
    if (!t) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')]+/gi) ?? []
  const cleaned = matches.map((u) => u.replace(/[).,;:!?]+$/g, ""))
  return uniqueStrings(cleaned)
}

export function emailsToDomainUrls(emails: string[]): string[] {
  const out: string[] = []
  for (const e of emails) {
    const at = e.lastIndexOf("@")
    if (at < 0) continue
    const domain = e.slice(at + 1).trim().toLowerCase()
    if (!domain || !domain.includes(".")) continue
    out.push(`https://${domain}`)
  }
  return out
}

function yamlList(key: string, values: string[]): string {
  if (values.length === 0) return `${key}: []`
  const items = values.map((v) => `  - ${yamlScalar(v)}`).join("\n")
  return `${key}:\n${items}`
}

function yamlScalar(value: string): string {
  // Always double-quote to keep colons, hashes, emoji etc. safe.
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function yamlNullable(value: string | null): string {
  return value ? yamlScalar(value) : "null"
}

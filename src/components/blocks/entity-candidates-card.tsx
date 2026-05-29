"use client"

import {
  Building2,
  User,
  Handshake,
  Loader,
  Search,
  ChevronRight,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

// Renders the output of the `findClients` / `findContacts` / `findDeals`
// chat tools as a list of small, clickable entity-info cards. Clicking a
// card does NOT open a side panel — it sends a follow-up chat message
// asking the assistant to summarize that specific entity from its relevant
// sources, which drives the second retrieval step (getXContent →
// getSourceItemContent → prose summary).
//
// The tool result is plumbed through ai-sdk's `output` field as `unknown`,
// so these shapes are kept structurally aligned with the tools' `execute`
// return values in `src/app/api/chat/route.ts` rather than via a shared type.

export type EntityType = "client" | "contact" | "deal"

type ClientMatch = {
  id: string
  name: string
  funnelPhase?: string | null
  webUrl?: string | null
  status?: string | null
  email?: string | null
}

type ContactMatch = {
  id: string
  name: string
  nameNative?: string | null
  email?: string | null
  clientName?: string | null
  status?: string | null
}

type DealMatch = {
  id: string
  name: string
  funnelStageName?: string | null
  clientName?: string | null
  value?: string | null
  currency?: string | null
  status?: string | null
}

type AnyMatch = ClientMatch | ContactMatch | DealMatch

type FindOutput = {
  totalMatched: number
  matches: AnyMatch[]
}

const ENTITY_META: Record<
  EntityType,
  { icon: LucideIcon; singular: string; plural: string }
> = {
  client: { icon: Building2, singular: "company", plural: "companies" },
  contact: { icon: User, singular: "contact", plural: "contacts" },
  deal: { icon: Handshake, singular: "deal", plural: "deals" },
}

// Builds the per-entity display (title + subtitle chips) and the natural-
// language prompt sent when the card is clicked. The prompt names the
// entity precisely so the assistant can map it back to the id it returned
// from the find tool — no ids are exposed in the UI.
function describe(
  entityType: EntityType,
  match: AnyMatch,
): { title: string; subtitle: string[]; prompt: string } {
  if (entityType === "client") {
    const c = match as ClientMatch
    const subtitle = [c.funnelPhase, c.webUrl, c.email].filter(
      (s): s is string => !!s && s.trim().length > 0,
    )
    return {
      title: c.name,
      subtitle,
      prompt: `Summarize the client "${c.name}" using its relevant sources.`,
    }
  }
  if (entityType === "contact") {
    const c = match as ContactMatch
    const subtitle = [
      c.nameNative,
      c.clientName ? `at ${c.clientName}` : null,
      c.email,
    ].filter((s): s is string => !!s && s.trim().length > 0)
    return {
      title: c.name,
      subtitle,
      prompt: `Summarize the contact "${c.name}"${
        c.clientName ? ` at ${c.clientName}` : ""
      } using their relevant sources.`,
    }
  }
  const d = match as DealMatch
  const subtitle = [
    d.funnelStageName,
    d.clientName ? `client ${d.clientName}` : null,
    d.value ? `${d.value} ${d.currency ?? ""}`.trim() : null,
  ].filter((s): s is string => !!s && s.trim().length > 0)
  return {
    title: d.name,
    subtitle,
    prompt: `Summarize the deal "${d.name}"${
      d.clientName ? ` (client ${d.clientName})` : ""
    } using its relevant sources.`,
  }
}

export function EntityCandidatesCard({
  entityType,
  state,
  output,
  errorText,
  onSelect,
  disabled,
}: {
  entityType: EntityType
  state: string
  output: unknown
  errorText: string | undefined
  // Sends a follow-up chat message that asks the assistant to summarize
  // the selected entity from its sources.
  onSelect: (prompt: string) => void
  disabled: boolean
}) {
  const meta = ENTITY_META[entityType]
  const HeaderIcon = meta.icon

  const isLoading = state === "input-streaming" || state === "input-available"
  if (isLoading) {
    return (
      <div className="rounded-md border bg-card mb-4 p-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader className="h-4 w-4 animate-spin" />
        Searching {meta.plural}…
      </div>
    )
  }

  if (state === "output-error" || errorText) {
    return (
      <div className="rounded-md border bg-destructive/10 text-destructive mb-4 p-3 text-sm">
        Lookup failed{errorText ? `: ${errorText}` : "."}
      </div>
    )
  }

  if (state !== "output-available") return null

  const result = output as FindOutput | undefined
  const matches = result?.matches ?? []

  return (
    <div className="rounded-md border bg-card mb-4 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Search className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">
          {matches.length === 0
            ? `No ${meta.plural} found`
            : `Select a ${meta.singular} to summarize`}
        </span>
        {matches.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {matches.length}
            {result && result.totalMatched > matches.length
              ? ` of ${result.totalMatched}`
              : ""}
          </span>
        )}
      </div>

      {matches.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          No matches found.
        </p>
      ) : (
        <div className="p-3 space-y-2">
          {matches.map((match) => {
            const { title, subtitle, prompt } = describe(entityType, match)
            return (
              <button
                key={match.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(prompt)}
                className="group flex w-full items-center gap-3 rounded-md border bg-muted/20 p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <HeaderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-sm font-medium" title={title}>
                    {title}
                  </h4>
                  {subtitle.length > 0 && (
                    <p className="truncate text-xs text-muted-foreground">
                      {subtitle.join(" · ")}
                    </p>
                  )}
                </div>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  Summarize
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

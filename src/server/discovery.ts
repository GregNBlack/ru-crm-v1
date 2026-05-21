"use server"

import { db } from "@/db/drizzle"
import { client, contact, sourceItem, type EntityStatus } from "@/db/schema"
import { and, eq, isNull, or, sql, inArray, gte } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { normaliseCompanyName } from "@/lib/normalise-company-name"
import { isAutomatedEmail } from "@/lib/is-automated-email"
import {
  domainMatches,
  extractEmailDomain,
  extractWebsiteDomain,
  isFreemailDomain,
} from "@/lib/email-domain"
import { randomUUID } from "crypto"

// ── Types ────────────────────────────────────────────────────────────

/** A company candidate aggregated from `metadata_json.companies`. */
export type ClientCandidate = {
  /** First-seen original casing — used as the new client.name. */
  displayName: string
  /** Canonical dedup key — `normaliseCompanyName(displayName)`. */
  normalisedKey: string
  /** How many scanned source_items mention this company. */
  occurrences: number
  /** Same-run inferred website: set when a participant email's domain's
   *  second-level label normalises to this candidate's key. `null` when no
   *  contributing row carried a matching participant. Drives same-run
   *  link proposals (a fresh client has no DB `webUrl` yet). */
  inferredWebUrl: string | null
  /** Sample (capped at 5) source_item ids for context in the preview. */
  sampleSourceItemIds: string[]
}

/** A contact candidate aggregated from row participants. */
export type ContactCandidate = {
  /** Longest non-empty name seen across the contributing rows. */
  displayName: string
  /** Lowercased + trimmed email — also the dedup key. */
  email: string
  /** How many scanned source_items mention this email. */
  occurrences: number
  /** Sample (capped at 5) source_item ids for context in the preview. */
  sampleSourceItemIds: string[]
}

/** Stable reference to either an existing contact row or a new candidate. */
export type ContactRef =
  | { kind: "existing"; id: string }
  | { kind: "new"; email: string }

/** Stable reference to either an existing client row or a new candidate. */
export type ClientRef =
  | { kind: "existing"; id: string }
  | { kind: "new"; normalisedKey: string }

/** A proposed contact↔client link. Either side may be existing or new. */
export type LinkProposal = {
  contact: ContactRef
  client: ClientRef
  contactName: string
  contactEmail: string
  clientName: string
  /** The client domain the email domain matched on. */
  matchedDomain: string
  /** True when this contact matched 2+ clients; we pick the alphabetically
   *  first client name and flag so the UI can warn. */
  ambiguous: boolean
}

export type DiscoveryPeriod = "all" | "last_day" | "last_week" | "last_month"

export type DiscoveryPreview = {
  scannedRowCount: number
  /** Every source_item id inspected this run — stamped at apply time
   *  regardless of whether it contributed a candidate, so empty-yield rows
   *  aren't re-scanned forever. */
  scannedRowIds: string[]
  clientCandidates: ClientCandidate[]
  contactCandidates: ContactCandidate[]
  linkProposals: LinkProposal[]
}

export type ApplyDiscoveryInput = {
  selectedClientKeys: string[]
  selectedContactEmails: string[]
  /** Per-email display-name overrides (lets the operator rename before save). */
  contactNameOverrides: Record<string, string>
  selectedLinks: { contact: ContactRef; client: ClientRef }[]
  /** scannedRowIds from the preview — stamped on apply. */
  scannedRowIds: string[]
  /** Full candidate sets returned by previewDiscovery — needed at apply
   *  time for display names + inferred web URLs. */
  candidates: {
    clients: ClientCandidate[]
    contacts: ContactCandidate[]
  }
}

export type ApplyDiscoveryResult = {
  clientsCreated: number
  contactsCreated: number
  linksApplied: number
  scannedRowsStamped: number
  createdClients: { id: string; name: string }[]
  createdContacts: { id: string; name: string; email: string }[]
}

// ── Internal helpers (not exported — "use server" exports must be async) ──

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { session, activeOrgId }
}

/** Calendar-rough cutoff for the period selector. `all` → null (no filter). */
function periodCutoff(period: DiscoveryPeriod): Date | null {
  if (period === "all") return null
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const span =
    period === "last_day" ? day : period === "last_week" ? 7 * day : 30 * day
  return new Date(now - span)
}

type Participant = { email: string; name: string }

/**
 * Pull `{email, name}` participant pairs off a source_item's metadata.
 * Three shapes, tried in order (same email-keyed dedup across all):
 *   1. `metadata_json.participants: [{email, name}]` — canonical, written
 *      by gchat / gdrive sync (and any future provider that can expose
 *      emails). Nylas rows synced after this refactor also carry it.
 *   2. Nylas envelope `from / to / cc / bcc` arrays — fallback for old
 *      Nylas rows that pre-date the canonical field.
 *   3. `metadata_json.mentionedPeople: [{name, email, …}]` — LLM-extracted
 *      body mentions, written at parse time by every parser. Already
 *      filtered to high-confidence + non-empty email at write time
 *      (filterMentionedPeople), so we just feed them through the same dedup.
 * Automated addresses are dropped. Returns deduped-by-email (longest name
 * wins) pairs.
 */
function extractParticipants(meta: Record<string, unknown> | null): Participant[] {
  const m = meta ?? {}
  const byEmail = new Map<string, string>()

  const consider = (rawEmail: unknown, rawName: unknown) => {
    const email = (typeof rawEmail === "string" ? rawEmail : "").trim().toLowerCase()
    if (!email) return
    if (isAutomatedEmail(email)) return
    const name = (typeof rawName === "string" ? rawName : "").trim()
    const existing = byEmail.get(email)
    if (existing === undefined || name.length > existing.length) {
      byEmail.set(email, name)
    }
  }

  // 1. Canonical participants field.
  const canonical = m.participants
  if (Array.isArray(canonical)) {
    for (const p of canonical) {
      if (p && typeof p === "object") {
        consider((p as Record<string, unknown>).email, (p as Record<string, unknown>).name)
      }
    }
  }

  // 2. Nylas envelope fallback.
  for (const field of ["from", "to", "cc", "bcc"] as const) {
    const list = m[field]
    if (!Array.isArray(list)) continue
    for (const p of list) {
      if (p && typeof p === "object") {
        consider((p as Record<string, unknown>).email, (p as Record<string, unknown>).name)
      }
    }
  }

  // 3. LLM-extracted body mentions (parse-time). Already filtered to
  // high-confidence + non-empty email at parser write time, so we just run
  // them through the same dedup (consider() still drops automated addresses).
  const mentioned = m.mentionedPeople
  if (Array.isArray(mentioned)) {
    for (const p of mentioned) {
      if (p && typeof p === "object") {
        consider((p as Record<string, unknown>).email, (p as Record<string, unknown>).name)
      }
    }
  }

  return Array.from(byEmail.entries()).map(([email, name]) => ({ email, name }))
}

/**
 * The label immediately before the TLD of a domain.
 *   "acme.com" → "acme" · "mail.acme.com" → "acme" · "acme" → ""
 * Used for same-run webUrl inference (does the email domain belong to a
 * company named like this candidate?).
 */
function secondLevelLabel(domain: string): string {
  const parts = domain.split(".").filter(Boolean)
  if (parts.length < 2) return ""
  return parts[parts.length - 2]
}

// ── previewDiscovery — single read-only scan ─────────────────────────

export async function previewDiscovery(opts?: {
  includeAlreadyScanned?: boolean
  period?: DiscoveryPeriod
}): Promise<DiscoveryPreview> {
  const { activeOrgId } = await requireOrgContext()
  const period = opts?.period ?? "all"
  const cutoff = periodCutoff(period)

  // ── 1. Eligible rows. Any provider — the per-provider gate is gone now
  //       that gchat/gdrive emit canonical participants. ───────────────
  const conditions = [
    eq(sourceItem.organizationId, activeOrgId),
    eq(sourceItem.parseStatus, "complete"),
  ]
  if (!opts?.includeAlreadyScanned) {
    conditions.push(
      or(
        isNull(sourceItem.discoveryScannedAt),
        sql`${sourceItem.parsedAt} > ${sourceItem.discoveryScannedAt}`,
      )!,
    )
  }
  if (cutoff) {
    conditions.push(gte(sourceItem.sourceCreatedAt, cutoff))
  }

  const rows = await db
    .select({
      id: sourceItem.id,
      metadataJson: sourceItem.metadataJson,
    })
    .from(sourceItem)
    .where(and(...conditions))

  const scannedRowIds = rows.map((r) => r.id)

  // ── Existing org entities for dedup ─────────────────────────────────
  const [existingClients, existingContacts] = await Promise.all([
    db
      .select({
        id: client.id,
        name: client.name,
        webUrl: client.webUrl,
        status: client.status,
      })
      .from(client)
      .where(eq(client.organizationId, activeOrgId)),
    db
      .select({
        id: contact.id,
        name: contact.name,
        email: contact.email,
        clientId: contact.clientId,
        status: contact.status,
      })
      .from(contact)
      .where(eq(contact.organizationId, activeOrgId)),
  ])

  const existingClientKeys = new Set(
    existingClients
      .map((c) => normaliseCompanyName(c.name))
      .filter((k) => k.length > 0),
  )
  const existingContactEmails = new Set(
    existingContacts
      .map((c) => (c.email ?? "").trim().toLowerCase())
      .filter((e) => e.length > 0),
  )

  // ── 2. Aggregate companies + 3. participants in a single pass ───────
  type ClientBucket = {
    displayName: string
    normalisedKey: string
    sourceItemIds: Set<string>
  }
  const clientBuckets = new Map<string, ClientBucket>()

  type ContactBucket = {
    email: string
    bestName: string
    sourceItemIds: Set<string>
  }
  const contactBuckets = new Map<string, ContactBucket>()

  // rowId → participant emails, kept for same-run webUrl inference.
  const participantsByRow = new Map<string, Participant[]>()

  for (const row of rows) {
    const meta = (row.metadataJson as Record<string, unknown> | null) ?? {}

    // Companies
    const raw = meta.companies
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item !== "string") continue
        const name = item.trim()
        if (!name) continue
        const key = normaliseCompanyName(name)
        if (!key || existingClientKeys.has(key)) continue
        const existing = clientBuckets.get(key)
        if (existing) {
          existing.sourceItemIds.add(row.id)
        } else {
          clientBuckets.set(key, {
            displayName: name,
            normalisedKey: key,
            sourceItemIds: new Set([row.id]),
          })
        }
      }
    }

    // Participants
    const participants = extractParticipants(meta)
    participantsByRow.set(row.id, participants)
    for (const p of participants) {
      if (existingContactEmails.has(p.email)) continue
      const existing = contactBuckets.get(p.email)
      if (existing) {
        existing.sourceItemIds.add(row.id)
        if (p.name.length > existing.bestName.length) existing.bestName = p.name
      } else {
        contactBuckets.set(p.email, {
          email: p.email,
          bestName: p.name,
          sourceItemIds: new Set([row.id]),
        })
      }
    }
  }

  // ── 4. Same-run webUrl inference for new client candidates ──────────
  const clientCandidates: ClientCandidate[] = Array.from(
    clientBuckets.values(),
  ).map((b) => {
    let inferredWebUrl: string | null = null
    for (const rowId of b.sourceItemIds) {
      const participants = participantsByRow.get(rowId) ?? []
      for (const p of participants) {
        const domain = extractEmailDomain(p.email)
        if (!domain || isFreemailDomain(domain)) continue
        const label = secondLevelLabel(domain)
        if (label && normaliseCompanyName(label) === b.normalisedKey) {
          inferredWebUrl = `https://${domain}`
          break
        }
      }
      if (inferredWebUrl) break
    }
    return {
      displayName: b.displayName,
      normalisedKey: b.normalisedKey,
      occurrences: b.sourceItemIds.size,
      inferredWebUrl,
      sampleSourceItemIds: Array.from(b.sourceItemIds).slice(0, 5),
    }
  })
  clientCandidates.sort(
    (a, b) =>
      b.occurrences - a.occurrences || a.displayName.localeCompare(b.displayName),
  )

  const contactCandidates: ContactCandidate[] = Array.from(
    contactBuckets.values(),
  )
    .map((b) => ({
      displayName: b.bestName,
      email: b.email,
      occurrences: b.sourceItemIds.size,
      sampleSourceItemIds: Array.from(b.sourceItemIds).slice(0, 5),
    }))
    .sort(
      (a, b) =>
        b.occurrences - a.occurrences || a.email.localeCompare(b.email),
    )

  // ── 5. Build link proposals ─────────────────────────────────────────
  // Link side "clients": DB clients with a webUrl + new candidates with an
  // inferred one. Link side "contacts": DB unlinked contacts + new candidates.
  type LinkClient = { ref: ClientRef; name: string; domain: string }
  const linkClients: LinkClient[] = []
  for (const c of existingClients) {
    if (c.status === "suspended") continue
    const url = (c.webUrl ?? "").trim()
    if (!url) continue
    const domain = extractWebsiteDomain(url)
    if (!domain) continue
    linkClients.push({ ref: { kind: "existing", id: c.id }, name: c.name, domain })
  }
  for (const cand of clientCandidates) {
    if (!cand.inferredWebUrl) continue
    const domain = extractWebsiteDomain(cand.inferredWebUrl)
    if (!domain) continue
    linkClients.push({
      ref: { kind: "new", normalisedKey: cand.normalisedKey },
      name: cand.displayName,
      domain,
    })
  }

  type LinkContact = { ref: ContactRef; name: string; email: string }
  const linkContacts: LinkContact[] = []
  for (const c of existingContacts) {
    if (c.clientId) continue
    if (c.status === "suspended") continue
    const email = (c.email ?? "").trim()
    if (!email) continue
    linkContacts.push({ ref: { kind: "existing", id: c.id }, name: c.name, email })
  }
  for (const cand of contactCandidates) {
    linkContacts.push({
      ref: { kind: "new", email: cand.email },
      name: cand.displayName || cand.email,
      email: cand.email,
    })
  }

  const linkProposals: LinkProposal[] = []
  for (const lc of linkContacts) {
    const emailDomain = extractEmailDomain(lc.email)
    if (!emailDomain || isFreemailDomain(emailDomain)) continue
    const matches = linkClients.filter((cl) =>
      domainMatches(emailDomain, cl.domain),
    )
    if (matches.length === 0) continue
    matches.sort((a, b) => a.name.localeCompare(b.name))
    const picked = matches[0]
    linkProposals.push({
      contact: lc.ref,
      client: picked.ref,
      contactName: lc.name,
      contactEmail: lc.email,
      clientName: picked.name,
      matchedDomain: picked.domain,
      ambiguous: matches.length > 1,
    })
  }
  linkProposals.sort((a, b) => a.contactName.localeCompare(b.contactName))

  return {
    scannedRowCount: rows.length,
    scannedRowIds,
    clientCandidates,
    contactCandidates,
    linkProposals,
  }
}

// ── applyDiscovery — sequential apply (Neon HTTP has no transactions) ──

export async function applyDiscovery(
  input: ApplyDiscoveryInput,
): Promise<ApplyDiscoveryResult> {
  const { session, activeOrgId } = await requireOrgContext()

  // ── 1. Insert clients ───────────────────────────────────────────────
  // Re-check existing keys first (parallel-session safety).
  const existingClients = await db
    .select({ id: client.id, name: client.name })
    .from(client)
    .where(eq(client.organizationId, activeOrgId))
  const existingClientKeys = new Set(
    existingClients
      .map((c) => normaliseCompanyName(c.name))
      .filter((k) => k.length > 0),
  )

  const selectedClientKeys = new Set(input.selectedClientKeys)
  const toCreateClients = input.candidates.clients.filter(
    (c) =>
      selectedClientKeys.has(c.normalisedKey) &&
      !existingClientKeys.has(c.normalisedKey),
  )

  const createdClients: { id: string; name: string }[] = []
  // normalisedKey → new client id (for same-run link resolution).
  const newClientKeyToId = new Map<string, string>()
  if (toCreateClients.length > 0) {
    const now = new Date()
    const rows = toCreateClients.map((c) => ({
      id: randomUUID(),
      name: c.displayName,
      phone: null,
      email: null,
      address: null,
      webUrl: c.inferredWebUrl || null,
      funnelPhase: "awareness" as const,
      status: "initial" as const,
      userId: session.user.id,
      organizationId: activeOrgId,
      createdAt: now,
      updatedAt: now,
    }))
    await db.insert(client).values(rows)
    for (const r of rows) {
      createdClients.push({ id: r.id, name: r.name })
      const cand = toCreateClients.find((c) => c.displayName === r.name)
      if (cand) newClientKeyToId.set(cand.normalisedKey, r.id)
    }
  }

  // ── 2. Insert contacts ──────────────────────────────────────────────
  const existingContacts = await db
    .select({ email: contact.email })
    .from(contact)
    .where(eq(contact.organizationId, activeOrgId))
  const existingContactEmails = new Set(
    existingContacts
      .map((c) => (c.email ?? "").trim().toLowerCase())
      .filter((e) => e.length > 0),
  )

  const selectedContactEmails = new Set(
    input.selectedContactEmails.map((e) => e.trim().toLowerCase()).filter(Boolean),
  )
  const overrides = input.contactNameOverrides ?? {}
  const toCreateContacts = input.candidates.contacts.filter(
    (c) =>
      selectedContactEmails.has(c.email) && !existingContactEmails.has(c.email),
  )

  const createdContacts: { id: string; name: string; email: string }[] = []
  // email → new contact id (for same-run link resolution).
  const newContactEmailToId = new Map<string, string>()
  if (toCreateContacts.length > 0) {
    const now = new Date()
    const rows = toCreateContacts.map((c) => {
      const overridden = (overrides[c.email] ?? "").trim()
      const fallback = c.displayName.trim() || "(unknown)"
      return {
        id: randomUUID(),
        name: overridden || fallback,
        email: c.email,
        phone: null,
        position: null,
        clientId: null,
        status: "initial" as EntityStatus,
        userId: session.user.id,
        organizationId: activeOrgId,
        createdAt: now,
        updatedAt: now,
      }
    })
    await db.insert(contact).values(rows)
    for (const r of rows) {
      createdContacts.push({ id: r.id, name: r.name, email: r.email ?? "" })
      newContactEmailToId.set(r.email ?? "", r.id)
    }
  }

  // ── 3. Apply links ──────────────────────────────────────────────────
  // Resolve each ref pair to concrete ids via the maps populated above (or
  // the existing id). Drop unresolvable refs (entity wasn't selected for
  // creation) and refs to already-linked contacts (re-checked below).
  const resolveContact = (ref: ContactRef): string | null =>
    ref.kind === "existing" ? ref.id : newContactEmailToId.get(ref.email) ?? null
  const resolveClient = (ref: ClientRef): string | null =>
    ref.kind === "existing" ? ref.id : newClientKeyToId.get(ref.normalisedKey) ?? null

  const resolvedLinks: { contactId: string; clientId: string }[] = []
  for (const link of input.selectedLinks) {
    const contactId = resolveContact(link.contact)
    const clientId = resolveClient(link.client)
    if (!contactId || !clientId) continue
    resolvedLinks.push({ contactId, clientId })
  }

  let linksApplied = 0
  if (resolvedLinks.length > 0) {
    const contactIds = Array.from(new Set(resolvedLinks.map((l) => l.contactId)))
    const clientIds = Array.from(new Set(resolvedLinks.map((l) => l.clientId)))

    // Re-validate: contacts must be in-org AND currently unlinked; clients
    // must be in-org. Anything else is silently dropped.
    const [validContacts, validClients] = await Promise.all([
      db
        .select({ id: contact.id, clientId: contact.clientId })
        .from(contact)
        .where(
          and(
            eq(contact.organizationId, activeOrgId),
            inArray(contact.id, contactIds),
          ),
        ),
      db
        .select({ id: client.id })
        .from(client)
        .where(
          and(
            eq(client.organizationId, activeOrgId),
            inArray(client.id, clientIds),
          ),
        ),
    ])
    const unlinkedContactIds = new Set(
      validContacts.filter((c) => c.clientId === null).map((c) => c.id),
    )
    const validClientIds = new Set(validClients.map((c) => c.id))

    for (const { contactId, clientId } of resolvedLinks) {
      if (!unlinkedContactIds.has(contactId)) continue
      if (!validClientIds.has(clientId)) continue
      await db.update(contact).set({ clientId }).where(eq(contact.id, contactId))
      // Guard against two links targeting the same just-linked contact in
      // one apply (last-write-wins otherwise).
      unlinkedContactIds.delete(contactId)
      linksApplied++
    }
  }

  // ── 4. Stamp every scanned row ──────────────────────────────────────
  let scannedRowsStamped = 0
  if (input.scannedRowIds.length > 0) {
    await db
      .update(sourceItem)
      .set({ discoveryScannedAt: new Date() })
      .where(
        and(
          eq(sourceItem.organizationId, activeOrgId),
          inArray(sourceItem.id, input.scannedRowIds),
        ),
      )
    scannedRowsStamped = input.scannedRowIds.length
  }

  return {
    clientsCreated: createdClients.length,
    contactsCreated: createdContacts.length,
    linksApplied,
    scannedRowsStamped,
    createdClients,
    createdContacts,
  }
}

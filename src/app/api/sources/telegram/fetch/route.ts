import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "@/lib/get-session"
import { assertSourceInScope, SourceScopeError } from "@/server/sources"
import { fetchTelegramUpdates } from "@/server/ingest/telegram"
import {
  MissingCredentialsError,
  InvalidCredentialsError,
} from "@/server/providers/credentials"

// Manual Telegram pull (getUpdates). Org-scoped: requires an authenticated
// session with an active org, and the target source must belong to it.
// This is the on-demand counterpart to the webhook push — primarily for
// local dev / before a public webhook is reachable. A `getUpdates` long
// poll plus N upserts finishes quickly; keep modest headroom.
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const session = await getServerSession()
  const activeOrgId = session?.session.activeOrganizationId
  if (!session || !activeOrgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let sourceId: string | undefined
  try {
    const body = await request.json()
    sourceId = typeof body?.sourceId === "string" ? body.sourceId : undefined
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!sourceId) {
    return NextResponse.json({ error: "sourceId is required" }, { status: 400 })
  }

  try {
    await assertSourceInScope(sourceId, activeOrgId)
    const result = await fetchTelegramUpdates(sourceId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof SourceScopeError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.reason === "not_found" ? 404 : 403 },
      )
    }
    if (
      error instanceof MissingCredentialsError ||
      error instanceof InvalidCredentialsError
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error("[sources/telegram/fetch] Error:", error)
    const message = error instanceof Error ? error.message : "Fetch failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

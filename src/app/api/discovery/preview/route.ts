import { NextRequest, NextResponse } from "next/server"
import { previewDiscovery, type DiscoveryPeriod } from "@/server/discovery"

// Re-export the preview-side types so client components can import them
// without dragging in the "use server" module.
export type {
  DiscoveryPreview,
  DiscoveryPeriod,
  ClientCandidate,
  ContactCandidate,
  LinkProposal,
  ContactRef,
  ClientRef,
} from "@/server/discovery"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : 400
  return NextResponse.json({ error: message }, { status })
}

const VALID_PERIODS: DiscoveryPeriod[] = [
  "all",
  "last_day",
  "last_week",
  "last_month",
]

export async function POST(request: NextRequest) {
  try {
    // Body is optional — tolerate empty / non-JSON bodies.
    let body: { includeAlreadyScanned?: boolean; period?: DiscoveryPeriod } = {}
    try {
      const parsed = await request.json()
      if (parsed && typeof parsed === "object") body = parsed
    } catch {
      // No body — use defaults.
    }

    const period =
      body.period && VALID_PERIODS.includes(body.period) ? body.period : "all"

    const preview = await previewDiscovery({
      includeAlreadyScanned: body.includeAlreadyScanned === true,
      period,
    })
    return NextResponse.json(preview)
  } catch (error) {
    return errorResponse(error)
  }
}

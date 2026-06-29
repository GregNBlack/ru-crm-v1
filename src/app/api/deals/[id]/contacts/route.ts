import { NextRequest, NextResponse } from "next/server"
import {
  getDeal,
  listDealContactsWithRoles,
  listDealContactOptions,
  addDealContact,
  setDealContactRole,
  removeDealContact,
} from "@/server/deals"
import { dealContactRole } from "@/db/schema"

export { type DealContactWithRole } from "@/server/deals"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status =
    message === "Unauthorized" || message === "No active organization"
      ? 403
      : message === "Deal not found"
        ? 404
        : 400
  return NextResponse.json({ error: message }, { status })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const deal = await getDeal(id)
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 })
    }
    const [contacts, options] = await Promise.all([
      listDealContactsWithRoles(id),
      listDealContactOptions(deal.clientId),
    ])
    const linkedIds = new Set(contacts.map((c) => c.id))
    return NextResponse.json({
      contacts,
      options: options.filter((o) => !linkedIds.has(o.id)),
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await req.json()
    const { action, contactId, role } = body
    if (!contactId) {
      return NextResponse.json(
        { error: "contactId is required" },
        { status: 400 },
      )
    }
    if (action === "add") {
      await addDealContact(id, contactId)
    } else if (action === "remove") {
      await removeDealContact(id, contactId)
    } else if (action === "setRole") {
      const valid = role === null || dealContactRole.enumValues.includes(role)
      if (!valid) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 })
      }
      await setDealContactRole(id, contactId, role ?? null)
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return errorResponse(error)
  }
}

import { NextRequest, NextResponse } from "next/server"
import {
  getAdminUserOrganizations,
  listOrganizationOptions,
  setMemberRole,
  setUserOrganizations,
} from "@/server/admin-organizations"

export {
  type UserOrgInfo,
  type OrgOption,
  type MembershipInput,
} from "@/server/admin-organizations"

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error"
  const status = message === "Unauthorized" ? 403 : 400
  return NextResponse.json({ error: message }, { status })
}

// GET /api/admin/user-organizations            → { userOrgMap, userOrgDetails }
// GET /api/admin/user-organizations?orgOptions=1 → { organizations }
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    if (searchParams.get("orgOptions") === "1") {
      const organizations = await listOrganizationOptions()
      return NextResponse.json({ organizations })
    }
    const result = await getAdminUserOrganizations()
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}

// PUT /api/admin/user-organizations — admin membership mutations:
//   { action: "setRole", memberId, role }                    → one member's role
//   { action: "setMemberships", userId, memberships: [...] } → reconcile a user's set
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { action } = body

    if (action === "setRole") {
      if (!body.memberId || !body.role) {
        return NextResponse.json(
          { error: "memberId and role are required" },
          { status: 400 },
        )
      }
      await setMemberRole(body.memberId, body.role)
      return NextResponse.json({ success: true })
    }

    if (action === "setMemberships") {
      if (!body.userId || !Array.isArray(body.memberships)) {
        return NextResponse.json(
          { error: "userId and memberships[] are required" },
          { status: 400 },
        )
      }
      await setUserOrganizations(body.userId, body.memberships)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (error) {
    return errorResponse(error)
  }
}

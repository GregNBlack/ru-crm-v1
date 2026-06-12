"use server"

import { db } from "@/db/drizzle"
import { organization, member, user } from "@/db/schema"
import { eq, count, and, like, inArray } from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"
import { randomUUID } from "crypto"

// Org-level roles (mirrors the `role` pgEnum). Used to validate admin-supplied
// role values before they touch the DB.
const ORG_ROLES = ["owner", "admin", "member"] as const
export type OrgRole = (typeof ORG_ROLES)[number]
const isOrgRole = (v: unknown): v is OrgRole =>
  typeof v === "string" && (ORG_ROLES as readonly string[]).includes(v)

export type OrgOption = { id: string; name: string }

// Desired membership entry when reconciling a user's org set.
export type MembershipInput = { organizationId: string; role: OrgRole }

export type AdminOrg = {
  id: string
  name: string
  slug: string
  logo: string | null
  webUrl: string | null
  address: string | null
  email: string | null
  phone: string | null
  metadata: string | null
  createdAt: string
  memberCount: number
  ownerName: string | null
  ownerEmail: string | null
}

export type UserOrgInfo = {
  memberId: string
  organizationId: string
  organizationName: string
  orgRole: string
}

async function requireAdmin() {
  const session = await getServerSession()
  if (!session || session.user.role !== "admin") {
    throw new Error("Unauthorized")
  }
  return session
}

export async function getAdminOrganizations(
  searchName: string,
  limit: number,
  offset: number,
) {
  await requireAdmin()

  const whereClause = searchName
    ? like(organization.name, `%${searchName}%`)
    : undefined

  const orgs = await db
    .select()
    .from(organization)
    .where(whereClause)
    .limit(limit)
    .offset(offset)
    .orderBy(organization.createdAt)

  const totalResult = await db
    .select({ count: count() })
    .from(organization)
    .where(whereClause)

  const total = totalResult[0]?.count ?? 0

  const result: AdminOrg[] = await Promise.all(
    orgs.map(async (org) => {
      const memberCount = await db
        .select({ count: count() })
        .from(member)
        .where(eq(member.organizationId, org.id))

      const owner = await db
        .select({
          userName: user.name,
          userEmail: user.email,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(
            eq(member.organizationId, org.id),
            eq(member.role, "owner"),
          ),
        )
        .limit(1)

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        logo: org.logo,
        webUrl: org.webUrl,
        address: org.address,
        email: org.email,
        phone: org.phone,
        metadata: org.metadata,
        createdAt: org.createdAt.toISOString(),
        memberCount: memberCount[0]?.count ?? 0,
        ownerName: owner[0]?.userName ?? null,
        ownerEmail: owner[0]?.userEmail ?? null,
      }
    }),
  )

  return { organizations: result, total }
}

export async function updateAdminOrganization(
  organizationId: string,
  data: {
    name?: string
    slug?: string
    logo?: string
    taxId?: string
    webUrl?: string
    address?: string
    email?: string
    phone?: string
  },
) {
  await requireAdmin()

  const metadata = JSON.stringify({ taxId: data.taxId || "" })

  await db
    .update(organization)
    .set({
      name: data.name,
      slug: data.slug,
      logo: data.logo,
      metadata,
      webUrl: data.webUrl?.trim() || null,
      address: data.address?.trim() || null,
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
    })
    .where(eq(organization.id, organizationId))
}

export async function getAdminUserOrganizations() {
  await requireAdmin()

  const members = await db
    .select({
      memberId: member.id,
      userId: member.userId,
      orgRole: member.role,
      organizationId: member.organizationId,
      organizationName: organization.name,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))

  const userOrgMap: Record<string, string> = {}
  const userOrgDetails: Record<string, UserOrgInfo[]> = {}

  for (const m of members) {
    if (userOrgMap[m.userId]) {
      userOrgMap[m.userId] += `, ${m.organizationName}`
    } else {
      userOrgMap[m.userId] = m.organizationName
    }

    if (!userOrgDetails[m.userId]) {
      userOrgDetails[m.userId] = []
    }
    userOrgDetails[m.userId].push({
      memberId: m.memberId,
      organizationId: m.organizationId,
      organizationName: m.organizationName,
      orgRole: m.orgRole,
    })
  }

  return { userOrgMap, userOrgDetails }
}

// All organizations as { id, name } for the membership-editor picker.
export async function listOrganizationOptions(): Promise<OrgOption[]> {
  await requireAdmin()
  return db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .orderBy(organization.name)
}

// Throws if `organizationId` would be left with no `owner` after removing /
// demoting the given member — prevents an admin edit from orphaning an org.
async function assertNotLastOwner(organizationId: string) {
  const rows = await db
    .select({ c: count() })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.role, "owner"),
      ),
    )
  if ((rows[0]?.c ?? 0) <= 1) {
    throw new Error(
      "Cannot remove the last owner of an organization — assign another owner first.",
    )
  }
}

// Direct, admin-gated org-role change. Bypasses the better-auth org plugin on
// purpose: that API authorizes against the CALLER's membership in the target
// org, so a platform admin who isn't a member of the org fails with
// "member not found". Admin settings own the membership table directly.
export async function setMemberRole(memberId: string, role: string) {
  await requireAdmin()
  if (!isOrgRole(role)) throw new Error("Invalid role")

  const rows = await db
    .select({ id: member.id, organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.id, memberId))
    .limit(1)
  const current = rows[0]
  if (!current) throw new Error("Member not found")

  if (current.role === "owner" && role !== "owner") {
    await assertNotLastOwner(current.organizationId)
  }

  await db.update(member).set({ role }).where(eq(member.id, memberId))
}

// Reconcile a user's full org membership set to `desired` — inserts new
// memberships, removes dropped ones, and updates changed roles in one pass.
// Admin-gated, direct DB. The last-owner guard protects every affected org.
export async function setUserOrganizations(
  userId: string,
  desired: MembershipInput[],
) {
  await requireAdmin()

  // Validate the target user + every supplied role/org up front.
  const userRows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  if (!userRows[0]) throw new Error("User not found")

  for (const d of desired) {
    if (!isOrgRole(d.role)) throw new Error("Invalid role")
  }
  // Collapse duplicate org entries (last one wins) so the desired set is unique.
  const desiredByOrg = new Map<string, OrgRole>()
  for (const d of desired) desiredByOrg.set(d.organizationId, d.role)

  if (desiredByOrg.size > 0) {
    const orgIds = [...desiredByOrg.keys()]
    const existingOrgs = await db
      .select({ id: organization.id })
      .from(organization)
      .where(inArray(organization.id, orgIds))
    const found = new Set(existingOrgs.map((o) => o.id))
    if (found.size !== orgIds.length) {
      throw new Error("Organization not found")
    }
  }

  const current = await db
    .select({ id: member.id, organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, userId))
  const currentByOrg = new Map(current.map((c) => [c.organizationId, c]))

  // Removals: a current membership that isn't in the desired set.
  for (const c of current) {
    if (desiredByOrg.has(c.organizationId)) continue
    if (c.role === "owner") await assertNotLastOwner(c.organizationId)
    await db.delete(member).where(eq(member.id, c.id))
  }

  // Adds + role updates.
  for (const [organizationId, role] of desiredByOrg) {
    const existing = currentByOrg.get(organizationId)
    if (!existing) {
      await db.insert(member).values({
        id: randomUUID(),
        organizationId,
        userId,
        role,
        createdAt: new Date(),
      })
    } else if (existing.role !== role) {
      if (existing.role === "owner" && role !== "owner") {
        await assertNotLastOwner(organizationId)
      }
      await db.update(member).set({ role }).where(eq(member.id, existing.id))
    }
  }
}

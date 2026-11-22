import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth-helpers'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import {
  INVITABLE_ROLES,
  canManageMembers,
  createOrganizationInvitation,
  describeRoleAbilities,
  listOrganizationInvitations,
  roleLabel,
  type MemberRole,
} from '@/lib/organization/invitations'

export const dynamic = 'force-dynamic'

/**
 * Organization members and invitations.
 *
 * The organization comes from the session through resolveOrganizationContext. There is no
 * organization id in the request that could point this at somebody else's organization.
 */

export async function GET() {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ organization: null, members: [], invitations: [], canManage: false })
  }
  const context = resolved.context

  const [memberRows, invitations] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, userId: true, role: true, status: true, regions: true, createdAt: true },
    }),
    listOrganizationInvitations(context),
  ])

  const userIds = memberRows.map((row) => row.userId)
  const people = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    : []
  const personById = new Map(people.map((person) => [person.id, person]))

  return NextResponse.json({
    organization: { id: context.organizationId, name: context.organizationName },
    role: context.role,
    canManage: canManageMembers(context),
    members: memberRows.map((row) => ({
      id: row.id,
      name: personById.get(row.userId)?.name ?? null,
      email: personById.get(row.userId)?.email ?? null,
      role: row.role,
      roleLabel: roleLabel(row.role as MemberRole),
      status: row.status,
      regions: row.regions,
      createdAt: row.createdAt.toISOString(),
    })),
    invitations,
    roles: INVITABLE_ROLES.map((role) => ({ role, label: roleLabel(role), abilities: describeRoleAbilities(role) })),
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: 'You are not a member of an organization.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'The invitation could not be read.' }, { status: 400 })
  }
  const { email, role, regions } = body as { email?: unknown; role?: unknown; regions?: unknown }

  if (typeof email !== 'string') {
    return NextResponse.json({ error: 'Enter the email address of the person you want to invite.' }, { status: 400 })
  }
  if (typeof role !== 'string' || !INVITABLE_ROLES.includes(role as MemberRole)) {
    return NextResponse.json({ error: 'Choose one of the offered roles.' }, { status: 400 })
  }
  const regionList = Array.isArray(regions) ? regions.filter((value): value is string => typeof value === 'string') : []

  const result = await createOrganizationInvitation({
    context: resolved.context,
    email,
    role: role as MemberRole,
    regions: regionList,
    invitedById: auth.user.id,
  })

  if (!result.ok) {
    // 403 for authority, 400 for anything a person can correct in the form.
    const status = result.reason === 'not-permitted' || result.reason === 'role-not-grantable' ? 403 : 400
    return NextResponse.json({ error: result.error, reason: result.reason }, { status })
  }

  // The plaintext token is returned exactly once, for delivery or copying. It is never
  // logged and never stored. No invitation email is sent from here: the repository has no
  // organization-level delivery channel yet, and inventing one was out of scope.
  return NextResponse.json({
    success: true,
    invitationId: result.value?.id,
    expiresAt: result.value?.expiresAt?.toISOString(),
    acceptPath: `/accept-organization-invitation?token=${result.value?.token}`,
    delivery: 'not-sent',
    deliveryNote:
      'No email was sent. Copy the invitation link and give it to the person directly until an organization email channel is configured.',
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { scheduleInvitationDelivery } from '@/lib/organization/schedule-invitation-delivery'
import { requireAuth } from '@/lib/auth-helpers'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { queueOrganizationInvitationEmail } from '@/lib/organization/invitation-delivery'
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
export const maxDuration = 60

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
  const { email, role, regions, allRegions } = body as {
    email?: unknown; role?: unknown; regions?: unknown; allRegions?: unknown
  }

  if (typeof email !== 'string') {
    return NextResponse.json({ error: 'Enter the email address of the person you want to invite.' }, { status: 400 })
  }
  if (typeof role !== 'string' || !INVITABLE_ROLES.includes(role as MemberRole)) {
    return NextResponse.json({ error: 'Choose one of the offered roles.' }, { status: 400 })
  }
  const regionList = Array.isArray(regions) ? regions.filter((value): value is string => typeof value === 'string') : []

  // A regional manager's scope is now decided by what was actually chosen.
  // Previously a missing or malformed list became [] which the resolver read as
  // "every region", so a typo in the form granted organization-wide access.
  // Now: an explicit all-regions choice grants everything; an explicit list
  // grants those regions; neither means no locations until an owner assigns
  // them. A manager invited with no scope at all is rejected outright rather
  // than silently given the whole organization.
  const wantsAllRegions = allRegions === true
  if (role === 'REGIONAL_MANAGER' && !wantsAllRegions && regionList.length === 0) {
    return NextResponse.json(
      {
        error:
          'Choose the regions this manager should look after. If they should see every location, tick "All locations" instead.',
      },
      { status: 400 }
    )
  }
  if (wantsAllRegions && regionList.length > 0) {
    return NextResponse.json(
      { error: 'Choose either specific regions or all locations, not both.' },
      { status: 400 }
    )
  }

  const result = await createOrganizationInvitation({
    context: resolved.context,
    email,
    role: role as MemberRole,
    regions: regionList,
    allRegions: wantsAllRegions,
    invitedById: auth.user.id,
  })

  if (!result.ok) {
    // 403 for authority, 400 for anything a person can correct in the form.
    const status = result.reason === 'not-permitted' || result.reason === 'role-not-grantable' ? 403 : 400
    return NextResponse.json({ error: result.error, reason: result.reason }, { status })
  }

  const invitation = result.value!
  let delivery: Awaited<ReturnType<typeof queueOrganizationInvitationEmail>>
  try {
    delivery = await queueOrganizationInvitationEmail({
      invitationId: invitation.id,
      recipient: email.trim().toLowerCase(),
      token: invitation.token,
    })
  } catch {
    delivery = { queued: false, state: 'failed', message: 'Email could not be queued. Copy the invitation link and share it directly.' }
  }

  if ((delivery.state === 'queued' || delivery.state === 'retry-scheduled') && delivery.notificationId) {
    scheduleInvitationDelivery(delivery.notificationId)
  }

  return NextResponse.json({
    success: true,
    invitationId: invitation.id,
    expiresAt: invitation.expiresAt.toISOString(),
    delivery: delivery.state,
    deliveryNote: delivery.message ?? 'Invitation email queued for delivery.',
    ...(!delivery.queued ? { acceptPath: `/accept-organization-invitation?token=${encodeURIComponent(invitation.token)}` } : {}),
  })
}

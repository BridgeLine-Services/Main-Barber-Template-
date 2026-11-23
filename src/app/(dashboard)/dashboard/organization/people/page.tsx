export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { describeRole } from '@/lib/organization/capabilities'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import {
  INVITABLE_ROLES,
  canManageMembers,
  listOrganizationInvitations,
  roleLabel,
} from '@/lib/organization/invitations'
import type { MemberRole } from '@/lib/organization/invitations'
import { PeopleAndAccess, type InvitationView, type MemberView } from '@/components/organization/PeopleAndAccess'

/**
 * People and access: the organization's members and invitations.
 *
 * The organization comes from the session, never from the URL. Members are read for that
 * organization only. Names and email addresses of organization members are shown because
 * this is a staff directory; no customer record is read anywhere on this page.
 */
export default async function PeopleAndAccessPage() {
  const auth = await requireAuth()
  if (!auth.success) redirect('/login')

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-3xl font-bold text-foreground">People and access</h1>
        <div className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <p className="text-sm text-muted-foreground">
            {resolved.message ?? 'You are not a member of an organization.'} People and access is for organizations with more
            than one shop. Your own shop has its own Staff page.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-medium text-foreground"
          >
            Go to my shop dashboard
          </Link>
        </div>
      </div>
    )
  }

  const context = resolved.context
  const canManage = canManageMembers(context)

  const memberRows = await prisma.organizationMember.findMany({
    where: { organizationId: context.organizationId },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { id: true, userId: true, role: true, status: true, createdAt: true },
  })

  const userIds = memberRows.map((row) => row.userId)
  const people = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    : []
  const personById = new Map(people.map((person) => [person.id, person]))

  const members: MemberView[] = memberRows.map((row) => {
    const person = personById.get(row.userId)
    return {
      id: row.id,
      name: person?.name ?? '',
      email: person?.email ?? 'email not recorded',
      role: row.role as MemberRole,
      status: row.status as MemberView['status'],
      isSelf: row.userId === auth.user.id,
      isOwner: row.role === 'ORGANIZATION_OWNER',
    }
  })

  // The store already states each invitation's state and the sentence for it; this page
  // repeats neither rule, so the words cannot drift from the backend.
  const invitations: InvitationView[] = (await listOrganizationInvitations(context)).map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    state: invitation.state,
    stateWords: invitation.stateLabel,
    expiresAt: invitation.expiresAt,
    createdOn: invitation.createdAt,
  }))

  const allRoles: MemberRole[] = ['ORGANIZATION_OWNER', 'CORPORATE_ADMIN', 'REGIONAL_MANAGER', 'FRANCHISE_OWNER']

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-[var(--dash-brand)]">Organization</p>
        <h1 className="mt-2 text-3xl font-bold text-foreground">People and access</h1>
        <p className="mt-2 text-muted-foreground">
          {context.organizationName}: you are the {describeRole(context.role).toLowerCase()}.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {canManage
            ? 'You can invite people and change what they may do. Every change asks you to confirm first.'
            : `You can see who is here. Changing people needs the ${roleLabel('ORGANIZATION_OWNER').toLowerCase()}.`}
        </p>
      </div>

      <PeopleAndAccess
        canManage={canManage}
        members={members}
        invitations={invitations}
        invitableRoles={INVITABLE_ROLES}
        allRoles={allRoles}
      />
    </div>
  )
}

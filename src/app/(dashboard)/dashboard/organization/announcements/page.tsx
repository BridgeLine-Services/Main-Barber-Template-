export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { can, describeRole } from '@/lib/organization/capabilities'
import { emptyStateMessage } from '@/lib/organization/announcement-inbox'
import { loadAnnouncementInbox } from '@/lib/organization/announcement-delivery'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { AnnouncementInbox, type AnnouncementItemView, type ComposeLocation } from '@/components/organization/AnnouncementInbox'

/**
 * The organization announcement inbox.
 *
 * The organization, the role and the locations all come from the session through
 * resolveOrganizationContext. Nothing on this page reads an organization id from the URL,
 * so a crafted link cannot show another organization's announcements.
 *
 * Only announcements addressed to an open location this person is part of are rendered.
 * Closed locations are excluded at send time and again when the inbox is built. No customer
 * name, contact detail or appointment ever appears in an announcement body here: the
 * announcement itself is written by staff for staff.
 */
export default async function AnnouncementsPage() {
  const auth = await requireAuth()
  if (!auth.success) redirect('/login')

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wider text-[var(--dash-brand)]">Organization</p>
          <h1 className="mt-2 text-3xl font-bold text-foreground">Announcements</h1>
        </div>
        <div className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <p className="text-sm text-muted-foreground">
            {resolved.message ?? 'You are not a member of an organization.'} Announcements are sent between the people
            who run an organization with more than one shop. Your own shop has its own dashboard.
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

  if (!can(context.role, 'announcements.read')) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-3xl font-bold text-foreground">Announcements</h1>
        <div className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <p className="text-sm text-muted-foreground">
            Your role does not include organization announcements. Ask an organization owner if you need them.
          </p>
        </div>
      </div>
    )
  }

  const viewer = {
    userId: auth.user.id,
    organizationId: context.organizationId,
    role: context.role,
    businessIds: context.locationBusinessIds,
  }

  const inbox = await loadAnnouncementInbox(context, auth.user.id)

  // Locations the sender may address. Resolved from the session, never from the form.
  const maySend = can(context.role, 'announcements.send')
  let composeLocations: ComposeLocation[] = []
  if (maySend && context.locationBusinessIds.length > 0) {
    try {
      const rows = await prisma.organizationLocation.findMany({
        where: { organizationId: context.organizationId, businessId: { in: context.locationBusinessIds } },
        select: { businessId: true, region: true, status: true },
      })
      const open = rows.filter((row) => row.status !== 'closed')
      const businesses = open.length
        ? await prisma.business.findMany({
            where: { id: { in: open.map((row) => row.businessId) } },
            select: { id: true, name: true },
          })
        : []
      const nameById = new Map(businesses.map((business) => [business.id, business.name]))
      composeLocations = open
        .map((row) => ({
          id: row.businessId,
          name: nameById.get(row.businessId) ?? 'Location',
          region: row.region,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      composeLocations = []
    }
  }

  const regions = Array.from(
    new Set(composeLocations.map((location) => location.region).filter((region): region is string => Boolean(region))),
  ).sort((a, b) => a.localeCompare(b))

  const items: AnnouncementItemView[] = inbox.items
  const emptyCopy = emptyStateMessage(viewer, inbox.deliveredToOrganization)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-[var(--dash-brand)]">Organization</p>
        <h1 className="mt-2 text-3xl font-bold text-foreground">Announcements</h1>
        <p className="mt-2 text-muted-foreground">
          {context.organizationName}. {inbox.unread > 0 ? `${inbox.unread} new` : 'Nothing new'} for you.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {describeRole(context.role)} · Locations you can act on: {context.locationBusinessIds.length}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          These appear in the app only. No email or text message is sent.
        </p>
      </div>

      {inbox.readFailed && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-foreground"
        >
          Your read marks could not be loaded just now, so everything is shown as new. Nothing was changed.
        </p>
      )}

      <AnnouncementInbox
        items={items}
        canSend={maySend}
        locations={composeLocations}
        regions={regions}
        emptyCopy={emptyCopy}
      />

      <nav aria-label="Organization pages" className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/dashboard/organization"
          className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 font-medium text-foreground"
        >
          Locations
        </Link>
        <Link
          href="/dashboard/organization/structure"
          className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 font-medium text-foreground"
        >
          Organization structure
        </Link>
      </nav>
    </div>
  )
}

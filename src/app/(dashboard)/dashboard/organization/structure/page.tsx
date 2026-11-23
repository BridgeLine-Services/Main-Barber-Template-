export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { can, describeRole } from '@/lib/organization/capabilities'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { describeBranding, describeLocationStatus, describePricing, describeRegion, summariseStaff, summariseStructure } from '@/lib/organization/franchise-view'
import type { BrandSettingsRecord, BrandValues } from '@/lib/organization/branding'
import type { PriceException, ServiceTemplate } from '@/lib/organization/service-templates'

const TONE_CLASS: Record<string, string> = {
  open: 'border-emerald-500/30 bg-emerald-500/5',
  standard: 'border-emerald-500/30 bg-emerald-500/5',
  preparing: 'border-amber-500/30 bg-amber-500/5',
  closing: 'border-amber-500/30 bg-amber-500/5',
  exception: 'border-sky-500/30 bg-sky-500/5',
  closed: 'border-border bg-[var(--dash-surface)]',
  unset: 'border-border bg-[var(--dash-surface)]',
  unknown: 'border-border bg-[var(--dash-surface)]',
}

/**
 * The franchise overview: what this organization is made of, in one place.
 *
 * Read-only. It renders no form, no button that changes anything, and it never writes.
 * The organization, its regions and its locations come from the session through
 * resolveOrganizationContext, so a crafted link cannot widen what a person sees; a closed
 * location stays listed for the people allowed to see it, and a location outside the
 * resolved list is not loaded at all.
 *
 * Staff are counted, never named, and the location manager is shown only to roles the
 * capability system already allows to assign staff. No customer record is read here.
 */
export default async function StructurePage() {
  const auth = await requireAuth()
  if (!auth.success) redirect('/login')

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-3xl font-bold text-foreground">Organization structure</h1>
        <div className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <p className="text-sm text-muted-foreground">
            {resolved.message ?? 'This page is for organizations that run more than one shop. Your own shop dashboard is unchanged.'}
          </p>
          <Link href="/dashboard" className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-medium text-foreground">
            Go to my shop dashboard
          </Link>
        </div>
      </div>
    )
  }

  const context = resolved.context
  const seesAll = context.locationBusinessIds.length > 0
  const maySeeManagers = can(context.role, 'staff.assign')
  const now = new Date()

  const [locationRows, brandRow, templates, exceptionRows, assignments, announcementRows, managerAssignments] = await Promise.all([
    prisma.organizationLocation.findMany({
      where: { organizationId: context.organizationId, businessId: { in: context.locationBusinessIds } },
      orderBy: [{ region: 'asc' }, { createdAt: 'asc' }],
      select: { businessId: true, region: true, status: true, business: { select: { name: true } } },
    }),
    prisma.organizationBrandSettings.findUnique({ where: { organizationId: context.organizationId } }),
    prisma.organizationServiceTemplate.findMany({
      where: { organizationId: context.organizationId, active: true },
      select: { id: true, name: true, durationMinutes: true, defaultPriceCents: true },
    }),
    prisma.organizationServicePriceException.findMany({
      where: { businessId: { in: context.locationBusinessIds } },
      select: { templateId: true, businessId: true, priceCents: true, reason: true },
    }),
    prisma.staffLocationAssignment.findMany({
      where: { organizationId: context.organizationId, businessId: { in: context.locationBusinessIds } },
      select: { userId: true, businessId: true, role: true, effectiveFrom: true, effectiveTo: true },
    }),
    prisma.organizationAnnouncement.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { title: true, audienceType: true, audienceValues: true, publishedAt: true, createdAt: true },
    }),
    maySeeManagers
      ? prisma.staffLocationAssignment.findMany({
          where: { organizationId: context.organizationId, role: 'LOCATION_MANAGER' },
          select: { businessId: true, userId: true },
        })
      : Promise.resolve([] as Array<{ businessId: string; userId: string }>),
  ])

  // Only the manager's name, and only for roles that may already assign staff.
  const managerIds = [...new Set(managerAssignments.map((row) => row.userId))]
  const managers = maySeeManagers && managerIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: managerIds } }, select: { id: true, name: true } })
    : []
  const managerNameById = new Map(managers.map((person) => [person.id, person.name ?? 'Unnamed person']))
  const managerByBusiness = new Map<string, string>()
  for (const row of managerAssignments) {
    const name = managerNameById.get(row.userId)
    if (name && !managerByBusiness.has(row.businessId)) managerByBusiness.set(row.businessId, name)
  }

  const settings: BrandSettingsRecord | null = brandRow
    ? {
        logoUrl: brandRow.logoUrl,
        primaryColor: brandRow.primaryColor,
        accentColor: brandRow.accentColor,
        brandGuidelinesUrl: brandRow.brandGuidelinesUrl,
        allowedOverrides: brandRow.allowedOverrides as Array<keyof BrandValues>,
      }
    : null
  const templateList = templates as ServiceTemplate[]
  const exceptionList = exceptionRows as PriceException[]
  const regions = [...new Set(locationRows.map((row) => row.region).filter((region): region is string => Boolean(region)))]

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-[var(--dash-brand)]">Organization</p>
        <h1 className="mt-2 text-3xl font-bold text-foreground">{context.organizationName}</h1>
        <p className="mt-2 text-muted-foreground">{summariseStructure({ organizationName: context.organizationName, locations: locationRows, regions })}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          You are here as {describeRole(context.role)}. This page only looks. Nothing here changes a shop, a price or a person.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/dashboard/organization" className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-medium text-foreground">
            Totals and money
          </Link>
          <Link href="/dashboard/organization/people" className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-medium text-foreground">
            People and access
          </Link>
        </div>
      </div>

      {!seesAll && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
          <p className="text-sm text-foreground">No locations are assigned to you yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">An organization owner can assign you to a location. Nothing is shown here until then.</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {locationRows.map((row) => {
          const status = describeLocationStatus(row.status)
          const brand = describeBranding(settings, null)
          const price = describePricing(templateList, exceptionList, row.businessId)
          const staff = summariseStaff(assignments, row.businessId, now)
          const manager = maySeeManagers ? managerByBusiness.get(row.businessId) ?? 'No location manager assigned' : 'Not shown for your role'
          return (
            <section key={row.businessId} className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
              <h2 className="text-lg font-semibold text-foreground">{row.business.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{describeRegion(row.region)}</p>
              <div className={`mt-3 rounded-lg border p-3 ${TONE_CLASS[status.tone]}`}>
                <p className="text-sm font-medium text-foreground">{status.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{status.detail}</p>
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <div>
                  <dt className="font-medium text-foreground">Branding</dt>
                  <dd className="text-muted-foreground">{brand.label}. {brand.detail}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Service prices</dt>
                  <dd className="text-muted-foreground">{price.label}. {price.detail}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Staff</dt>
                  <dd className="text-muted-foreground">{staff.label}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">Location manager</dt>
                  <dd className="text-muted-foreground">{manager}</dd>
                </div>
              </dl>
            </section>
          )
        })}
      </div>

      <section aria-labelledby="announcements" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
        <h2 id="announcements" className="text-lg font-semibold text-foreground">Announcements</h2>
        {announcementRows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing has been written yet. Announcements appear here once someone drafts one.</p>
        ) : (
          <ul className="mt-3 space-y-3 text-sm">
            {announcementRows.map((row) => {
              const published = row.publishedAt ? `Sent on ${new Date(row.publishedAt).toISOString().slice(0, 10)}` : 'Draft, not sent'
              const audience = row.audienceType === 'all' ? 'everyone in the organization' : row.audienceValues.join(', ') || 'no audience set'
              return (
                <li key={`${row.title}-${row.createdAt.toString()}`} className="rounded-lg border border-border p-3">
                  <p className="font-medium text-foreground">{row.title}</p>
                  <p className="text-muted-foreground">{published}. For {audience}.</p>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        This page never shows a customer, a customer&apos;s contact details or an appointment history. Corporate roles see totals and settings only.
      </p>
    </div>
  )
}

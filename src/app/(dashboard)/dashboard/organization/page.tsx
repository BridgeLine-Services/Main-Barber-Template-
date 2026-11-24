export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth-helpers'
import { can, describeRole } from '@/lib/organization/capabilities'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { aggregateOnlyGuard } from '@/lib/organization/privacy'
import { buildOrganizationReport } from '@/lib/organization/reporting'
import { loadLocationRefs, loadLocationRollup } from '@/lib/organization/report-query'
import { loadManagedLocations } from '@/lib/organization/location-service'
import { regionNames, statusCounts } from '@/lib/organization/location-management'
import {
  RANGE_OPTIONS,
  UNVERIFIED,
  describeLocationStatus,
  describeOrganizationHeadline,
  locationViews,
  noOrganizationCopy,
  summaryMetrics,
  unverifiedNotice,
} from '@/lib/organization/dashboard-view'

const MAX_DAYS = 365

function rangeDays(raw: string | string[] | undefined): number {
  const requested = Number(Array.isArray(raw) ? raw[0] : raw ?? '30')
  if (!Number.isFinite(requested)) return 30
  return Math.min(MAX_DAYS, Math.max(1, Math.round(requested)))
}

/**
 * The organization overview: every location this person may see, and the totals for them.
 *
 * Read-only by construction. It renders no form, no button that changes anything, and it
 * never writes. The organization comes from the session through resolveOrganizationContext,
 * never from the URL, so a crafted link cannot widen what a person sees. The report is
 * aggregate-only, and aggregateOnlyGuard is run over it here as well as in the API: a
 * payload that somehow contained a customer identity would be withheld rather than shown.
 */
export default async function OrganizationOverviewPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const auth = await requireAuth()
  if (!auth.success) redirect('/login')

  const params = (await searchParams) ?? {}
  const days = rangeDays(params.days)

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wider text-[var(--dash-brand)]">Organization</p>
          <h1 className="mt-2 text-3xl font-bold text-foreground">Locations you can manage</h1>
        </div>
        <div className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <p className="text-sm text-muted-foreground">{noOrganizationCopy(resolved.reason)}</p>
          <a
            href="/dashboard"
            className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-medium text-foreground"
          >
            Go to my shop dashboard
          </a>
        </div>
      </div>
    )
  }

  const context = resolved.context
  const canSeeReports = can(context.role, 'reporting.aggregate.read')

  const end = new Date()
  const start = new Date(end.getTime() - days * 86_400_000)
  const rangeLabel = `the last ${days} day${days === 1 ? '' : 's'}`

  const refs = await loadLocationRefs(context.locationBusinessIds)

  let management: { counts: ReturnType<typeof statusCounts>; regions: string[] } | null = null
  try {
    const managed = await loadManagedLocations(context)
    management = { counts: statusCounts(managed), regions: regionNames(managed) }
  } catch {
    // A failed read shows "Could not check" rather than a confident zero.
    management = null
  }
  const rollups = canSeeReports ? await Promise.all(refs.map((ref) => loadLocationRollup(ref, { start, end, label: rangeLabel }))) : []
  const report = canSeeReports
    ? buildOrganizationReport(context.organizationId, rollups, {
        generatedAt: new Date().toISOString(),
        rangeLabel,
      })
    : null

  const guard = report ? aggregateOnlyGuard(report) : { safe: true as const }
  if (report && !guard.safe) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-3xl font-bold text-foreground">Locations you can manage</h1>
        <div className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <p className="text-sm text-muted-foreground">
            This report was withheld because it contained more than totals. Nothing has been shown rather than risk
            showing a customer&apos;s details.
          </p>
        </div>
      </div>
    )
  }

  const metrics = report ? summaryMetrics(report) : []
  const locations = report ? locationViews(report) : []
  const notice = report ? unverifiedNotice(report) : null

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-[var(--dash-brand)]">Organization</p>
        <h1 className="mt-2 text-3xl font-bold text-foreground">{context.organizationName}</h1>
        <p className="mt-2 text-muted-foreground">
          {report ? describeOrganizationHeadline(report, context.locationBusinessIds.length) : 'You can see the locations below.'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {describeRole(context.role)} · Locations you can manage: {context.locationBusinessIds.length}
          {context.regions.length > 0 ? ` · Regions: ${context.regions.join(', ')}` : ''}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          This page only looks. Nothing here changes a booking, a shop or a person.
        </p>
      </div>

      {canSeeReports ? (
        <nav aria-label="Reporting period" className="flex flex-wrap gap-2">
          {RANGE_OPTIONS.map((option) => {
            const current = option.days === days
            return (
              <a
                key={option.days}
                href={option.href}
                aria-current={current ? 'true' : undefined}
                className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium ${
                  current
                    ? 'border-[var(--dash-brand)] text-foreground'
                    : 'border-border text-muted-foreground'
                }`}
              >
                {option.label}
              </a>
            )
          })}
        </nav>
      ) : (
        <p className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 text-sm text-muted-foreground">
          Your role can see which locations exist but not their numbers. Ask an organization owner if you need the
          figures.
        </p>
      )}

      {notice && (
        <section aria-labelledby="unverified" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <h2 id="unverified" className="text-lg font-semibold text-foreground">
            What we could not check
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{notice}</p>
        </section>
      )}

      {report && (
        <section aria-labelledby="totals" className="space-y-3">
          <h2 id="totals" className="text-lg font-semibold text-foreground">
            All your locations together
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.map((item) => (
              <div key={item.key} className="rounded-xl border border-border bg-[var(--dash-surface)] p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
                <p
                  className={`mt-1 text-2xl font-semibold ${
                    item.unverified ? 'text-muted-foreground' : 'text-foreground'
                  }`}
                >
                  {item.value}
                </p>
                {item.unverified && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    At least one location could not be read, so this total is not shown.
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Totals cover {report.rangeLabel}. A figure that any location could not supply is left blank rather than
            counted as zero.
          </p>
        </section>
      )}

      <section aria-labelledby="locations" className="space-y-3">
        <h2 id="locations" className="text-lg font-semibold text-foreground">
          Each location
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {locations.map((location) => (
            <li key={location.businessId} className="rounded-xl border border-border bg-[var(--dash-surface)] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-foreground">{location.name}</p>
                <p className="text-xs text-muted-foreground">{location.statusLabel}</p>
              </div>
              {location.region && <p className="text-xs text-muted-foreground">{location.region}</p>}
              <dl className="mt-3 space-y-1 text-sm">
                {location.metrics.map((item) => (
                  <div key={item.key} className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">{item.label}</dt>
                    <dd className={item.unverified ? 'text-muted-foreground' : 'font-medium text-foreground'}>
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
              {location.hasUnverifiedFigures && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Some figures here could not be read. They are marked {UNVERIFIED} instead of being shown as zero.
                </p>
              )}
            </li>
          ))}
        </ul>
        {locations.length === 0 && (
          <p className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 text-sm text-muted-foreground">
            {refs.length === 0
              ? 'No locations are assigned to you yet. Whoever manages your access can add them.'
              : 'Location figures could not be read just now. This is not a statement that your shops took nothing.'}
          </p>
        )}
      </section>

      {report && report.notes.length > 0 && (
        <section aria-labelledby="notes" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <h2 id="notes" className="text-lg font-semibold text-foreground">
            How to read these numbers
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {report.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="manage" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
        <h2 id="manage" className="text-lg font-semibold text-foreground">Manage the organization</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything below is a screen of its own. Each one checks what you may do when it loads, so a link is never
          the permission.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Locations', value: management ? String(management.counts.total) : 'Could not check' },
            { label: 'Open', value: management ? String(management.counts.active) : 'Could not check' },
            { label: 'Being set up', value: management ? String(management.counts.onboarding) : 'Could not check' },
            { label: 'Regions', value: management ? String(management.regions.length) : 'Could not check' },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd className="mt-1 text-lg font-semibold text-foreground">{item.value}</dd>
            </div>
          ))}
        </dl>
        <nav aria-label="Organization management" className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            { href: '/dashboard/organization/locations', label: 'Shop locations', blurb: 'Add a shop, change its details, open it or start closing it.' },
            { href: '/dashboard/organization/assignments', label: 'Employees and assignments', blurb: 'Who works where, from when to when, and the history of it.' },
            { href: '/dashboard/organization/regions', label: 'Regions', blurb: 'Group shops and see who looks after each region.' },
            { href: '/dashboard/organization/people', label: 'People and access', blurb: 'Invite people and set what their role may do.' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg border border-border p-3 hover:bg-[var(--dash-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block text-sm font-medium text-foreground">{item.label}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{item.blurb}</span>
            </Link>
          ))}
        </nav>
      </section>

      <p className="text-xs text-muted-foreground">
        No customer names, contact details or appointment histories appear on this page. It shows totals only.
        {' '}Last updated {report ? new Date(report.generatedAt).toLocaleString('en-US') : 'not available'}.
      </p>

      <p className="text-xs text-muted-foreground">
        Status words used above: {describeLocationStatus('ACTIVE')} means the shop is taking bookings online;{' '}
        {describeLocationStatus('INACTIVE')} means it is not.
      </p>
    </div>
  )
}

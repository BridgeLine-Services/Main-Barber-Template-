export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth-helpers'
import { can, describeRole } from '@/lib/organization/capabilities'
import { loadManagedLocations } from '@/lib/organization/location-service'
import { statusCounts } from '@/lib/organization/location-management'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { describeLocationStatus } from '@/lib/organization/franchise-view'

const STATUS_ORDER = ['onboarding', 'active', 'closing', 'closed']

export default async function LocationsPage() {
  const auth = await requireAuth().catch(() => null)
  if (!auth?.success) redirect('/login')
  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-3xl font-bold text-foreground">Locations</h1>
        <p className="rounded-xl border border-border bg-[var(--dash-surface)] p-5 text-sm text-muted-foreground">
          Your shop is not part of an organization, so there are no locations to manage here. Everything about your
          own shop lives in the rest of the dashboard.
        </p>
      </div>
    )
  }

  const context = resolved.context
  if (!can(context.role, 'locations.read')) redirect('/dashboard')

  let locations: Awaited<ReturnType<typeof loadManagedLocations>> = []
  let readFailed = false
  try {
    locations = await loadManagedLocations(context)
  } catch {
    readFailed = true
  }

  const counts = statusCounts(locations)
  const canManage = can(context.role, 'locations.manage')

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wider text-[var(--dash-brand)]">Organization</p>
          <h1 className="mt-2 text-3xl font-bold text-foreground">Locations</h1>
          <p className="mt-2 text-muted-foreground">
            {counts.total === 0
              ? 'No locations yet. Add the first one and it will stay in onboarding until you are ready to open it.'
              : `${counts.total} location${counts.total === 1 ? '' : 's'}: ${counts.active} open, ${counts.onboarding} being set up, ${counts.closing} closing, ${counts.closed} closed.`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{describeRole(context.role)}</p>
        </div>
        {canManage && (
          <Link
            href="/dashboard/organization/locations/new"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Add a location
          </Link>
        )}
      </div>

      {readFailed && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-foreground" role="status">
          Your locations could not be read just now. This is not a statement that you have none. Try again in a moment.
        </p>
      )}

      {!readFailed && locations.length === 0 && (
        <div className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <h2 className="text-sm font-semibold text-foreground">Nothing here yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            A location is one shop: its own calendar, its own staff, its own services. Adding one takes about five
            minutes and it will not take bookings until you open it.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {locations
          .slice()
          .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.name.localeCompare(b.name))
          .map((location) => {
            const status = describeLocationStatus(location.status)
            return (
              <li key={location.businessId} className="rounded-xl border border-border bg-[var(--dash-surface)] p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="break-words text-base font-semibold text-foreground">{location.name}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {location.region ? location.region : 'No region set'}
                      {location.city ? ` · ${location.city}` : ''}
                      {location.state ? `, ${location.state}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{status.label}</p>
                  </div>
                  <Link
                    href={`/dashboard/organization/locations/${location.businessId}`}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-input px-3 text-sm"
                  >
                    Manage
                  </Link>
                </div>
                <dl className="mt-3 grid grid-cols-1 gap-1 text-xs sm:grid-cols-3">
                  <div className="flex items-baseline justify-between gap-2 sm:block">
                    <dt className="text-muted-foreground">Brand</dt>
                    <dd className={location.readiness.brandSet ? 'text-foreground' : 'text-amber-600'}>
                      {location.readiness.brandSet ? 'Set' : 'Not set'}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 sm:block">
                    <dt className="text-muted-foreground">Services</dt>
                    <dd className={location.readiness.servicesSet ? 'text-foreground' : 'text-amber-600'}>
                      {location.readiness.servicesSet ? 'Ready' : 'None yet'}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 sm:block">
                    <dt className="text-muted-foreground">Manager</dt>
                    <dd className={location.readiness.managerAssigned ? 'text-foreground' : 'text-amber-600'}>
                      {location.readiness.managerAssigned ? 'Appointed' : 'Nobody yet'}
                    </dd>
                  </div>
                </dl>
              </li>
            )
          })}
      </ul>

      <nav aria-label="Other organization screens" className="flex flex-wrap gap-2 text-sm">
        <Link className="min-h-11 rounded-md border border-input px-3 py-2" href="/dashboard/organization">
          Organization overview
        </Link>
        <Link className="min-h-11 rounded-md border border-input px-3 py-2" href="/dashboard/organization/assignments">
          Employees and assignments
        </Link>
        <Link className="min-h-11 rounded-md border border-input px-3 py-2" href="/dashboard/organization/regions">
          Regions
        </Link>
      </nav>
    </div>
  )
}

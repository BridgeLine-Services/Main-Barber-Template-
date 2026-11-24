export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth-helpers'
import { can } from '@/lib/organization/capabilities'
import { loadManagedLocations } from '@/lib/organization/location-service'
import { regionNames } from '@/lib/organization/location-management'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { LocationWizard } from '@/components/organization/LocationWizard'

export default async function NewLocationPage() {
  const auth = await requireAuth().catch(() => null)
  if (!auth?.success) redirect('/login')
  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) redirect('/dashboard/organization/locations')
  if (!can(resolved.context.role, 'locations.manage')) redirect('/dashboard/organization/locations')

  let locations: Awaited<ReturnType<typeof loadManagedLocations>> = []
  try {
    locations = await loadManagedLocations(resolved.context)
  } catch {
    locations = []
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-[var(--dash-brand)]">Organization</p>
        <h1 className="mt-2 text-3xl font-bold text-foreground">Add a location</h1>
        <p className="mt-2 text-muted-foreground">
          This takes a few minutes. The shop is created in onboarding, so nothing is bookable until you open it at the
          end.
        </p>
      </div>
      <LocationWizard
        regions={regionNames(locations)}
        existingNames={locations.map((row) => row.name)}
        defaultTimezone={Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles'}
      />
    </div>
  )
}

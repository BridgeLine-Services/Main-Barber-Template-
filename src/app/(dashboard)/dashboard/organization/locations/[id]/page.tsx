export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth-helpers'
import { can, describeRole } from '@/lib/organization/capabilities'
import { loadClosureReview, loadManagedLocations } from '@/lib/organization/location-service'
import { activationVerdict, closingSteps, openingSteps, reopenGuidance } from '@/lib/organization/location-management'
import { regionNames } from '@/lib/organization/location-management'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { describeLocationStatus } from '@/lib/organization/franchise-view'
import { LocationDetail } from '@/components/organization/LocationDetail'

export default async function LocationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth().catch(() => null)
  if (!auth?.success) redirect('/login')
  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) redirect('/dashboard/organization/locations')
  if (!can(resolved.context.role, 'locations.read')) redirect('/dashboard')

  const { id } = await params
  let locations: Awaited<ReturnType<typeof loadManagedLocations>> = []
  try {
    locations = await loadManagedLocations(resolved.context)
  } catch {
    locations = []
  }
  const location = locations.find((row) => row.businessId === id)
  if (!location) notFound()

  const canManage = can(resolved.context.role, 'locations.manage')
  const verdict = activationVerdict(location, location.readiness)
  const status = describeLocationStatus(location.status)
  const review = location.status === 'closing' || location.status === 'active'
    ? await loadClosureReview(resolved.context, location.businessId, false).catch(() => null)
    : null

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/dashboard/organization/locations" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          Back to locations
        </Link>
        <h1 className="mt-2 break-words text-3xl font-bold text-foreground">{location.name}</h1>
        <p className="mt-1 text-muted-foreground">
          {status.label}. {status.detail}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {location.region ? location.region : 'No region set'} · {location.timezone} · {describeRole(resolved.context.role)}
        </p>
      </div>

      <LocationDetail
        location={location}
        canManage={canManage}
        regions={regionNames(locations)}
        activation={verdict}
        openingSteps={openingSteps()}
        closingSteps={closingSteps()}
        reopen={reopenGuidance(location.status)}
        closureReview={review}
      />
    </div>
  )
}

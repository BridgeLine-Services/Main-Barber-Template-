import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { can, describeRole } from '@/lib/organization/capabilities'
import { createLocation, loadManagedLocations } from '@/lib/organization/location-service'
import { regionNames, statusCounts } from '@/lib/organization/location-management'
import { resolveOrganizationContext } from '@/lib/organization/resolve'

export const dynamic = 'force-dynamic'

/**
 * Locations this person may act on.
 *
 * The organization and the location list come from the session through
 * resolveOrganizationContext. There is no organization id or business id in the request
 * that could point this at somebody else's shops.
 */
export async function GET() {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ organization: null, locations: [], regions: [], counts: null, canManage: false })
  }
  const context = resolved.context

  let locations = []
  let readFailed = false
  try {
    locations = await loadManagedLocations(context)
  } catch (error) {
    console.error('locations list failed:', error)
    readFailed = true
  }

  return NextResponse.json({
    organization: { id: context.organizationId, name: context.organizationName, role: context.role, roleDescription: describeRole(context.role) },
    locations,
    regions: regionNames(locations),
    counts: statusCounts(locations),
    canManage: can(context.role, 'locations.manage'),
    readFailed,
  })
}

/** Adding a location. Always lands in onboarding, never straight to taking bookings. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: 'You are not a member of an organization.' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'The request could not be read.' }, { status: 400 })
  }

  const result = await createLocation(resolved.context, auth.user.id, {
    name: typeof body.name === 'string' ? body.name : '',
    email: typeof body.email === 'string' ? body.email : null,
    phone: typeof body.phone === 'string' ? body.phone : null,
    address: typeof body.address === 'string' ? body.address : null,
    city: typeof body.city === 'string' ? body.city : null,
    state: typeof body.state === 'string' ? body.state : null,
    zipCode: typeof body.zipCode === 'string' ? body.zipCode : null,
    timezone: typeof body.timezone === 'string' ? body.timezone : '',
    region: typeof body.region === 'string' ? body.region : null,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error, reasons: result.reasons }, { status: result.status })
  }
  return NextResponse.json({ success: true, location: result.value })
}

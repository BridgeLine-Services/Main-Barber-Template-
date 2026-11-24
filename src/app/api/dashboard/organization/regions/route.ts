import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { can } from '@/lib/organization/capabilities'
import { loadManagedLocations, renameRegion } from '@/lib/organization/location-service'
import { regionNames } from '@/lib/organization/location-management'
import { resolveOrganizationContext } from '@/lib/organization/resolve'

export const dynamic = 'force-dynamic'

/**
 * Regions.
 *
 * A region is a name that locations share, not a separate record, so a region exists while
 * at least one location is in it. Renaming one moves every location in it in a single
 * transaction and records the change. Creating one happens by assigning a location to a new
 * name, which is why there is no create endpoint to get wrong.
 */
export async function GET() {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) return NextResponse.json({ regions: [], canManage: false })

  try {
    const locations = await loadManagedLocations(resolved.context)
    return NextResponse.json({
      regions: regionNames(locations),
      locations: locations.map((row) => ({
        businessId: row.businessId,
        name: row.name,
        region: row.region,
        status: row.status,
      })),
      canManage: can(resolved.context.role, 'locations.manage'),
    })
  } catch (error) {
    console.error('regions list failed:', error)
    return NextResponse.json({ regions: [], canManage: false, readFailed: true })
  }
}

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

  const from = typeof body.from === 'string' ? body.from : ''
  const to = typeof body.to === 'string' ? body.to : ''
  const result = await renameRegion(resolved.context, auth.user.id, from, to)
  if (!result.ok) return NextResponse.json({ error: result.error, reasons: result.reasons }, { status: result.status })
  return NextResponse.json({ success: true, affected: result.value?.affectedBusinessIds.length ?? 0 })
}

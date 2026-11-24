import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { can } from '@/lib/organization/capabilities'
import { loadClosureReview, transitionLocation, updateLocation } from '@/lib/organization/location-service'
import { resolveOrganizationContext } from '@/lib/organization/resolve'

export const dynamic = 'force-dynamic'

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Changing one location, and moving it through its lifecycle.
 *
 * The id in the URL is only ever used to look a location up inside the organization the
 * session resolved, so another organization's shop answers 404 rather than being editable.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params
  const result = await updateLocation(resolved.context, auth.user.id, id, {
    name: str(body.name) ?? '',
    email: str(body.email),
    phone: str(body.phone),
    address: str(body.address),
    city: str(body.city),
    state: str(body.state),
    zipCode: str(body.zipCode),
    timezone: str(body.timezone) ?? '',
    region: str(body.region),
  })

  if (!result.ok) return NextResponse.json({ error: result.error, reasons: result.reasons }, { status: result.status })
  return NextResponse.json({ success: true })
}

/**
 * Lifecycle actions: activate, start-closing, close.
 *
 * Every prerequisite is checked here, on the server, before the write. The checklist on the
 * screen explains the same rules; it is not what enforces them.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: 'You are not a member of an organization.' }, { status: 403 })
  }
  if (!can(resolved.context.role, 'locations.manage')) {
    return NextResponse.json({ error: 'Your role cannot change a location\u2019s status.' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'The request could not be read.' }, { status: 400 })
  }

  const { id } = await params
  const action = str(body.action)
  if (action === 'review-closure') {
    const review = await loadClosureReview(resolved.context, id, Boolean(body.recordsExported))
    if (!review) return NextResponse.json({ error: 'That location could not be found.' }, { status: 404 })
    return NextResponse.json({ review })
  }

  if (action !== 'activate' && action !== 'start-closing' && action !== 'close') {
    return NextResponse.json({ error: 'That action is not recognised.' }, { status: 400 })
  }

  const result = await transitionLocation(resolved.context, auth.user.id, id, {
    action,
    recordsExported: Boolean(body.recordsExported),
  })

  if (!result.ok) return NextResponse.json({ error: result.error, reasons: result.reasons }, { status: result.status })
  return NextResponse.json({ success: true, status: result.value?.status })
}

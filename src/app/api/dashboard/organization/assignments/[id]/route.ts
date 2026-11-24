import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { can } from '@/lib/organization/capabilities'
import { endAssignment, transferAssignment } from '@/lib/organization/assignment-service'
import { resolveOrganizationContext } from '@/lib/organization/resolve'

export const dynamic = 'force-dynamic'

/** Ending an assignment. It sets an end date; the row and its history stay. */
export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: 'You are not a member of an organization.' }, { status: 403 })
  }

  const { id } = await params
  const result = await endAssignment(resolved.context, auth.user.id, id)
  if (!result.ok) return NextResponse.json({ error: result.errors[0], reasons: result.errors }, { status: result.status })
  return NextResponse.json({ success: true })
}

/**
 * Moving somebody to another location.
 *
 * One transaction ends the old assignment on the transfer date and starts the new one, so
 * there is no moment where the person has no history and no moment where they hold two
 * active assignments at the same shop.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: 'You are not a member of an organization.' }, { status: 403 })
  }
  if (!can(resolved.context.role, 'staff.assign')) {
    return NextResponse.json({ error: 'Your role cannot move people between locations.' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'The request could not be read.' }, { status: 400 })
  }

  const destination = typeof body.destinationBusinessId === 'string' ? body.destinationBusinessId : ''
  const effectiveFrom = typeof body.effectiveFrom === 'string' ? body.effectiveFrom : ''
  if (!destination || !effectiveFrom) {
    return NextResponse.json({ error: 'Choose the destination location and the date the transfer takes effect.' }, { status: 400 })
  }

  const { id } = await params
  const result = await transferAssignment(resolved.context, auth.user.id, id, destination, effectiveFrom)
  if (!result.ok) {
    return NextResponse.json({ error: result.errors[0], reasons: result.errors }, { status: result.status })
  }
  return NextResponse.json({ success: true, explanation: result.explanation })
}

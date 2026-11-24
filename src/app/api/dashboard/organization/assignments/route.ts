import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { can } from '@/lib/organization/capabilities'
import { createAssignment, loadAssignments, loadLocationStates } from '@/lib/organization/assignment-service'
import { resolveOrganizationContext } from '@/lib/organization/resolve'

export const dynamic = 'force-dynamic'

/**
 * Who works where.
 *
 * Only assignments at the locations this session resolved are returned, so a regional
 * manager sees their own region and nothing else. The organization is never taken from the
 * request.
 */
export async function GET() {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ assignments: [], locations: [], canAssign: false })
  }

  try {
    const [assignments, locations] = await Promise.all([
      loadAssignments(resolved.context),
      loadLocationStates(resolved.context),
    ])
    return NextResponse.json({
      assignments,
      locations: locations.filter((row) => row.status !== 'closed'),
      canAssign: can(resolved.context.role, 'staff.assign'),
    })
  } catch (error) {
    console.error('assignments list failed:', error)
    return NextResponse.json({ assignments: [], locations: [], canAssign: false, readFailed: true })
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

  const result = await createAssignment(resolved.context, auth.user.id, {
    userId: typeof body.userId === 'string' ? body.userId : '',
    businessId: typeof body.businessId === 'string' ? body.businessId : '',
    role: typeof body.role === 'string' ? body.role : '',
    effectiveFrom: typeof body.effectiveFrom === 'string' ? body.effectiveFrom : '',
    effectiveTo: typeof body.effectiveTo === 'string' ? body.effectiveTo : null,
  })

  if (!result.ok) return NextResponse.json({ error: result.errors[0], reasons: result.errors }, { status: result.status })
  return NextResponse.json({ success: true, assignment: result.value })
}

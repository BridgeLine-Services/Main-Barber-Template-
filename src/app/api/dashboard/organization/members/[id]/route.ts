import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { changeMemberRole, setMemberStatus, type MemberRole } from '@/lib/organization/invitations'

export const dynamic = 'force-dynamic'

/** Change one member's role, or suspend and restore their access. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response
  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: 'You are not a member of an organization.' }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'The change could not be read.' }, { status: 400 })
  }
  const { role, status } = body as { role?: unknown; status?: unknown }
  const { id } = await params

  if (role !== undefined) {
    if (typeof role !== 'string') {
      return NextResponse.json({ error: 'Choose one of the offered roles.' }, { status: 400 })
    }
    const result = await changeMemberRole({
      context: resolved.context,
      memberId: id,
      role: role as MemberRole,
      actorId: auth.user.id,
    })
    if (!result.ok) {
      const code = result.reason === 'not-permitted' || result.reason === 'role-not-grantable' ? 403 : 400
      return NextResponse.json({ error: result.error, reason: result.reason }, { status: code })
    }
    return NextResponse.json({ success: true })
  }

  if (status !== undefined) {
    if (status !== 'ACTIVE' && status !== 'SUSPENDED') {
      return NextResponse.json({ error: 'Access can only be suspended or restored.' }, { status: 400 })
    }
    const result = await setMemberStatus({ context: resolved.context, memberId: id, status, actorId: auth.user.id })
    if (!result.ok) {
      const code = result.reason === 'not-permitted' ? 403 : 400
      return NextResponse.json({ error: result.error, reason: result.reason }, { status: code })
    }
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
}

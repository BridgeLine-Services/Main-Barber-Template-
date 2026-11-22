import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { acceptOrganizationInvitation } from '@/lib/organization/invitations'

export const dynamic = 'force-dynamic'

/**
 * Accept an organization invitation as the signed-in person.
 *
 * The token is the link; the session's email is the identity. Both must agree, so a
 * forwarded link cannot be claimed by whoever receives it.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const body = await req.json().catch(() => null)
  const token = body && typeof body === 'object' ? (body as { token?: unknown }).token : undefined
  if (typeof token !== 'string' || token.length < 16) {
    return NextResponse.json({ error: 'This invitation link is incomplete.' }, { status: 400 })
  }

  const result = await acceptOrganizationInvitation({
    token,
    userEmail: auth.user.email ?? null,
    userId: auth.user.id,
  })

  if (!result.ok) {
    const status = result.reason === 'wrong-email' ? 403 : 400
    return NextResponse.json({ error: result.error, reason: result.reason }, { status })
  }
  return NextResponse.json({ success: true, organizationId: result.value?.organizationId, role: result.value?.role })
}

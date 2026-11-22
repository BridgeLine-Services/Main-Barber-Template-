import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { cancelOrganizationInvitation, resendOrganizationInvitation } from '@/lib/organization/invitations'

export const dynamic = 'force-dynamic'

/** Cancel (DELETE) or resend (POST) one pending invitation. Scoped to the caller's organization. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response
  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: 'You are not a member of an organization.' }, { status: 403 })
  }
  const { id } = await params
  const result = await cancelOrganizationInvitation({ context: resolved.context, invitationId: id, actorId: auth.user.id })
  if (!result.ok) {
    const status = result.reason === 'not-permitted' ? 403 : 404
    return NextResponse.json({ error: result.error, reason: result.reason }, { status })
  }
  return NextResponse.json({ success: true })
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response
  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: 'You are not a member of an organization.' }, { status: 403 })
  }
  const { id } = await params
  const result = await resendOrganizationInvitation({ context: resolved.context, invitationId: id, actorId: auth.user.id })
  if (!result.ok) {
    const status = result.reason === 'not-permitted' || result.reason === 'role-not-grantable' ? 403 : 400
    return NextResponse.json({ error: result.error, reason: result.reason }, { status })
  }
  return NextResponse.json({
    success: true,
    expiresAt: result.value?.expiresAt?.toISOString(),
    acceptPath: `/accept-organization-invitation?token=${result.value?.token}`,
    delivery: 'not-sent',
    deliveryNote: 'No email was sent. Copy the link and give it to the person directly.',
  })
}

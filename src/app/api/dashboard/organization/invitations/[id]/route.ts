import { NextRequest, NextResponse } from 'next/server'
import { scheduleInvitationDelivery } from '@/lib/organization/schedule-invitation-delivery'
import { requireAuth } from '@/lib/auth-helpers'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { cancelOrganizationInvitation, resendOrganizationInvitation } from '@/lib/organization/invitations'
import {
  invalidateQueuedOrganizationInvitationEmails,
  queueOrganizationInvitationEmail,
} from '@/lib/organization/invitation-delivery'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
  await invalidateQueuedOrganizationInvitationEmails(id, 'This invitation was cancelled before its email was sent.')
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
  const invitation = result.value!
  await invalidateQueuedOrganizationInvitationEmails(id, 'This invitation link was replaced before delivery.')
  let delivery: Awaited<ReturnType<typeof queueOrganizationInvitationEmail>>
  try {
    delivery = await queueOrganizationInvitationEmail({
      invitationId: invitation.id,
      recipient: invitation.email,
      token: invitation.token,
    })
  } catch {
    delivery = { queued: false, state: 'failed', message: 'Email could not be queued. Copy the invitation link and share it directly.' }
  }

  if ((delivery.state === 'queued' || delivery.state === 'retry-scheduled') && delivery.notificationId) {
    scheduleInvitationDelivery(delivery.notificationId)
  }

  return NextResponse.json({
    success: true,
    expiresAt: invitation.expiresAt.toISOString(),
    delivery: delivery.state,
    deliveryNote: delivery.message ?? 'A fresh invitation email is queued. The previous link no longer works.',
    ...(!delivery.queued ? { acceptPath: `/accept-organization-invitation?token=${encodeURIComponent(invitation.token)}` } : {}),
  })
}

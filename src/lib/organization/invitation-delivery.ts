import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { getAbsoluteUrl } from '@/lib/app-url'
import { emailConfigurationIssue } from '@/lib/notifications'
import { hashInvitationToken } from '@/lib/organization/invitations'

const ALGORITHM = 'aes-256-gcm'
const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_SALT = Buffer.from('organization-invitation-delivery-v1')
const KEY_INFO = Buffer.from('encrypted-notification-payload')
const MAX_ATTEMPTS = 4
const RETRY_DELAYS_MINUTES = [1, 5, 15]
const INVITATION_PREFIX = 'organization-invitation:'

type InvitationPayload = {
  invitationId: string
  recipient: string
  token: string
}

export type OrganizationInvitationEmail = {
  to: string
  subject: string
  text: string
  html: string
}

function getPayloadKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('Invitation email encryption is unavailable because NEXTAUTH_SECRET is missing.')
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), KEY_SALT, KEY_INFO, 32))
}

function encryptPayload(payload: InvitationPayload): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, getPayloadKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':')
}

function decryptPayload(value: string): InvitationPayload {
  const [version, ivValue, tagValue, ciphertextValue, extra] = value.split(':')
  const iv = Buffer.from(ivValue || '', 'base64')
  const tag = Buffer.from(tagValue || '', 'base64')
  if (version !== VERSION || extra !== undefined || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Invitation email payload is invalid.')
  }
  const decipher = createDecipheriv(ALGORITHM, getPayloadKey(), iv)
  decipher.setAuthTag(tag)
  const cleartext = Buffer.concat([decipher.update(Buffer.from(ciphertextValue || '', 'base64')), decipher.final()]).toString('utf8')
  const payload = JSON.parse(cleartext) as Partial<InvitationPayload>
  if (typeof payload.invitationId !== 'string' || typeof payload.recipient !== 'string' || typeof payload.token !== 'string') {
    throw new Error('Invitation email payload is invalid.')
  }
  return payload as InvitationPayload
}

export function invitationDeliveryKey(invitationId: string, tokenHash: string): string {
  return `${INVITATION_PREFIX}${invitationId}:${tokenHash}`
}

/** Records either a queued delivery or an explicit configuration failure. Token material is encrypted while queued. */
export async function queueOrganizationInvitationEmail(input: {
  invitationId: string
  recipient: string
  token: string
}): Promise<{ queued: boolean; state: 'queued' | 'sending' | 'sent' | 'retry-scheduled' | 'failed'; message: string | null; notificationId?: string }> {
  const recipient = input.recipient.trim().toLowerCase()
  const tokenHash = hashInvitationToken(input.token)
  const idempotencyKey = invitationDeliveryKey(input.invitationId, tokenHash)
  const invitation = await prisma.organizationInvitation.findUnique({
    where: { id: input.invitationId },
    select: { id: true, email: true, tokenHash: true, acceptedAt: true, revokedAt: true, expiresAt: true },
  })

  if (!invitation || invitation.email !== recipient || invitation.tokenHash !== tokenHash || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) {
    return { queued: false, state: 'failed', message: 'This invitation is no longer active. Create a fresh invitation link.' }
  }

  const emailIssue = emailConfigurationIssue()
  let encryptedContent: string | null = null
  let failureMessage = emailIssue
  if (!emailIssue) {
    try {
      encryptedContent = encryptPayload({ invitationId: invitation.id, recipient, token: input.token })
    } catch {
      failureMessage = 'Email could not be queued securely. Copy the invitation link and share it directly.'
    }
  }

  const readyToQueue = !failureMessage && Boolean(encryptedContent)
  const notification = await prisma.notificationLog.upsert({
    where: { idempotencyKey },
    create: {
      recipient,
      channel: 'EMAIL',
      type: 'ORGANIZATION_INVITATION',
      subject: 'Organization invitation',
      content: readyToQueue ? encryptedContent : null,
      status: readyToQueue ? 'PENDING' : 'FAILED',
      failureReason: readyToQueue ? null : failureMessage,
      errorMessage: readyToQueue ? null : failureMessage,
      idempotencyKey,
      scheduledAt: new Date(),
    },
    update: {},
  })

  const state = notification.status === 'SENT'
    ? 'sent'
    : notification.status === 'PROCESSING'
      ? 'sending'
      : notification.status === 'PENDING'
        ? notification.attemptCount > 0 ? 'retry-scheduled' : 'queued'
        : 'failed'
  const queued = notification.status !== 'FAILED'
  const message = state === 'queued' || state === 'retry-scheduled'
    ? null
    : state === 'sent'
      ? 'This invitation email has already been delivered.'
      : state === 'sending'
        ? 'This invitation email is being sent.'
        : notification.errorMessage || failureMessage || 'Email could not be queued. Copy the invitation link and share it directly.'

  return { queued, state, message, notificationId: notification.id }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Revalidates the live invitation immediately before dispatch, then builds an escaped email. */
export async function buildOrganizationInvitationEmail(input: {
  idempotencyKey: string | null
  recipient: string
  encryptedContent: string | null
}): Promise<OrganizationInvitationEmail | null> {
  if (!input.idempotencyKey || !input.encryptedContent) return null
  const match = /^organization-invitation:([^:]+):([a-f0-9]{64})$/.exec(input.idempotencyKey)
  if (!match) return null

  const [, invitationId, queuedTokenHash] = match
  let payload: InvitationPayload
  try {
    payload = decryptPayload(input.encryptedContent)
  } catch {
    return null
  }
  const invitation = await prisma.organizationInvitation.findUnique({
    where: { id: invitationId },
    include: { organization: { select: { name: true } } },
  })
  if (
    !invitation || invitation.id !== payload.invitationId || invitation.tokenHash !== queuedTokenHash ||
    invitation.tokenHash !== hashInvitationToken(payload.token) || invitation.email !== payload.recipient ||
    invitation.email !== input.recipient.trim().toLowerCase() || invitation.acceptedAt || invitation.revokedAt ||
    invitation.expiresAt <= new Date()
  ) return null

  const organizationName = invitation.organization.name.replace(/[\r\n]/g, ' ').slice(0, 120)
  const acceptUrl = getAbsoluteUrl(`/accept-organization-invitation?token=${encodeURIComponent(payload.token)}`)
  const safeName = escapeHtml(organizationName)
  const safeUrl = escapeHtml(acceptUrl)
  return {
    to: invitation.email,
    subject: `Invitation to join ${organizationName}`,
    text: `You have been invited to join ${organizationName}. Accept the invitation using this link: ${acceptUrl}\n\nThe link works once and expires in seven days. If you were not expecting this, you can ignore this email.`,
    html: `<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;color:#1c1917;line-height:1.6"><main style="max-width:560px;margin:32px auto;padding:24px"><h1>You are invited</h1><p>You have been invited to join <strong>${safeName}</strong>.</p><p><a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#d4a853;color:#1c1917;text-decoration:none;border-radius:6px">Accept invitation</a></p><p>This link works once and expires in seven days. If you were not expecting this invitation, you can ignore this email.</p></main></body></html>`,
  }
}

export function invitationDeliveryRetry(attemptCount: number, error: unknown): { retryAt: Date | null; message: string } {
  const providerError = error as { code?: unknown; responseCode?: unknown }
  const responseCode = Number(providerError?.responseCode)
  const errorCode = typeof providerError?.code === 'string' ? providerError.code : ''
  const permanent = Number.isInteger(responseCode) && responseCode >= 500 && responseCode < 600
  const transientCodes = new Set(['ECONNECTION', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKET', 'EAI_AGAIN', 'ENOTFOUND', 'ETLS'])
  const retryable = !permanent && ((!responseCode || (responseCode >= 400 && responseCode < 500)) || transientCodes.has(errorCode))
  if (!retryable || attemptCount >= MAX_ATTEMPTS) {
    return { retryAt: null, message: attemptCount >= MAX_ATTEMPTS
      ? 'Delivery failed after several attempts. Send a fresh invitation link to try again.'
      : 'The mail provider rejected this invitation. Check the recipient address and verified sender configuration.' }
  }
  const delayMinutes = RETRY_DELAYS_MINUTES[Math.min(attemptCount - 1, RETRY_DELAYS_MINUTES.length - 1)]
  return { retryAt: new Date(Date.now() + delayMinutes * 60_000), message: 'Temporary email delivery issue. Another attempt is scheduled.' }
}

export const MAX_ORGANIZATION_INVITATION_EMAIL_ATTEMPTS = MAX_ATTEMPTS

/** Prevents queued-but-not-claimed links from being delivered after a resend or cancellation. */
export async function invalidateQueuedOrganizationInvitationEmails(invitationId: string, reason: string): Promise<void> {
  await prisma.notificationLog.updateMany({
    where: {
      type: 'ORGANIZATION_INVITATION',
      status: 'PENDING',
      idempotencyKey: { startsWith: `${INVITATION_PREFIX}${invitationId}:` },
    },
    data: { status: 'FAILED', content: null, errorMessage: reason, failureReason: reason },
  })
}

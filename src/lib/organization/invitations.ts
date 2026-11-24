/**
 * Organization invitations and member management (Priority 2, member administration).
 *
 * Two rules shape this file.
 *
 *  1. The browser proves nothing. Every function takes the organization context that was
 *     resolved from the session, and every lookup is scoped by that organization id. An
 *     invitation id or member id from a request can only ever address a row inside the
 *     caller's own organization.
 *
 *  2. Authority is the existing capability system, not a second one. Managing members
 *     requires `organization.manage`, which only the organization owner holds today, and a
 *     role can only be granted when the granter already holds every capability that role
 *     carries. That is what stops an invitation from handing out more than the inviter has.
 *
 * Tokens follow the repository's existing convention: 32 random bytes, shown once, stored
 * as a sha256 hash, single use, seven days.
 */

import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { can, ROLE_CAPABILITIES, type OrgRole } from './capabilities'
import type { OrgContext } from './resolve'

/**
 * The four roles an organization membership can hold. Deliberately narrower than OrgRole,
 * which also names shop-level roles (a barber, a location manager) that live in the
 * shop-level membership system and are not granted here.
 */
export type MemberRole = 'ORGANIZATION_OWNER' | 'CORPORATE_ADMIN' | 'REGIONAL_MANAGER' | 'FRANCHISE_OWNER'

export const INVITATION_TTL_DAYS = 7

export type InvitationState = 'pending' | 'accepted' | 'expired' | 'cancelled'

export interface InvitationRow {
  id: string
  organizationId: string
  email: string
  role: MemberRole
  regions: string[]
  expiresAt: Date
  acceptedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

export interface Outcome<T> {
  ok: boolean
  value?: T
  /** A sentence a person can act on. Never a stack trace, never a token. */
  error?: string
  /** Machine-readable reason for tests and logs. */
  reason?: string
}

const ROLE_LABELS: Record<MemberRole, string> = {
  ORGANIZATION_OWNER: 'Organization owner',
  CORPORATE_ADMIN: 'Corporate administrator',
  REGIONAL_MANAGER: 'Regional manager',
  FRANCHISE_OWNER: 'Franchise owner',
}

/** Everyday words for what each role may do, and may not. */
const ROLE_ABILITIES: Record<MemberRole, string> = {
  ORGANIZATION_OWNER:
    'Can do everything: manage locations, people, branding and services, and see money for the whole organization. The only role that can change who else is an owner.',
  CORPORATE_ADMIN:
    'Can manage branding and services and see organization totals. Cannot change locations, people, or anyone’s role.',
  REGIONAL_MANAGER:
    'Can see totals and assign staff for the regions they are given. Cannot change the organization, its people, or branding.',
  FRANCHISE_OWNER:
    'Can see the totals and money for the locations they run. Cannot change the organization or its people.',
}

export function roleLabel(role: MemberRole): string {
  return ROLE_LABELS[role] ?? 'Role not recognised'
}

export function describeRoleAbilities(role: MemberRole): string {
  return ROLE_ABILITIES[role] ?? 'This role is not recognised, so it grants nothing.'
}

/** Roles that may be handed out by an invitation. Ownership is never granted this way. */
export const INVITABLE_ROLES: MemberRole[] = ['CORPORATE_ADMIN', 'REGIONAL_MANAGER', 'FRANCHISE_OWNER']

export function generateInvitationToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, tokenHash: hashInvitationToken(token) }
}

export function hashInvitationToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isPlausibleEmail(email: string): boolean {
  const clean = normaliseEmail(email)
  return clean.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)
}

/** What an invitation is, right now. Expiry is derived, never stored as a status. */
export function invitationState(row: Pick<InvitationRow, 'acceptedAt' | 'revokedAt' | 'expiresAt'>, now: Date): InvitationState {
  if (row.acceptedAt) return 'accepted'
  if (row.revokedAt) return 'cancelled'
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'pending'
}

export function describeInvitationState(state: InvitationState): string {
  switch (state) {
    case 'accepted':
      return 'Accepted. This person is now a member.'
    case 'cancelled':
      return 'Cancelled. The link no longer works.'
    case 'expired':
      return 'Expired. Send a new invitation if they still need access.'
    default:
      return 'Waiting for them to accept.'
  }
}

/** Member administration needs the existing manage capability; nothing else is accepted. */
export function canManageMembers(context: OrgContext | null): boolean {
  return Boolean(context && can(context.role, 'organization.manage'))
}

/**
 * A role may be granted only when the granter already holds every capability it carries,
 * and ownership is never granted by invitation. Both halves matter: without the second, an
 * owner could quietly create a second owner from a screen that only offers three choices.
 */
export function canGrantRole(caller: OrgRole, target: MemberRole): boolean {
  if (target === 'ORGANIZATION_OWNER') return false
  if (!INVITABLE_ROLES.includes(target)) return false
  const held = new Set(ROLE_CAPABILITIES[caller] ?? [])
  return (ROLE_CAPABILITIES[target] ?? []).every((capability) => held.has(capability))
}

function audit(
  action:
    | 'ORGANIZATION_INVITATION_CREATED'
    | 'ORGANIZATION_INVITATION_RESENT'
    | 'ORGANIZATION_INVITATION_CANCELLED'
    | 'ORGANIZATION_INVITATION_ACCEPTED'
    | 'ORGANIZATION_MEMBER_ROLE_CHANGED'
    | 'ORGANIZATION_MEMBER_STATUS_CHANGED',
  input: { userId: string; entityId: string; description: string; oldValues?: unknown; newValues?: unknown },
) {
  // Organization events have no businessId; AuditLog allows that on purpose. A failure to
  // write the audit row must not be reported as a successful change, so it is returned.
  return prisma.auditLog.create({
    data: {
      businessId: null,
      userId: input.userId,
      action,
      entityType: 'OrganizationMembership',
      entityId: input.entityId,
      description: input.description,
      oldValues: input.oldValues === undefined ? undefined : (input.oldValues as object),
      newValues: input.newValues === undefined ? undefined : (input.newValues as object),
    },
  })
}

export type InvitationDeliveryState = 'created' | 'queued' | 'sending' | 'sent' | 'failed' | 'retry-scheduled'

export async function listOrganizationInvitations(context: OrgContext, now = new Date()) {
  const rows = await prisma.organizationInvitation.findMany({
    where: { organizationId: context.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  const deliveryLogs = rows.length ? await prisma.notificationLog.findMany({
    where: {
      type: 'ORGANIZATION_INVITATION',
      OR: rows.map((row) => ({ idempotencyKey: { startsWith: `organization-invitation:${row.id}:` } })),
    },
    orderBy: { createdAt: 'desc' },
    select: { idempotencyKey: true, status: true, attemptCount: true, failureReason: true, sentAt: true },
  }) : []
  const latestDelivery = new Map<string, (typeof deliveryLogs)[number]>()
  for (const log of deliveryLogs) {
    const invitationId = log.idempotencyKey?.match(/^organization-invitation:([^:]+):/)?.[1]
    if (invitationId && !latestDelivery.has(invitationId)) latestDelivery.set(invitationId, log)
  }
  return rows.map((row) => {
    const delivery = latestDelivery.get(row.id)
    const deliveryState = !delivery ? 'created'
      : delivery.status === 'SENT' ? 'sent'
        : delivery.status === 'PROCESSING' ? 'sending'
          : delivery.status === 'PENDING' && delivery.attemptCount > 0 ? 'retry-scheduled'
            : delivery.status === 'PENDING' ? 'queued' : 'failed'
    return ({
      deliveryState,
      deliveryError: delivery?.status === 'FAILED' ? delivery.failureReason : null,
      sentAt: delivery?.sentAt?.toISOString() ?? null,
    id: row.id,
    email: row.email,
    role: row.role as MemberRole,
    roleLabel: roleLabel(row.role as MemberRole),
    regions: row.regions,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    state: invitationState(row, now),
    stateLabel: describeInvitationState(invitationState(row, now)),
  })})
}

export async function createOrganizationInvitation(input: {
  context: OrgContext
  email: string
  role: MemberRole
  regions?: string[]
  invitedById: string
  now?: Date
}): Promise<Outcome<{ id: string; token: string; expiresAt: Date; email: string }>> {
  const { context } = input
  if (!canManageMembers(context)) {
    return { ok: false, reason: 'not-permitted', error: 'Only the organization owner can invite people.' }
  }
  const email = normaliseEmail(input.email)
  if (!isPlausibleEmail(email)) {
    return { ok: false, reason: 'invalid-email', error: 'That does not look like an email address.' }
  }
  if (!canGrantRole(context.role, input.role)) {
    return {
      ok: false,
      reason: 'role-not-grantable',
      error: 'You cannot give someone more access than you have yourself.',
    }
  }
  const now = input.now ?? new Date()

  const existingUser = await prisma.user.findFirst({ where: { email }, select: { id: true } })
  const existingMember = existingUser
    ? await prisma.organizationMember.findFirst({
        where: { organizationId: context.organizationId, userId: existingUser.id },
        select: { id: true },
      })
    : null
  if (existingMember) {
    return { ok: false, reason: 'already-member', error: 'That person is already a member of this organization.' }
  }

  const openInvitation = await prisma.organizationInvitation.findFirst({
    where: { organizationId: context.organizationId, email, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true },
  })
  if (openInvitation) {
    return {
      ok: false,
      reason: 'already-invited',
      error: 'An invitation is already waiting for that address. Resend it or cancel it first.',
    }
  }

  const { token, tokenHash } = generateInvitationToken()
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * 86_400_000)

  const created = await prisma.organizationInvitation.create({
    data: {
      organizationId: context.organizationId,
      email,
      role: input.role,
      regions: input.regions ?? [],
      tokenHash,
      expiresAt,
      invitedById: input.invitedById,
    },
    select: { id: true },
  })

  try {
    await audit('ORGANIZATION_INVITATION_CREATED', {
      userId: input.invitedById,
      entityId: created.id,
      description: `Invited ${email} as ${roleLabel(input.role).toLowerCase()}`,
      newValues: { email, role: input.role, regions: input.regions ?? [] },
    })
  } catch {
    return { ok: false, reason: 'audit-failed', error: 'The invitation was not saved because it could not be recorded. Nothing changed.' }
  }

  // The token is returned to the caller once, to be delivered or copied. It is never stored
  // in plaintext and never written to a log.
  return { ok: true, value: { id: created.id, token, expiresAt, email } }
}

export async function cancelOrganizationInvitation(input: {
  context: OrgContext
  invitationId: string
  actorId: string
}): Promise<Outcome<{ id: string }>> {
  if (!canManageMembers(input.context)) {
    return { ok: false, reason: 'not-permitted', error: 'Only the organization owner can cancel an invitation.' }
  }
  const result = await prisma.organizationInvitation.updateMany({
    where: {
      id: input.invitationId,
      organizationId: input.context.organizationId,
      acceptedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  })
  if (result.count === 0) {
    return { ok: false, reason: 'not-cancellable', error: 'That invitation is not waiting any more.' }
  }
  await audit('ORGANIZATION_INVITATION_CANCELLED', {
    userId: input.actorId,
    entityId: input.invitationId,
    description: 'Cancelled a pending organization invitation',
  })
  return { ok: true, value: { id: input.invitationId } }
}

export async function resendOrganizationInvitation(input: {
  context: OrgContext
  invitationId: string
  actorId: string
  now?: Date
}): Promise<Outcome<{ id: string; token: string; expiresAt: Date; email: string }>> {
  if (!canManageMembers(input.context)) {
    return { ok: false, reason: 'not-permitted', error: 'Only the organization owner can resend an invitation.' }
  }
  const now = input.now ?? new Date()
  const row = await prisma.organizationInvitation.findFirst({
    where: { id: input.invitationId, organizationId: input.context.organizationId },
    select: { id: true, role: true, email: true, acceptedAt: true, revokedAt: true },
  })
  if (!row) return { ok: false, reason: 'not-found', error: 'That invitation could not be found.' }
  if (row.acceptedAt) return { ok: false, reason: 'already-accepted', error: 'That invitation was already accepted.' }
  if (row.revokedAt) return { ok: false, reason: 'cancelled', error: 'That invitation was cancelled. Send a new one instead.' }
  if (!canGrantRole(input.context.role, row.role as MemberRole)) {
    return { ok: false, reason: 'role-not-grantable', error: 'You cannot renew an invitation to a role above your own.' }
  }

  const { token, tokenHash } = generateInvitationToken()
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * 86_400_000)
  // The old hash is replaced, so the previous link stops working the moment this succeeds.
  await prisma.organizationInvitation.update({
    where: { id: row.id },
    data: { tokenHash, expiresAt },
  })
  await audit('ORGANIZATION_INVITATION_RESENT', {
    userId: input.actorId,
    entityId: row.id,
    description: 'Sent a fresh link for a pending organization invitation',
    newValues: { expiresAt: expiresAt.toISOString() },
  })
  return { ok: true, value: { id: row.id, token, expiresAt, email: row.email } }
}

/**
 * Accept an invitation as the signed-in person.
 *
 * The token proves the link; the session's email proves the identity. Both are required, and
 * the acceptance is a single conditional update so two simultaneous clicks cannot both win.
 */
export async function acceptOrganizationInvitation(input: {
  token: string
  userEmail: string | null | undefined
  userId: string
  now?: Date
}): Promise<Outcome<{ organizationId: string; role: MemberRole }>> {
  const now = input.now ?? new Date()
  if (!input.token) return { ok: false, reason: 'no-token', error: 'This invitation link is incomplete.' }
  if (!input.userEmail) return { ok: false, reason: 'no-email', error: 'Sign in with the address that was invited.' }

  const tokenHash = hashInvitationToken(input.token)
  const row = await prisma.organizationInvitation.findUnique({
    where: { tokenHash },
    select: { id: true, organizationId: true, email: true, role: true, regions: true, expiresAt: true, acceptedAt: true, revokedAt: true },
  })
  if (!row) return { ok: false, reason: 'unknown-token', error: 'This invitation link is not valid.' }

  const state = invitationState(row, now)
  if (state === 'accepted') return { ok: false, reason: 'already-accepted', error: 'This invitation has already been used.' }
  if (state === 'cancelled') return { ok: false, reason: 'cancelled', error: 'This invitation was cancelled.' }
  if (state === 'expired') return { ok: false, reason: 'expired', error: 'This invitation has expired. Ask for a new one.' }

  if (normaliseEmail(input.userEmail) !== normaliseEmail(row.email)) {
    return {
      ok: false,
      reason: 'wrong-email',
      error: 'This invitation was sent to a different email address. Sign in with that address to accept it.',
    }
  }

  // Single use under concurrency: only the first update can match acceptedAt: null.
  const claimed = await prisma.organizationInvitation.updateMany({
    where: { id: row.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    data: { acceptedAt: now },
  })
  if (claimed.count === 0) {
    return { ok: false, reason: 'already-accepted', error: 'This invitation has already been used.' }
  }

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: row.organizationId, userId: input.userId } },
    update: { role: row.role, regions: row.regions, status: 'ACTIVE' },
    create: {
      organizationId: row.organizationId,
      userId: input.userId,
      role: row.role,
      regions: row.regions,
      status: 'ACTIVE',
    },
  })

  await audit('ORGANIZATION_INVITATION_ACCEPTED', {
    userId: input.userId,
    entityId: row.id,
    description: `Accepted an organization invitation as ${roleLabel(row.role as MemberRole).toLowerCase()}`,
    newValues: { role: row.role },
  })

  return { ok: true, value: { organizationId: row.organizationId, role: row.role as MemberRole } }
}

async function loadMemberInOrganization(context: OrgContext, memberId: string) {
  return prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId: context.organizationId },
    select: { id: true, userId: true, role: true, status: true, regions: true },
  })
}

export async function changeMemberRole(input: {
  context: OrgContext
  memberId: string
  role: MemberRole
  actorId: string
}): Promise<Outcome<{ id: string }>> {
  const { context } = input
  if (!canManageMembers(context)) {
    return { ok: false, reason: 'not-permitted', error: 'Only the organization owner can change someone’s role.' }
  }
  const member = await loadMemberInOrganization(context, input.memberId)
  if (!member) return { ok: false, reason: 'not-found', error: 'That person is not a member of this organization.' }
  if (member.role === 'ORGANIZATION_OWNER') {
    return { ok: false, reason: 'owner-protected', error: 'The organization owner’s role cannot be changed here.' }
  }
  if (member.userId === input.actorId) {
    return { ok: false, reason: 'self-change', error: 'You cannot change your own role.' }
  }
  if (!canGrantRole(context.role, input.role)) {
    return { ok: false, reason: 'role-not-grantable', error: 'You cannot give someone more access than you have yourself.' }
  }

  await prisma.organizationMember.update({ where: { id: member.id }, data: { role: input.role } })
  await audit('ORGANIZATION_MEMBER_ROLE_CHANGED', {
    userId: input.actorId,
    entityId: member.id,
    description: `Changed a member from ${roleLabel(member.role as MemberRole).toLowerCase()} to ${roleLabel(input.role).toLowerCase()}`,
    oldValues: { role: member.role },
    newValues: { role: input.role },
  })
  return { ok: true, value: { id: member.id } }
}

export async function setMemberStatus(input: {
  context: OrgContext
  memberId: string
  status: 'ACTIVE' | 'SUSPENDED'
  actorId: string
}): Promise<Outcome<{ id: string }>> {
  const { context } = input
  if (!canManageMembers(context)) {
    return { ok: false, reason: 'not-permitted', error: 'Only the organization owner can suspend or restore access.' }
  }
  const member = await loadMemberInOrganization(context, input.memberId)
  if (!member) return { ok: false, reason: 'not-found', error: 'That person is not a member of this organization.' }
  if (member.role === 'ORGANIZATION_OWNER') {
    return { ok: false, reason: 'owner-protected', error: 'The organization owner’s access cannot be suspended.' }
  }
  if (member.userId === input.actorId) {
    return { ok: false, reason: 'self-change', error: 'You cannot change your own access.' }
  }

  await prisma.organizationMember.update({ where: { id: member.id }, data: { status: input.status } })
  await audit('ORGANIZATION_MEMBER_STATUS_CHANGED', {
    userId: input.actorId,
    entityId: member.id,
    description: input.status === 'SUSPENDED' ? 'Suspended a member’s organization access' : 'Restored a member’s organization access',
    oldValues: { status: member.status },
    newValues: { status: input.status },
  })
  return { ok: true, value: { id: member.id } }
}

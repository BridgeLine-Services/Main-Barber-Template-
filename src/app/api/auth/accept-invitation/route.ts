export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { z } from 'zod'
import { checkRateLimit } from '@/lib/rate-limit'
import { passwordPolicySchema, normalizeEmail } from '@/lib/validation'

// ============================================================================
// STAFF INVITATION ACCEPTANCE
//
// Security model:
//  - The invitation token is a 32-byte random secret; only its SHA-256 hash is
//    stored. Acceptance looks the invitation up BY HASH — nothing about the
//    invitation (role, business, email) can be supplied or changed by the
//    browser.
//  - Single-use: acceptedAt is set with a guarded updateMany so two racing
//    accepts cannot both succeed.
//  - Time-limited: expiresAt enforced. Revocable: revokedAt enforced.
//  - The invitee chooses their own password for a NEW account; the invited
//    role is fixed by the invitation.
//  - EXISTING ACCOUNT LINKING: when the invited email already has an account
//    (e.g. a public customer being invited to become staff), the invitation
//    can only be accepted by an authenticated session that OWNS that exact
//    account (session id + email must match the invited email). The role,
//    business, and barber profile are applied server-side in one transaction;
//    the existing password is kept. No unauthenticated or third-party session
//    can ever link the account.
// ============================================================================

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

const acceptSchema = z.object({
  token: z.string().min(32).max(128),
  // Required for NEW accounts. For linking an EXISTING account the invitee
  // proves ownership by authenticating (their session), so no password is
  // needed — it is never changed by acceptance.
  password: passwordPolicySchema.optional(),
  // No role/business/email fields — those come from the invitation only.
})

/** GET ?token= — shows the invitee what they are accepting, without accepting. */
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 'accept-invitation', { windowMs: 60_000, maxRequests: 10 })
  if (limited) return NextResponse.json({ error: 'Too many attempts. Please wait a moment.' }, { status: limited.status })

  const token = req.nextUrl.searchParams.get('token') || ''
  if (token.length < 32) return NextResponse.json({ valid: false, reason: 'invalid' }, { status: 400 })

  const invitation = await prisma.staffInvitation.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!invitation) return NextResponse.json({ valid: false, reason: 'invalid' }, { status: 404 })
  if (invitation.revokedAt) return NextResponse.json({ valid: false, reason: 'revoked' }, { status: 410 })
  if (invitation.acceptedAt) return NextResponse.json({ valid: false, reason: 'already-used' }, { status: 409 })
  if (invitation.expiresAt < new Date()) return NextResponse.json({ valid: false, reason: 'expired' }, { status: 410 })

  const business = await prisma.business.findUnique({
    where: { id: invitation.businessId },
    select: { name: true, deactivatedAt: true },
  })
  if (!business || business.deactivatedAt) return NextResponse.json({ valid: false, reason: 'business-unavailable' }, { status: 410 })

  // Does the invited email already have an account? The invitee holds the
  // invitation token, which names this email — revealing "you already have an
  // account" to the token holder leaks nothing new. The acceptance UI uses
  // this to render the sign-in-to-link flow instead of the password form.
  const existing = await prisma.user.findUnique({
    where: { email: normalizeEmail(invitation.email) },
    select: { id: true },
  })

  return NextResponse.json({
    valid: true,
    email: invitation.email,
    name: invitation.name,
    role: invitation.role,
    businessName: business.name,
    expiresAt: invitation.expiresAt,
    existingAccount: Boolean(existing),
  })
}

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 'accept-invitation-post', { windowMs: 60_000, maxRequests: 5 })
  if (limited) return NextResponse.json({ error: 'Too many attempts. Please wait a moment.' }, { status: limited.status })

  try {
    const body = await req.json().catch(() => null)
    const parsed = acceptSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid invitation or password', details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const invitation = await prisma.staffInvitation.findUnique({ where: { tokenHash: hashToken(parsed.data.token) } })
    if (!invitation) return NextResponse.json({ error: 'This invitation is not valid.' }, { status: 404 })
    if (invitation.revokedAt) return NextResponse.json({ error: 'This invitation was revoked.' }, { status: 410 })
    if (invitation.acceptedAt) return NextResponse.json({ error: 'This invitation was already used.' }, { status: 409 })
    if (invitation.expiresAt < new Date()) return NextResponse.json({ error: 'This invitation has expired. Please ask your manager to send a new one.' }, { status: 410 })

    const business = await prisma.business.findUnique({ where: { id: invitation.businessId }, select: { deactivatedAt: true } })
    if (!business || business.deactivatedAt) return NextResponse.json({ error: 'This business is no longer available.' }, { status: 410 })

    const email = normalizeEmail(invitation.email)
    const existing = await prisma.user.findUnique({ where: { email } })

    // ─── EXISTING ACCOUNT: secure linking only ────────────────────────────
    if (existing) {
      // The session must be the owner of the invited account. A session for a
      // different account, or no session at all, can never link it. Email is
      // re-checked against the invitation, so an invitee can never accept an
      // invitation addressed to someone else's email.
      const session = await getServerSession(authOptions)
      const sessionEmail = session?.user?.email ? normalizeEmail(session.user.email) : null
      if (!session?.user?.id || session.user.id !== existing.id || sessionEmail !== email) {
        return NextResponse.json(
          { error: 'An account with this email already exists. Please log in with that account, then open this invitation link again.' },
          { status: 401 }
        )
      }

      const linked = await prisma.$transaction(async (tx) => {
        // Single-use guard: claim the invitation atomically. A racing second
        // accept sees count 0 and must fail.
        const claimed = await tx.staffInvitation.updateMany({
          where: { id: invitation.id, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: new Date() },
        })
        if (claimed.count === 0) throw new Error('INVITATION_ALREADY_USED')

        // Guarded link: the account must still be an active, unlinked customer
        // at claim time. A racing invitation, role change, or deactivation
        // cannot be silently overwritten (updateMany sees count 0).
        const updated = await tx.user.updateMany({
          where: { id: existing.id, role: 'CUSTOMER', businessId: null, isActive: true },
          data: {
            role: invitation.role, // fixed by the invitation — never client-supplied
            businessId: invitation.businessId,
            barberId: invitation.barberId,
            passwordChangedAt: new Date(),
          },
        })
        if (updated.count === 0) throw new Error('ACCOUNT_NOT_LINKABLE')

        return tx.user.findUnique({
          where: { id: existing.id },
          select: { id: true, email: true, name: true, role: true },
        })
      })

      // Audit: existing account linked to the invitation's role/business.
      try {
        await prisma.auditLog.create({
          data: {
            businessId: invitation.businessId,
            userId: linked!.id,
            action: 'STAFF_INVITATION_ACCEPTED',
            entityType: 'StaffInvitation',
            entityId: invitation.id,
            newValues: { email: linked!.email, role: linked!.role, linkedExistingAccount: true },
            description: `Staff invitation accepted by ${linked!.email} (${linked!.role}) — existing account linked`,
            ipAddress: req.headers.get('x-forwarded-for'),
            userAgent: req.headers.get('user-agent'),
          },
        })
      } catch (auditError) {
        console.error('[accept-invitation] audit failed', auditError instanceof Error ? auditError.message : 'unknown')
      }

      return NextResponse.json({
        success: true,
        linked: true,
        user: linked,
        message: 'Invitation accepted — your existing account now has staff access.',
      }, { status: 200 })
    }

    // ─── NEW ACCOUNT: the invitee chooses their own password ──────────────
    if (!parsed.data.password) {
      return NextResponse.json({ error: 'Please choose a password for your new account.' }, { status: 400 })
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12)

    const user = await prisma.$transaction(async (tx) => {
      // Single-use guard: claim the invitation atomically. A racing second
      // accept sees count 0 and must fail.
      const claimed = await tx.staffInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      })
      if (claimed.count === 0) throw new Error('INVITATION_ALREADY_USED')

      return tx.user.create({
        data: {
          email,
          name: invitation.name,
          role: invitation.role, // fixed by the invitation — never client-supplied
          passwordHash,
          passwordChangedAt: new Date(),
          businessId: invitation.businessId,
          barberId: invitation.barberId,
          isActive: true,
        },
        select: { id: true, email: true, name: true, role: true },
      })
    })

    // Audit: staff invitation accepted + staff activated (account created).
    try {
      await prisma.auditLog.create({
        data: {
          businessId: invitation.businessId,
          userId: user.id,
          action: 'STAFF_INVITATION_ACCEPTED',
          entityType: 'StaffInvitation',
          entityId: invitation.id,
          newValues: { email: user.email, role: user.role },
          description: `Staff invitation accepted by ${user.email} (${user.role})`,
          ipAddress: req.headers.get('x-forwarded-for'),
          userAgent: req.headers.get('user-agent'),
        },
      })
      await prisma.auditLog.create({
        data: {
          businessId: invitation.businessId,
          userId: user.id,
          action: 'STAFF_ACTIVATED',
          entityType: 'User',
          entityId: user.id,
          newValues: { email: user.email, role: user.role },
          description: `Staff account activated for ${user.email} (${user.role})`,
          ipAddress: req.headers.get('x-forwarded-for'),
        },
      })
    } catch (auditError) {
      console.error('[accept-invitation] audit failed', auditError instanceof Error ? auditError.message : 'unknown')
    }

    return NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      message: 'Account created. You can now sign in.',
    }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'INVITATION_ALREADY_USED') {
      return NextResponse.json({ error: 'This invitation was already used.' }, { status: 409 })
    }
    if (error instanceof Error && error.message === 'ACCOUNT_NOT_LINKABLE') {
      return NextResponse.json({ error: 'This invitation can no longer be accepted with this account. Please ask your manager for help.' }, { status: 409 })
    }
    console.error('[accept-invitation] failed', error)
    return NextResponse.json({ error: 'Failed to accept invitation. Please try again.' }, { status: 500 })
  }
}

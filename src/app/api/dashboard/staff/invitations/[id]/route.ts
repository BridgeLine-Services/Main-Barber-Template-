export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentBusinessId } from '@/lib/business'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { canManageStaffWithRole } from '@/lib/permissions'
import { sendStaffInviteEmail } from '@/lib/notifications'
import crypto from 'crypto'
import { getAppUrlString } from '@/lib/app-url'

const INVITATION_TTL_DAYS = 7

/**
 * DELETE /api/dashboard/staff/invitations/[id]
 * Revoke a pending staff invitation (OWNER/ADMIN, own business only — the
 * invitation is looked up by id AND businessId, so one business can never
 * revoke another's invitations).
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.user?.role === 'CUSTOMER') return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
    const callerRole = (session.user as { role?: string }).role
    if (callerRole !== 'OWNER' && callerRole !== 'BUSINESS_ADMIN') {
      return NextResponse.json({ error: 'Business owner or admin access required' }, { status: 403 })
    }
    const { id } = await params
    const businessId = await getCurrentBusinessId()

    // Tenant-scoped lookup: only touches invitations of the caller's business.
    const invitation = await prisma.staffInvitation.findFirst({
      where: { id, businessId, acceptedAt: null, revokedAt: null },
      select: { id: true, role: true },
    })
    if (!invitation) {
      return NextResponse.json({ error: 'Invitation not found or no longer revocable' }, { status: 404 })
    }
    // Co-owners may revoke BARBER invitations only; another co-owner's
    // invitation is OWNER-managed.
    if (!canManageStaffWithRole(callerRole, invitation.role)) {
      return NextResponse.json({ error: 'Only the business owner can revoke a co-owner invitation' }, { status: 403 })
    }

    const result = await prisma.staffInvitation.updateMany({
      where: { id, businessId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    })

    if (result.count === 0) {
      return NextResponse.json({ error: 'Invitation not found or no longer revocable' }, { status: 404 })
    }

    try {
      await prisma.auditLog.create({
        data: {
          businessId,
          userId: session.user.id,
          action: 'STAFF_INVITATION_REVOKED',
          entityType: 'StaffInvitation',
          entityId: id,
          ipAddress: req.headers.get('x-forwarded-for'),
        },
      })
    } catch {
      // Non-critical
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/staff/invitations/[id]')
  }
}

/**
 * POST /api/dashboard/staff/invitations/[id]
 * Resend a pending invitation: revokes the old token and issues a fresh
 * single-use invitation for the same recipient, role, and (if any) linked
 * barber profile. One outstanding invitation per email per business is
 * preserved — the resend replaces the previous link, so old links die and
 * duplicates can never accumulate.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.user?.role === 'CUSTOMER') return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
    const callerRole = (session.user as { role?: string }).role
    if (callerRole !== 'OWNER' && callerRole !== 'BUSINESS_ADMIN') {
      return NextResponse.json({ error: 'Business owner or admin access required' }, { status: 403 })
    }
    const { id } = await params
    const businessId = await getCurrentBusinessId()

    const invitation = await prisma.staffInvitation.findFirst({
      where: { id, businessId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, name: true, role: true, barberId: true },
    })
    if (!invitation) {
      return NextResponse.json({ error: 'Invitation not found or no longer resendable' }, { status: 404 })
    }
    if (!canManageStaffWithRole(callerRole, invitation.role)) {
      return NextResponse.json({ error: 'Only the business owner can resend a co-owner invitation' }, { status: 403 })
    }

    // Atomic replace: revoke the old token, then mint a fresh one inside one
    // transaction so no window exists with two usable invitations.
    const token = crypto.randomBytes(32).toString('base64url')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000)

    const fresh = await prisma.$transaction(async (tx) => {
      await tx.staffInvitation.update({
        where: { id: invitation.id },
        data: { revokedAt: new Date() },
      })
      return tx.staffInvitation.create({
        data: {
          businessId,
          email: invitation.email,
          name: invitation.name,
          role: invitation.role,
          barberId: invitation.barberId,
          tokenHash,
          expiresAt,
          invitedById: session.user.id!,
        },
        select: { id: true, email: true, name: true, role: true, expiresAt: true, createdAt: true },
      })
    })

    try {
      await prisma.auditLog.create({
        data: {
          businessId,
          userId: session.user.id,
          action: 'STAFF_INVITATION_RESENT',
          entityType: 'StaffInvitation',
          entityId: fresh.id,
          newValues: { email: invitation.email, role: invitation.role },
          description: `Resent invitation for ${invitation.email} (replaced ${invitation.id})`,
          ipAddress: req.headers.get('x-forwarded-for'),
        },
      })
    } catch {
      // Non-critical
    }

    const inviteUrl = `${getAppUrlString()}/accept-invitation?token=${encodeURIComponent(token)}`
    let emailSent = false
    try {
      emailSent = await sendStaffInviteEmail({
        businessId,
        businessName: session.user.businessName || 'your barbershop',
        to: invitation.email,
        name: invitation.name,
        tempPassword: '',
        loginUrl: inviteUrl,
        role: invitation.role,
      })
    } catch (emailError) {
      console.error('[staff] resend email failed', emailError instanceof Error ? emailError.message : 'unknown error')
    }

    return NextResponse.json({
      invitation: fresh,
      inviteUrl,
      emailSent,
      message: emailSent
        ? `Invitation resent to ${invitation.email}. The previous link no longer works; the link below is a backup.`
        : 'Invitation refreshed. The previous link no longer works — share the secure link below with your team member.',
    })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/staff/invitations/[id]')
  }
}

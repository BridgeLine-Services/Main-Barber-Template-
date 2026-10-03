export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentBusinessId } from '@/lib/business'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import crypto from 'crypto'
import { z } from 'zod'
import { handleApiError } from '@/lib/api-errors'
import { sendStaffInviteEmail } from '@/lib/notifications'
import { getAppUrlString } from '@/lib/app-url'

// ============================================================================
// STAFF — invitation lifecycle.
//
// Inviting creates a single-use, time-limited, business- and role-scoped
// StaffInvitation (only the SHA-256 token hash is stored). The account is
// created by the invitee at /accept-invitation, where they choose their own
// password and the invited role is applied server-side.
//
// Staff invitations can NEVER create OWNER (or CUSTOMER) accounts.
// ============================================================================

const INVITATION_TTL_DAYS = 7

const inviteSchema = z.object({
  name: z.string().min(1, 'Name required').max(100),
  email: z.string().email('Valid email required'),
  // Invitation roles are staff roles only — OWNER can never be assigned via
  // invitation (ownership transfer has its own dedicated flow).
  role: z.enum(['BUSINESS_ADMIN', 'BARBER']),
  barberId: z.string().optional(), // link to Barber profile
})

/**
 * GET /api/dashboard/staff
 * List staff users + pending invitations for the caller's business (owner/admin only).
 */
export async function GET() {
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
    try {
      const businessId = await getCurrentBusinessId()
      const [staff, invitations] = await Promise.all([
        prisma.user.findMany({
          where: { businessId },
          select: {
            id: true, email: true, name: true, role: true, barberId: true, isActive: true, createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.staffInvitation.findMany({
          where: { businessId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          select: {
            id: true, email: true, name: true, role: true, expiresAt: true, createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
      ])
      return NextResponse.json({ staff, invitations })
    } catch (error) {
      if (error.code === 'P1001' || error.message?.includes('No business found')) {
        return NextResponse.json({ error: 'Database not available' }, { status: 503 })
      }
      throw error
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/staff')
  }
}

/**
 * POST /api/dashboard/staff
 * Invite a staff member by creating a secure invitation (OWNER/ADMIN only).
 */
export async function POST(req: NextRequest) {
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
    try {
      const body = await req.json().catch(() => null)
      const parsed = inviteSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        )
      }

      const businessId = await getCurrentBusinessId()

      if (parsed.data.barberId) {
        const barber = await prisma.barber.findFirst({ where: { id: parsed.data.barberId, businessId }, select: { id: true } })
        if (!barber) return NextResponse.json({ error: 'Barber profile not found in this business' }, { status: 403 })
        const existingLink = await prisma.user.findFirst({
          where: { businessId, barberId: parsed.data.barberId, isActive: true },
          select: { email: true },
        })
        if (existingLink) {
          return NextResponse.json(
            { error: `That barber profile is already linked to ${existingLink.email}` },
            { status: 409 }
          )
        }
      }

      const email = parsed.data.email.toLowerCase()

      // An existing account can only be invited when it can be securely
      // LINKED at acceptance: an active public customer account (CUSTOMER
      // role, no business). The invitee must then authenticate as that exact
      // account to accept. Staff/owner accounts and accounts already tied to
      // any business are a hard stop — acceptance would have to move a user
      // between tenants, which invitations must never do.
      const existing = await prisma.user.findUnique({ where: { email } })
      const linkable = existing?.role === 'CUSTOMER' && !existing.businessId && existing.isActive
      if (existing && !linkable) {
        return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })
      }

      // One outstanding invitation per email per business.
      const pending = await prisma.staffInvitation.findFirst({
        where: {
          businessId, email, acceptedAt: null, revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      })
      if (pending) {
        return NextResponse.json({ error: 'An invitation for this email is already pending. Revoke it first to send a new one.' }, { status: 409 })
      }

      // Cryptographically secure single-use token; only the hash is stored.
      const token = crypto.randomBytes(32).toString('base64url')
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
      const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000)

      const invitation = await prisma.staffInvitation.create({
        data: {
          businessId,
          email,
          name: parsed.data.name,
          role: parsed.data.role,
          barberId: parsed.data.barberId || null,
          tokenHash,
          expiresAt,
          invitedById: session.user.id!,
        },
        select: { id: true, email: true, name: true, role: true, expiresAt: true, createdAt: true },
      })

      // Audit logging is non-critical; it must not turn a successful invite into a failure.
      try {
        await prisma.auditLog.create({
          data: {
            businessId,
            userId: session.user.id,
            action: 'STAFF_INVITED',
            entityType: 'StaffInvitation',
            entityId: invitation.id,
            newValues: { name: parsed.data.name, email, role: parsed.data.role },
            description: `Invited ${parsed.data.name} (${email}) as ${parsed.data.role}`,
            ipAddress: req.headers.get('x-forwarded-for'),
            userAgent: req.headers.get('user-agent'),
          },
        })
      } catch (auditError) {
        console.error('[staff] audit log failed after invite', auditError instanceof Error ? auditError.message : 'unknown error')
      }

      const inviteUrl = `${getAppUrlString()}/accept-invitation?token=${encodeURIComponent(token)}`

      // Best-effort email of the invitation link (only when SMTP is
      // configured). The response still returns the link to the inviting
      // manager, so a failed or absent email never blocks the invite.
      let emailSent = false
      try {
        emailSent = await sendStaffInviteEmail({
          businessId,
          businessName: session.user.businessName || 'your barbershop',
          to: email,
          name: parsed.data.name,
          tempPassword: '', // invitation flow: the link sets the password
          loginUrl: inviteUrl,
        })
      } catch (emailError) {
        console.error('[staff] invite email failed', emailError instanceof Error ? emailError.message : 'unknown error')
      }

      const linking = Boolean(existing && linkable)
      return NextResponse.json({
        invitation,
        inviteUrl,
        emailSent,
        linking,
        message: emailSent
          ? `Invitation sent to ${email}. The link below is a backup in case the email doesn't arrive.`
          : 'Invitation created. Share the secure link below with your new team member.',
      }, { status: 201 })
    } catch (error) {
      if (error.code === 'P1001' || error.message?.includes('No business found')) {
        return NextResponse.json({ error: 'Database connection error. Please try again.' }, { status: 503 })
      }
      console.error('Error inviting staff:', error)
      return NextResponse.json({ error: 'Failed to invite staff member' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/staff')
  }
}

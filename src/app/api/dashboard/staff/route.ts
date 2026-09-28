export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentBusinessId } from '@/lib/business'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { z } from 'zod'
import { handleApiError } from '@/lib/api-errors'
import { sendStaffInviteEmail } from '@/lib/notifications'

const inviteSchema = z.object({
  name: z.string().min(1, 'Name required').max(100),
  email: z.string().email('Valid email required'),
  role: z.enum(['OWNER', 'BUSINESS_ADMIN', 'BARBER']),
  barberId: z.string().optional(), // link to Barber profile
})

/**
 * GET /api/dashboard/staff
 * List all staff users (owner only)
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const callerRole = (session.user as { role?: string }).role
    if (callerRole !== 'OWNER' && callerRole !== 'BUSINESS_ADMIN') {
      return NextResponse.json({ error: 'Business owner or admin access required' }, { status: 403 })
    }
    try {
      const businessId = await getCurrentBusinessId()
      const staff = await prisma.user.findMany({
        where: { businessId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          barberId: true,
          isActive: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      })
      return NextResponse.json({ staff })
    } catch (error: any) {
      if (error.code === 'P1001' || error.message?.includes('No business found')) {
        return NextResponse.json({ error: 'Database not available' }, { status: 503 })
      }
      return NextResponse.json({ error: 'Failed to fetch staff' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/staff')
  }
}

/**
 * POST /api/dashboard/staff
 * Invite a new staff member (owner only)
 * Generates a temporary password — in production, send via email
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
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
      // Privilege escalation prevention: only the OWNER can create another
      // OWNER. A BUSINESS_ADMIN may invite barbers and business admins.
      if (parsed.data.role === 'OWNER' && callerRole !== 'OWNER') {
        return NextResponse.json({ error: 'Only the business owner can assign the Owner role' }, { status: 403 })
      }
      const businessId = await getCurrentBusinessId()
      if (parsed.data.barberId) {
        const barber = await prisma.barber.findFirst({ where: { id: parsed.data.barberId, businessId }, select: { id: true } })
        if (!barber) return NextResponse.json({ error: 'Barber profile not found in this business' }, { status: 403 })
        // A barber profile can only be linked to one staff account at a time
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
      // Check if email already exists
      const existing = await prisma.user.findUnique({
        where: { email: parsed.data.email.toLowerCase() },
      })
      if (existing) {
        return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 })
      }
      // Generate temporary password
      const tempPassword = crypto.randomBytes(8).toString('base64url').slice(0, 12)
      const passwordHash = await bcrypt.hash(tempPassword, 12)
      const user = await prisma.user.create({
        data: {
          email: parsed.data.email.toLowerCase(),
          name: parsed.data.name,
          role: parsed.data.role,
          passwordHash,
          businessId,
          barberId: parsed.data.barberId || null,
          // Temp credentials must be replaced at first login — the dashboard
          // gate routes mustChangePassword users to /change-password.
          mustChangePassword: true,
        },
        select: { id: true, email: true, name: true, role: true, barberId: true },
      })
      // Audit logging is non-critical; it must not turn a successful invite into a failure.
      try {
        await prisma.auditLog.create({
          data: {
            businessId,
            userId: (session.user as any).id,
            action: 'USER_INVITED',
            entityType: 'User',
            entityId: user.id,
            newValues: { name: parsed.data.name, email: parsed.data.email, role: parsed.data.role },
            ipAddress: req.headers.get('x-forwarded-for'),
            userAgent: req.headers.get('user-agent'),
          },
        })
      } catch (auditError) {
        console.error('[staff] audit log failed after invite', auditError instanceof Error ? auditError.message : 'unknown error')
      }
      // Best-effort email of the temporary password (only when SMTP is
      // configured). The response still returns it to the inviting owner, so
      // a failed or absent email never blocks the invite.
      let emailSent = false
      try {
        emailSent = await sendStaffInviteEmail({
          businessId,
          businessName: (session.user as any).businessName || 'your barbershop',
          to: user.email,
          name: user.name,
          tempPassword,
          loginUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/login`,
        })
      } catch (emailError) {
        console.error('[staff] invite email failed', emailError instanceof Error ? emailError.message : 'unknown error')
      }

      return NextResponse.json({
        user,
        tempPassword,
        emailSent,
        message: emailSent
          ? `Staff member invited. Temporary password sent to ${user.email}; also shown below in case the email doesn't arrive.`
          : 'Staff member invited. Share the temporary password securely.',
      }, { status: 201 })
    } catch (error: any) {
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

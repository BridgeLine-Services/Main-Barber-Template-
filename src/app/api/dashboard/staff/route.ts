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

const inviteSchema = z.object({
  name: z.string().min(1, 'Name required').max(100),
  email: z.string().email('Valid email required'),
  role: z.enum(['OWNER', 'BARBER']),
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
    if ((session.user as any).role !== 'OWNER') {
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
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
    if ((session.user as any).role !== 'OWNER') {
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
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
        },
        select: { id: true, email: true, name: true, role: true },
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
      return NextResponse.json({
        user,
        tempPassword, // TODO: send temp password via email in production
        message: 'Staff member invited. Share the temporary password securely.',
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

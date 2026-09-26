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

const updateSchema = z.object({
  role: z.enum(['OWNER', 'BARBER']).optional(),
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
})

/**
 * PATCH /api/dashboard/staff/[id]
 * Update staff member (owner only) — change role or name
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ((session.user as any).role !== 'OWNER') {
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
    }
    try {
      const body = await req.json()
      const parsed = updateSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
      }
      const businessId = await getCurrentBusinessId()
      const user = await prisma.user.findUnique({ where: { id: params.id } })
      if (!user || user.businessId !== businessId) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }
      // Don't allow demoting yourself
      if (user.id === (session.user as any).id && parsed.data.role && parsed.data.role !== 'OWNER') {
        return NextResponse.json({ error: 'You cannot demote yourself' }, { status: 400 })
      }
      // Don't allow deactivating yourself
      if (user.id === (session.user as any).id && parsed.data.isActive === false) {
        return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 400 })
      }
      // Don't allow deactivating the last remaining owner
      if (parsed.data.isActive === false && user.role === 'OWNER') {
        const activeOwners = await prisma.user.count({
          where: { businessId, role: 'OWNER', isActive: true },
        })
        if (activeOwners <= 1) {
          return NextResponse.json(
            { error: 'Cannot deactivate the only remaining owner account' },
            { status: 400 }
          )
        }
      }
      const updated = await prisma.user.update({
        where: { id: params.id },
        data: {
          ...(parsed.data.role && { role: parsed.data.role }),
          ...(parsed.data.name && { name: parsed.data.name }),
          ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
        },
        select: { id: true, email: true, name: true, role: true, isActive: true },
      })
      // Audit log
      await prisma.auditLog.create({
        data: {
          businessId,
          userId: (session.user as any).id,
          action:
            parsed.data.isActive !== undefined
              ? 'USER_DEACTIVATED'
              : 'USER_ROLE_CHANGED',
          entityType: 'User',
          entityId: params.id,
          oldValues: { role: user.role, name: user.name, isActive: user.isActive },
          newValues: parsed.data as any,
          ipAddress: req.headers.get('x-forwarded-for'),
          userAgent: req.headers.get('user-agent'),
        },
      })
      return NextResponse.json({ user: updated })
    } catch (error: any) {
      if (error.code === 'P1001' || error.message?.includes('No business found')) {
        return NextResponse.json({ error: 'Database connection error' }, { status: 503 })
      }
      return NextResponse.json({ error: 'Failed to update staff member' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/staff/[id]')
  }
}

/**
 * POST /api/dashboard/staff/[id]
 * Reset a staff member's password (owner only)
 * Generates a new temporary password
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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
      const user = await prisma.user.findUnique({ where: { id: params.id } })
      if (!user || user.businessId !== businessId) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }
      // Generate new temp password
      const tempPassword = crypto.randomBytes(8).toString('base64url').slice(0, 12)
      const passwordHash = await bcrypt.hash(tempPassword, 12)
      await prisma.user.update({
        where: { id: params.id },
        data: { passwordHash },
      })
      // Audit log
      await prisma.auditLog.create({
        data: {
          businessId,
          userId: (session.user as any).id,
          action: 'USER_PASSWORD_CHANGED',
          entityType: 'User',
          entityId: params.id,
          ipAddress: req.headers.get('x-forwarded-for'),
          userAgent: req.headers.get('user-agent'),
        },
      })
      return NextResponse.json({
        tempPassword,
        message: 'Password reset. Share the temporary password securely.',
      })
    } catch (error: any) {
      if (error.code === 'P1001' || error.message?.includes('No business found')) {
        return NextResponse.json({ error: 'Database connection error' }, { status: 503 })
      }
      return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/staff/[id]')
  }
}

/**
 * DELETE /api/dashboard/staff/[id]
 * Deactivate / remove a staff member (owner only)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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
      const user = await prisma.user.findUnique({ where: { id: params.id } })
      if (!user || user.businessId !== businessId) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }
      // Don't allow deleting yourself
      if (user.id === (session.user as any).id) {
        return NextResponse.json({ error: 'You cannot remove yourself' }, { status: 400 })
      }
      // Check if this is the last owner
      if (user.role === 'OWNER') {
        const ownerCount = await prisma.user.count({
          where: { businessId, role: 'OWNER' },
        })
        if (ownerCount <= 1) {
          return NextResponse.json({ error: 'Cannot remove the last owner' }, { status: 400 })
        }
      }
      await prisma.user.delete({ where: { id: params.id } })
      // Audit log
      await prisma.auditLog.create({
        data: {
          businessId,
          userId: (session.user as any).id,
          action: 'USER_DEACTIVATED',
          entityType: 'User',
          entityId: params.id,
          oldValues: { email: user.email, name: user.name, role: user.role },
          ipAddress: req.headers.get('x-forwarded-for'),
          userAgent: req.headers.get('user-agent'),
        },
      })
      return NextResponse.json({ success: true })
    } catch (error: any) {
      if (error.code === 'P1001' || error.message?.includes('No business found')) {
        return NextResponse.json({ error: 'Database connection error' }, { status: 503 })
      }
      return NextResponse.json({ error: 'Failed to remove staff member' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/staff/[id]')
  }
}

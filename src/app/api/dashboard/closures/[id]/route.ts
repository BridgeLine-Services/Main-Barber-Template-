export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentBusinessId } from '@/lib/business'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { handleApiError } from '@/lib/api-errors'

const updateClosureSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
  isAllDay: z.boolean().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
}).refine(
  (data) => {
    if (data.startDate === undefined || data.endDate === undefined) return true
    return new Date(data.endDate) >= new Date(data.startDate)
  },
  { message: 'End date must be on or after start date', path: ['endDate'] }
)

/**
 * PATCH /api/dashboard/closures/[id]
 * Edit a business closure, or cancel/reactivate it via isActive.
 * Deleting or editing one closure only ever affects that closure.
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
      return NextResponse.json({ error: 'Only owners can manage closures' }, { status: 403 })
    }
    try {
      const businessId = await getCurrentBusinessId()
      // Tenant-scoped lookup: the closure must belong to the caller's business.
      const closure = await prisma.businessClosure.findFirst({
        where: { id: params.id, businessId },
      })
      if (!closure) {
        return NextResponse.json({ error: 'Closure not found' }, { status: 404 })
      }

      const body = await req.json()
      const parseResult = updateClosureSchema.safeParse(body)
      if (!parseResult.success) {
        return NextResponse.json(
          { error: 'Invalid closure data', details: parseResult.error.flatten().fieldErrors },
          { status: 400 }
        )
      }
      const data = parseResult.data

      const updated = await prisma.businessClosure.update({
        where: { id: params.id },
        data: {
          ...(data.title !== undefined && { title: data.title }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.startDate !== undefined && { startDate: new Date(data.startDate) }),
          ...(data.endDate !== undefined && { endDate: new Date(data.endDate) }),
          ...(data.isAllDay !== undefined && { isAllDay: data.isAllDay }),
          ...(data.startTime !== undefined && {
            startTime: data.isAllDay ? null : data.startTime,
          }),
          ...(data.endTime !== undefined && {
            endTime: data.isAllDay ? null : data.endTime,
          }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
        },
      })

      // Audit log
      await prisma.auditLog.create({
        data: {
          businessId,
          userId: (session.user as any).id,
          action: 'SETTINGS_UPDATED',
          entityType: 'BusinessClosure',
          entityId: params.id,
          oldValues: { title: closure.title, startDate: closure.startDate, endDate: closure.endDate, isActive: closure.isActive } as any,
          newValues: { title: updated.title, startDate: updated.startDate, endDate: updated.endDate, isActive: updated.isActive } as any,
          ipAddress: req.headers.get('x-forwarded-for'),
          userAgent: req.headers.get('user-agent'),
        },
      })
      return NextResponse.json(updated)
    } catch (error: any) {
      if (error.message?.includes('No business found') || error.code === 'P1001') {
        return NextResponse.json({ error: 'Database connection error' }, { status: 503 })
      }
      console.error('Error updating closure:', error)
      return NextResponse.json({ error: 'Failed to update closure' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/closures/[id]')
  }
}

/**
 * DELETE /api/dashboard/closures/[id]
 * Delete a business closure (owner only)
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
      return NextResponse.json({ error: 'Only owners can manage closures' }, { status: 403 })
    }
    try {
      const businessId = await getCurrentBusinessId()
      const closure = await prisma.businessClosure.findUnique({
        where: { id: params.id },
      })
      if (!closure || closure.businessId !== businessId) {
        return NextResponse.json({ error: 'Closure not found' }, { status: 404 })
      }
      await prisma.businessClosure.delete({
        where: { id: params.id },
      })
      // Audit log
      await prisma.auditLog.create({
        data: {
          businessId,
          userId: (session.user as any).id,
          action: 'SETTINGS_UPDATED',
          entityType: 'BusinessClosure',
          entityId: params.id,
          oldValues: closure as any,
          ipAddress: req.headers.get('x-forwarded-for'),
          userAgent: req.headers.get('user-agent'),
        },
      })
      return NextResponse.json({ success: true })
    } catch (error: any) {
      if (error.message?.includes('No business found') || error.code === 'P1001') {
        return NextResponse.json({ error: 'Database connection error' }, { status: 503 })
      }
      console.error('Error deleting closure:', error)
      return NextResponse.json({ error: 'Failed to delete closure' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/closures/[id]')
  }
}

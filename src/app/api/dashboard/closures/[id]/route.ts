export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentBusinessId } from '@/lib/business'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'

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

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentBusinessId } from '@/lib/business'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'

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
    const callerRole = (session.user as { role?: string }).role
    if (callerRole !== 'OWNER' && callerRole !== 'BUSINESS_ADMIN') {
      return NextResponse.json({ error: 'Business owner or admin access required' }, { status: 403 })
    }
    const { id } = await params
    const businessId = await getCurrentBusinessId()

    // Tenant-scoped revoke: only touches invitations of the caller's business.
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

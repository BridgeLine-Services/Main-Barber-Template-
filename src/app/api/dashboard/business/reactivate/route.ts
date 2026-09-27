export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logAudit } from '@/lib/auth-helpers'
import { getClientIP } from '@/lib/rate-limit'
import { z } from 'zod'
import { handleApiError } from '@/lib/api-errors'

const reactivateSchema = z.object({
  confirm: z.literal('REACTIVATE', { message: 'Type REACTIVATE exactly to confirm' }),
})

/**
 * POST /api/dashboard/business/reactivate
 *
 * Clears the soft-deactivation flag: staff sign-ins and public bookings
 * are restored. All data was preserved during deactivation. Owner-only;
 * the businessId comes from the session, never the request body.
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
    const businessId = (session.user as any).businessId
    if (!businessId) {
      return NextResponse.json({ error: 'No business context' }, { status: 400 })
    }

    const parsed = reactivateSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Type REACTIVATE exactly to confirm the reactivation' },
        { status: 400 }
      )
    }

    const business = await prisma.business.findUnique({ where: { id: businessId } })
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 })
    }
    if (!business.deactivatedAt) {
      return NextResponse.json({ error: 'Business is not deactivated' }, { status: 400 })
    }

    await prisma.business.update({
      where: { id: businessId },
      data: { deactivatedAt: null },
    })

    await logAudit({
      userId: (session.user as any).id,
      businessId,
      action: 'BUSINESS_REACTIVATED',
      entityType: 'Business',
      entityId: businessId,
      oldValues: { deactivatedAt: business.deactivatedAt },
      newValues: { deactivatedAt: null },
      ipAddress: getClientIP(req),
    })

    return NextResponse.json({
      success: true,
      note: 'Staff sign-ins and public bookings are restored.',
    })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/business/reactivate')
  }
}

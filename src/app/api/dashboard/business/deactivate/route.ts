export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logAudit } from '@/lib/auth-helpers'
import { getClientIP } from '@/lib/rate-limit'
import { z } from 'zod'
import { handleApiError } from '@/lib/api-errors'

const deactivateSchema = z.object({
  confirm: z.literal('DEACTIVATE', { message: 'Type DEACTIVATE exactly to confirm' }),
})

/**
 * POST /api/dashboard/business/deactivate
 *
 * Soft-deactivates the business: staff sign-ins and public bookings are
 * blocked, while all data is preserved. Owners keep sign-in access for
 * data export and one-click reactivation. Requires the typed confirmation
 * string; the businessId comes from the session, never the request body.
 */
/**
 * GET /api/dashboard/business/deactivate
 * Returns the current deactivation state for the owner's shop.
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
    const businessId = (session.user as any).businessId
    const business = businessId
      ? await prisma.business.findUnique({ where: { id: businessId }, select: { deactivatedAt: true } })
      : null
    return NextResponse.json({ deactivatedAt: business?.deactivatedAt ?? null })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/business/deactivate')
  }
}

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

    const parsed = deactivateSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Type DEACTIVATE exactly to confirm the deactivation' },
        { status: 400 }
      )
    }

    const business = await prisma.business.findUnique({ where: { id: businessId } })
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 })
    }
    if (business.deactivatedAt) {
      return NextResponse.json({ error: 'Business is already deactivated' }, { status: 400 })
    }

    const updated = await prisma.business.update({
      where: { id: businessId },
      data: { deactivatedAt: new Date() },
    })

    await logAudit({
      userId: (session.user as any).id,
      businessId,
      action: 'BUSINESS_DEACTIVATED',
      entityType: 'Business',
      entityId: businessId,
      newValues: { deactivatedAt: updated.deactivatedAt },
      ipAddress: getClientIP(req),
    })

    return NextResponse.json({
      success: true,
      deactivatedAt: updated.deactivatedAt,
      note: 'Staff sign-ins and public bookings are blocked. Owners keep access for data export and reactivation.',
    })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/business/deactivate')
  }
}

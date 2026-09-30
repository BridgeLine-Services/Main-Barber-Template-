export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaff } from '@/lib/auth-helpers'
import { getBusinessIdForUser } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'
import type { Prisma } from '@prisma/client'
import { NotificationStatus } from '@prisma/client'

/**
 * GET /api/dashboard/notifications
 * Returns notification delivery logs (OWNER and BARBER)
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireStaff()
    if (!auth.success) return auth.response
    try {
      const businessId = await getBusinessIdForUser(auth.user)
      const searchParams = req.nextUrl.searchParams
      const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
      const status = searchParams.get('status')
      const where: Prisma.NotificationLogWhereInput = { businessId }
      if (status) {
        const s = status.toUpperCase() as NotificationStatus
        if (Object.values(NotificationStatus).includes(s)) where.status = s
      }
      const logs = await prisma.notificationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return NextResponse.json({ logs })
    } catch (error) {
      console.error('[notifications] request failed', error)
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/notifications')
  }
}

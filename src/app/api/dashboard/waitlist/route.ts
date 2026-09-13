export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentBusinessId } from '@/lib/business'
import { startOfDayUTC } from '@/lib/timezone'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * GET /api/dashboard/waitlist
 * List all waitlist entries (owner/barber)
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const businessId = await getCurrentBusinessId()
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    })
    const todayStart = startOfDayUTC(business?.timezone || 'America/Los_Angeles')
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)
    const { searchParams } = req.nextUrl
    const status = searchParams.get('status')

    const where: any = { businessId }
    if (status) where.status = status.toUpperCase()

    const entries = await prisma.waitlistEntry.findMany({
      where,
      include: {
        barber: { select: { name: true } },
        service: { select: { name: true, duration: true, price: true } },
        customer: { select: { firstName: true, lastName: true, phone: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Walk-in queue entries: preferredTimeRange 'walk-in' + today's business day.
    // Computed server-side so the dashboard UI stays timezone-correct.
    const withQueueMeta = entries.map((entry) => ({
      ...entry,
      isWalkInToday:
        entry.preferredTimeRange === 'walk-in' &&
        entry.preferredDate.getTime() >= todayStart.getTime() &&
        entry.preferredDate.getTime() < todayEnd.getTime(),
    }))

    return NextResponse.json({ entries: withQueueMeta })
  } catch (error: any) {
    if (error.message?.includes('No business found') || error.code === 'P1001') {
      return NextResponse.json({ error: 'Database not available' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Failed to fetch waitlist' }, { status: 500 })
  }
}

/**
 * PATCH /api/dashboard/waitlist
 * Update a waitlist entry status (e.g. mark as NOTIFIED or BOOKED)
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { id, status } = body

    if (!id || !status) {
      return NextResponse.json({ error: 'Missing id or status' }, { status: 400 })
    }

    const businessId = await getCurrentBusinessId()

    const entry = await prisma.waitlistEntry.findUnique({ where: { id } })
    if (!entry || entry.businessId !== businessId) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    const normalizedStatus = String(status).toUpperCase()
    const allowedStatuses = ['WAITING', 'NOTIFIED', 'BOOKED', 'EXPIRED', 'CANCELLED']
    if (!allowedStatuses.includes(normalizedStatus)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    const result = await prisma.waitlistEntry.updateMany({
      where: {
        id,
        businessId,
        status: entry.status,
        ...(normalizedStatus === 'NOTIFIED' ? { status: 'WAITING' } : {}),
      },
      data: {
        status: normalizedStatus as any,
        notifiedAt: normalizedStatus === 'NOTIFIED' ? new Date() : entry.notifiedAt,
      },
    })
    if (result.count !== 1) {
      return NextResponse.json({ error: 'Entry was already updated' }, { status: 409 })
    }
    const updated = await prisma.waitlistEntry.findUnique({ where: { id } })
    return NextResponse.json({ entry: updated })
  } catch (error: any) {
    if (error.code === 'P1001' || error.message?.includes('No business found')) {
      return NextResponse.json({ error: 'Database connection error' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 })
  }
}

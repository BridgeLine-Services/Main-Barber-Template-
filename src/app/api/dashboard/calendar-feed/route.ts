import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateICalFeed } from '@/lib/calendar-sync'

// GET /api/dashboard/calendar-feed.ics — iCal feed for owner/barber
export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = session.user as any
  const businessId = user.businessId

  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true, timezone: true },
    })

    const whereFilter: any = {
      businessId,
      startTime: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // last 7 days + future
    }

    if (user.role === 'BARBER' && user.barberId) {
      whereFilter.barberId = user.barberId
    }

    const appointments = await prisma.appointment.findMany({
      where: whereFilter,
      include: {
        customer: { select: { firstName: true, lastName: true } },
        barber: { select: { name: true } },
        service: { select: { name: true, duration: true } },
      },
      orderBy: { startTime: 'asc' },
    })

    const ics = generateICalFeed(business?.name || 'Barber Shop', appointments, business?.timezone || 'UTC')

    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="appointments.ics"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (error) {
    console.error('Calendar feed error:', error)
    return NextResponse.json({ error: 'Failed to generate calendar feed' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const barberId = searchParams.get('barberId')
  const serviceId = searchParams.get('serviceId')
  const startTime = searchParams.get('startTime')
  const opening = startTime ? new Date(startTime) : null
  if (!barberId || !serviceId || !opening || Number.isNaN(opening.getTime())) {
    return NextResponse.json({ error: 'barberId, serviceId, and a valid startTime are required' }, { status: 400 })
  }

  const businessId = session.user.businessId
  const candidates = await prisma.customer.findMany({
    where: {
      businessId,
      smsConsent: true,
      appointments: {
        some: { businessId, barberId, serviceId, status: 'COMPLETED' },
        none: { businessId, startTime: { gte: new Date() }, status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULED'] } },
      },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      appointments: {
        where: { businessId, barberId, serviceId, status: 'COMPLETED' },
        orderBy: { startTime: 'desc' },
        take: 3,
        select: { startTime: true, endTime: true },
      },
    },
    take: 25,
  })

  const ranked = candidates
    .map((customer) => {
      const last = customer.appointments[0]
      const daysSinceVisit = last ? Math.max(0, Math.floor((Date.now() - last.startTime.getTime()) / 86400000)) : 0
      const visitCount = customer.appointments.length
      return {
        id: customer.id,
        name: `${customer.firstName} ${customer.lastName}`,
        phone: customer.phone,
        visitCount,
        daysSinceVisit,
        score: visitCount * 10 + Math.min(daysSinceVisit, 60),
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)

  return NextResponse.json({ candidates: ranked, opening: { barberId, serviceId, startTime: opening.toISOString() } })
}

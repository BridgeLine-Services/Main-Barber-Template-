export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveBusiness } from '@/lib/tenant'
import { startOfDayUTC } from '@/lib/timezone'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import {
  computeQueuePositions,
  entriesAheadOf,
  estimateWaitMinutes,
  WALK_IN_TIME_RANGE,
} from '@/lib/queue'

// Public walk-in queue join. The queue REUSES the WaitlistEntry model —
// ONE queue system, no duplicate engine. A walk-in is a WaitlistEntry with
// preferredTimeRange 'walk-in' and preferredDate = current business day.

const joinQueueSchema = z.object({
  firstName: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(50),
  phone: z.string().trim().min(7).max(20).regex(/^[+0-9()\-\s.]+$/, 'Invalid phone number'),
  email: z.string().trim().email().max(120).optional().or(z.literal('')),
  serviceId: z.string().min(1),
  barberId: z.string().min(1).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
})

export async function POST(req: NextRequest) {
  const rateLimitResult = checkRateLimit(req, 'public-queue', RATE_LIMITS.QUEUE)
  if (rateLimitResult) {
    return NextResponse.json(rateLimitResult.body, { status: rateLimitResult.status })
  }

  const business = await resolveBusiness().catch(() => null)
  if (!business) {
    return NextResponse.json({ success: false, error: 'Queue unavailable' }, { status: 404 })
  }

  // Gated by the business's own walk-in setting
  if (business.walkInsWelcome !== true) {
    return NextResponse.json(
      { success: false, error: 'This shop is not accepting walk-in queue joins right now.' },
      { status: 403 }
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = joinQueueSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid queue join', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }
  const data = parsed.data

  // Tenant-scoped validation: the service and barber must belong to THIS business
  const service = await prisma.service.findFirst({
    where: { id: data.serviceId, businessId: business.id, isActive: true },
    select: { id: true, name: true, duration: true },
  })
  if (!service) {
    return NextResponse.json({ success: false, error: 'Service not available at this shop' }, { status: 400 })
  }
  if (data.barberId) {
    const barber = await prisma.barber.findFirst({
      where: { id: data.barberId, businessId: business.id, isActive: true },
      select: { id: true },
    })
    if (!barber) {
      return NextResponse.json({ success: false, error: 'Barber not available at this shop' }, { status: 400 })
    }
  }

  const today = startOfDayUTC(business.timezone)

  // Prevent duplicate active queue joins from the same phone today
  const existing = await prisma.waitlistEntry.findFirst({
    where: {
      businessId: business.id,
      phone: data.phone,
      status: 'WAITING',
      preferredDate: today,
      preferredTimeRange: WALK_IN_TIME_RANGE,
    },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json(
      { success: false, error: 'You are already in the queue.', entryId: existing.id },
      { status: 409 }
    )
  }

  const entry = await prisma.waitlistEntry.create({
    data: {
      businessId: business.id,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      email: data.email || '',
      serviceId: service.id,
      barberId: data.barberId || null,
      preferredDate: today,
      preferredTimeRange: WALK_IN_TIME_RANGE,
      status: 'WAITING',
      notes: data.notes || null,
    },
    include: { service: { select: { duration: true } } },
  })

  // Position + honest estimate: sum of service times ahead ÷ active barbers
  const waitingEntries = await prisma.waitlistEntry.findMany({
    where: {
      businessId: business.id,
      status: 'WAITING',
      preferredDate: today,
      preferredTimeRange: WALK_IN_TIME_RANGE,
    },
    include: { service: { select: { duration: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const positions = computeQueuePositions(waitingEntries)
  const position = positions.get(entry.id) ?? waitingEntries.length
  const activeBarbers = await prisma.barber.count({
    where: { businessId: business.id, isActive: true },
  })
  const estimatedWaitMinutes = estimateWaitMinutes(entriesAheadOf(entry, waitingEntries), activeBarbers)

  return NextResponse.json(
    {
      success: true,
      entryId: entry.id,
      position,
      estimatedWaitMinutes,
      statusUrl: `/queue/${entry.id}`,
    },
    { status: 201 }
  )
}

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatInTimezone } from '@/lib/timezone'
import { handleApiError } from '@/lib/api-errors'

// GET /api/dashboard/barber-mode/history?customerId=...
//
// Barber-scoped customer history for the Barber Mode work surface.
// ROLE ENFORCEMENT:
//   - A BARBER receives only the appointments of this customer that are
//     WITH THIS BARBER (their own barber relationship) — never other
//     barbers' appointment details.
//   - An OWNER with a linked barber profile receives the same scoped view
//     when using Barber Mode (owners keep their full CRM elsewhere).
// TENANT ISOLATION: every query is businessId-scoped; a customer id from
//     another business resolves to 404.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const user = session.user as any
    const businessId = user?.businessId
    const barberId = user?.barberId
    if (!businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!barberId) {
      return NextResponse.json(
        { error: 'This view requires a linked barber profile' },
        { status: 403 }
      )
    }
    const customerId = new URL(req.url).searchParams.get('customerId')
    if (!customerId) {
      return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
    }
    // Tenant isolation: the customer must belong to this business.
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, businessId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        notes: true,
        preferences: true,
      },
    })
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    // Barber-scoped history: only this customer's appointments WITH THIS BARBER.
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    })
    const timezone = business?.timezone || 'UTC'
    const appointments = await prisma.appointment.findMany({
      where: {
        customerId,
        businessId,
        barberId,
        status: { in: ['COMPLETED', 'CONFIRMED', 'PENDING', 'NO_SHOW', 'RESCHEDULED'] },
      },
      include: {
        service: { select: { id: true, name: true, duration: true, price: true, recommendedRebookingIntervalDays: true } },
      },
      orderBy: { startTime: 'desc' },
      take: 25,
    })
    const completed = appointments.filter((a) => a.status === 'COMPLETED')
    const visits = completed.length
    const lastVisit = completed[0]
      ? formatInTimezone(completed[0].startTime, timezone, 'MMM d, yyyy')
      : null
    // Rebooking hint from the existing retention settings (no new engine):
    // the recommended interval comes from the service of the last completed
    // visit, falling back to the business retention default.
    const retention = await prisma.retentionSettings.findUnique({
      where: { businessId },
      select: { defaultRebookingIntervalDays: true, dueSoonWindowDays: true },
    })
    let rebooking: {
      dueDate: string | null
      dueSoon: boolean
      recommendedIntervalDays: number | null
    } = { dueDate: null, dueSoon: false, recommendedIntervalDays: null }
    if (lastVisit != null) {
      const lastService = completed[0]?.service
      const intervalDays =
        lastService?.recommendedRebookingIntervalDays ??
        retention?.defaultRebookingIntervalDays ??
        null
      if (intervalDays != null) {
        const due = new Date(completed[0].startTime)
        due.setUTCDate(due.getUTCDate() + intervalDays)
        const windowDays = retention?.dueSoonWindowDays ?? 5
        const now = new Date()
        const dueSoonMs = due.getTime() - now.getTime() <= windowDays * 86_400_000
        rebooking = {
          dueDate: formatInTimezone(due, timezone, 'MMM d, yyyy'),
          dueSoon: due <= now || dueSoonMs,
          recommendedIntervalDays: intervalDays,
        }
      }
    }
    return NextResponse.json({
      customer,
      appointments: appointments.map((a) => ({
        id: a.id,
        confirmationNumber: a.confirmationNumber,
        status: a.status,
        startTime: a.startTime.toISOString(),
        endTime: a.endTime.toISOString(),
        dateLabel: formatInTimezone(a.startTime, timezone, 'MMM d, yyyy'),
        timeLabel: formatInTimezone(a.startTime, timezone, 'h:mm a'),
        service: a.service,
        customerNotes: a.customerNotes,
      })),
      summary: { visits, lastVisit },
      rebooking,
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/barber-mode/history')
  }
}

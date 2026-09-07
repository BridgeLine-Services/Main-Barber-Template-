export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { resolveBusinessId } from '@/lib/tenant'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { prisma } from '@/lib/prisma'
import { dayBoundsFromYMD, dayOfWeekFromYMD } from '@/lib/timezone'

/**
 * GET /api/availability/check?serviceId=X&barberId=Y&month=YYYY-MM
 *
 * Returns a lightweight map of dates → hasAvailability (boolean) for an
 * entire month. Used by the date picker to show visual indicators on
 * days that have open slots, without loading all the slot details.
 *
 * Response: { dates: { "2026-08-15": true, "2026-08-16": false, ... } }
 */
export async function GET(req: NextRequest) {
  const rateLimitResult = checkRateLimit(req, 'availability-check', RATE_LIMITS.AVAILABILITY)
  if (rateLimitResult) {
    return NextResponse.json({ error: 'Too many requests' }, { status: rateLimitResult.status })
  }

  try {
    const { searchParams } = req.nextUrl
    const serviceId = searchParams.get('serviceId')
    const barberId = searchParams.get('barberId')
    const monthStr = searchParams.get('month') // "YYYY-MM"

    if (!serviceId || !monthStr) {
      return NextResponse.json(
        { error: 'serviceId and month (YYYY-MM) are required' },
        { status: 400 }
      )
    }

    const [year, month] = monthStr.split('-').map(Number)
    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Invalid month format. Use YYYY-MM' }, { status: 400 })
    }

    const businessId = await resolveBusinessId()

    // Get the business timezone
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    })
    const timezone = business?.timezone || 'America/New_York'

    // Get all barbers to check (or specific barber)
    let barberIds: string[] = []
    if (barberId && barberId !== 'any' && barberId !== 'first-available') {
      // Verify the requested barber belongs to this business (tenant isolation)
      const verifiedBarber = await prisma.barber.findFirst({
        where: { id: barberId, businessId, isActive: true },
        select: { id: true },
      })
      if (!verifiedBarber) {
        return NextResponse.json({ dates: {} })
      }
      barberIds = [verifiedBarber.id]
    } else {
      const barbers = await prisma.barber.findMany({
        where: { businessId, isActive: true },
        select: { id: true },
      })
      barberIds = barbers.map(b => b.id)
    }

    if (barberIds.length === 0) {
      return NextResponse.json({ dates: {} })
    }

    // Get the service duration
    const service = await prisma.service.findFirst({
      where: { id: serviceId, businessId, isActive: true },
      select: { duration: true },
    })
    if (!service) {
      return NextResponse.json({ dates: {} })
    }

    // For each day in the month, check if any barber has any available slot
    const daysInMonth = new Date(year, month, 0).getDate()
    const dates: Record<string, boolean> = {}
    const now = new Date()

    // Batch fetch all schedules for these barbers
    const schedules = await prisma.schedule.findMany({
      where: { barberId: { in: barberIds } },
    })
    const scheduleMap = new Map<string, typeof schedules[number]>()
    for (const s of schedules) {
      const key = `${s.barberId}-${s.dayOfWeek}`
      scheduleMap.set(key, s)
    }

    // Batch fetch all appointments for the month
    const { start: monthStartUTC, end: monthEndUTC } = dayBoundsFromYMD(timezone, year, month, 1)
    const appointments = await prisma.appointment.findMany({
      where: {
        businessId,
        barberId: { in: barberIds },
        status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULED'] },
        startTime: { gte: monthStartUTC, lt: monthEndUTC },
      },
      select: { barberId: true, startTime: true, endTime: true },
    })

    // Batch fetch blocked times for the month
    const blockedTimes = await prisma.blockedTime.findMany({
      where: {
        businessId,
        OR: [{ barberId: { in: barberIds } }, { barberId: null }],
        startTime: { gte: monthStartUTC, lt: monthEndUTC },
      },
      select: { barberId: true, startTime: true, endTime: true },
    })

    // Group appointments by barberId for quick lookup
    const apptsByBarber = new Map<string, typeof appointments>()
    for (const a of appointments) {
      if (!apptsByBarber.has(a.barberId)) apptsByBarber.set(a.barberId, [])
      apptsByBarber.get(a.barberId)!.push(a)
    }

    // Check each day
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const { start: dayStartUTC, end: dayEndUTC } = dayBoundsFromYMD(timezone, year, month, day)
      const dayOfWeek = dayOfWeekFromYMD(timezone, year, month, day)

      // Skip past days
      if (dayEndUTC < now) {
        dates[dateStr] = false
        continue
      }

      // Check if any barber has at least one open slot
      let hasAvailability = false

      for (const barberId of barberIds) {
        const schedule = scheduleMap.get(`${barberId}-${dayOfWeek}`)
        if (!schedule || schedule.isOff) continue

        // Check if there's at least one slot without a conflicting appointment
        const barberAppts = (apptsByBarber.get(barberId) || []).filter(
          a => a.startTime < dayEndUTC && a.endTime > dayStartUTC
        )

        const barberBlocks = blockedTimes.filter(
          b => (b.barberId === barberId || b.barberId === null) &&
               b.startTime < dayEndUTC && b.endTime > dayStartUTC
        )

        // Simple heuristic: if the barber is scheduled and has fewer than
        // (working hours / service duration) appointments, there's likely availability.
        // This is a fast check — the actual slot availability is verified when the
        // user selects a date and loads the full availability.
        const scheduleDuration = schedule.endTime ? schedule.endTime : '17:00'
        const [startH, startM] = (schedule.startTime || '09:00').split(':').map(Number)
        const [endH, endM] = (scheduleDuration).split(':').map(Number)
        const workingMinutes = (endH * 60 + endM) - (startH * 60 + startM)
        const maxAppointments = Math.floor(workingMinutes / service.duration)
        const conflictCount = barberAppts.length + barberBlocks.length

        if (conflictCount < maxAppointments) {
          hasAvailability = true
          break
        }
      }

      dates[dateStr] = hasAvailability
    }

    return NextResponse.json({ dates })
  } catch (error: any) {
    console.error('Availability check error:', error)

    // Return empty (no indicators) on error — don't block the calendar
    return NextResponse.json({ dates: {} })
  }
}

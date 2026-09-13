/**
 * Daily Operations / Empty Chair Dashboard
 * ---------------------------------------
 * A fast operational summary of today: appointments by status, current/next
 * appointments, open (empty chair) time per barber, a scheduled-service-value
 * estimate, and a simple utilization metric.
 *
 * This is NOT an analytics platform: it reuses the existing appointment,
 * barber, service, schedule, and availability data with a small number of
 * indexed server-side queries, and the same working-window rules as the
 * availability engine (recurring schedule, per-date overrides, breaks,
 * blocked time, closures).
 */

import { prisma } from '@/lib/prisma'
import { getBusinessTimezone } from '@/lib/availability'
import {
  dayBoundsFromYMD,
  localTimeToUTCFromYMD,
  dayOfWeekFromYMD,
  dateOnlyUTCFromYMD,
} from '@/lib/timezone'

/** Minimum length (minutes) for a gap to be presented as an open slot. */
export const MIN_OPEN_GAP_MINUTES = 15

export interface WorkingWindow {
  start: Date
  end: Date
  breaks: Array<{ start: Date; end: Date }>
}

export interface Range {
  start: Date
  end: Date
}

/**
 * Pure: subtract busy ranges from a window, returning the remaining free
 * ranges in order. Busy ranges may overlap each other and extend past the
 * window. This accounts for appointments, breaks, blocked time, and
 * closures in one pass — it never assumes gaps between appointments are
 * free without subtracting the shop's own non-bookable time.
 */
export function computeFreeRanges(window: Range, busy: Range[]): Range[] {
  // Normalize and clip busy ranges to the window
  const clipped: Range[] = []
  for (const b of busy) {
    const start = b.start < window.start ? window.start : b.start
    const end = b.end > window.end ? window.end : b.end
    if (start < end) clipped.push({ start, end })
  }
  clipped.sort((a, b) => a.start.getTime() - b.start.getTime())

  const free: Range[] = []
  let cursor = window.start
  for (const c of clipped) {
    if (c.start > cursor) free.push({ start: cursor, end: c.start })
    if (c.end > cursor) cursor = c.end
  }
  if (window.end > cursor) free.push({ start: cursor, end: window.end })
  return free
}

/** Pure: total minutes a list of ranges overlaps a window. */
export function minutesWithin(window: Range, ranges: Range[]): number {
  let minutes = 0
  for (const r of ranges) {
    const start = r.start < window.start ? window.start : r.start
    const end = r.end > window.end ? window.end : r.end
    if (start < end) minutes += (end.getTime() - start.getTime()) / 60000
  }
  return minutes
}

export interface UtilizationResult {
  scheduledMinutes: number
  availableMinutes: number
  utilizationPct: number | null // null when there is no bookable time today
}

/**
 * Pure: barber utilization for a working day.
 *
 * Definitions (kept deliberately simple and clearly labeled in the UI):
 * - Scheduled minutes: total duration of today's appointments that occupy
 *   the chair (PENDING, CONFIRMED, RESCHEDULED, COMPLETED), clipped to the
 *   barber's working window.
 * - Available minutes: the working window minus breaks, blocked time, and
 *   partial-day closures.
 * - Utilization: scheduled / available. Over 100% is possible if an
 *   appointment slightly exceeds the window; it is capped for display.
 */
export function computeUtilization(
  window: Range,
  appointments: Range[],
  breaks: Range[],
  blocked: Range[]
): UtilizationResult {
  const busyMinutes = minutesWithin(window, [...breaks, ...blocked])
  const availableMinutes = Math.max(0, (window.end.getTime() - window.start.getTime()) / 60000 - busyMinutes)
  const scheduledMinutes = minutesWithin(window, appointments)
  const utilizationPct = availableMinutes > 0 ? (scheduledMinutes / availableMinutes) * 100 : null
  return { scheduledMinutes, availableMinutes, utilizationPct }
}

/** Pure: effective price for an appointment, respecting per-barber overrides. */
export function effectivePrice(basePrice: number | null | undefined, overridePrice: number | null | undefined): number {
  if (typeof overridePrice === 'number') return overridePrice
  return typeof basePrice === 'number' ? basePrice : 0
}

export interface BarberDayStatus {
  barberId: string
  barberName: string
  isWorkingToday: boolean
  workingWindow: { start: string; end: string } | null
  utilization: UtilizationResult | null
  openRanges: Array<{ start: string; end: string; minutes: number }>
  current: { customerName: string; serviceName: string; endTime: string } | null
  next: { customerName: string; serviceName: string; startTime: string } | null
}

export interface DailyOperationsSnapshot {
  dateStr: string
  timezone: string
  totals: {
    appointmentsToday: number
    completed: number
    upcoming: number
    cancelled: number
    noShows: number
    activeBarbers: number
  }
  scheduledServiceValue: number
  barbers: BarberDayStatus[]
}

export async function getDailyOperationsSnapshot(businessId: string, dateStr: string): Promise<DailyOperationsSnapshot> {
  const timezone = await getBusinessTimezone(businessId)
  const [year, month, day] = dateStr.split('-').map(Number)
  const { start: dayStart, end: dayEnd } = dayBoundsFromYMD(timezone, year, month, day)
  const dayOfWeek = dayOfWeekFromYMD(timezone, year, month, day)
  const now = new Date()

  // Barbers first — Schedule and BarberService are keyed by barberId (no
  // businessId column), so tenant scoping for those goes through this list.
  const barbers = await prisma.barber.findMany({
    where: { businessId, isActive: true },
    select: { id: true, name: true },
  })
  const barberIds = barbers.map((b) => b.id)

  // Single indexed queries (all filtered by businessId/barberIds and the day
  // window; Appointment has @@index([businessId, startTime])).
  const [appointments, schedules, overrides, blockedTimes, closures, barberServices] = await Promise.all([
    prisma.appointment.findMany({
      where: { businessId, startTime: { gte: dayStart, lt: dayEnd } },
      include: {
        customer: { select: { firstName: true, lastName: true } },
        service: { select: { id: true, name: true, price: true } },
      },
    }),
    barberIds.length
      ? prisma.schedule.findMany({ where: { barberId: { in: barberIds }, dayOfWeek } })
      : Promise.resolve([]),
    prisma.availabilityOverride.findMany({
      where: { businessId, date: dateOnlyUTCFromYMD(year, month, day) },
    }),
    prisma.blockedTime.findMany({
      where: { businessId, startTime: { lt: dayEnd }, endTime: { gt: dayStart } },
    }),
    prisma.businessClosure.findMany({
      where: { businessId, isActive: true, startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
    }),
    barberIds.length
      ? prisma.barberService.findMany({
          where: { barberId: { in: barberIds }, isActive: true },
          select: { barberId: true, serviceId: true, priceOverride: true, durationOverride: true },
        })
      : Promise.resolve([]),
  ])

  const scheduleByBarber = new Map(schedules.map((s) => [s.barberId, s]))
  const overrideByBarber = new Map(overrides.map((o) => [o.barberId, o]))
  const priceOverrideMap = new Map(
    barberServices.map((bs) => [`${bs.barberId}:${bs.serviceId}`, bs.priceOverride])
  )

  // ── Status totals ────────────────────────────────────────────────────────
  const count = (statuses: string[]) => appointments.filter((a) => statuses.includes(a.status)).length
  const upcoming = appointments.filter(
    (a) =>
      a.startTime > now &&
      ['PENDING', 'CONFIRMED', 'RESCHEDULED'].includes(a.status)
  )

  // ── Scheduled service value ──────────────────────────────────────────────
  // Clearly a scheduled-value estimate, NOT collected revenue: it sums the
  // effective price (barber override > service base) of today's appointments
  // that occupy the chair.
  const chairStatuses = ['PENDING', 'CONFIRMED', 'RESCHEDULED', 'COMPLETED']
  const scheduledServiceValue = appointments
    .filter((a) => chairStatuses.includes(a.status))
    .reduce(
      (sum, a) => sum + effectivePrice(a.service?.price, priceOverrideMap.get(`${a.barberId}:${a.service?.id ?? ''}`)),
      0
    )

  // ── Per-barber open time / utilization / current & next ──────────────────
  const barberStatuses: BarberDayStatus[] = []

  for (const barber of barbers) {
    const schedule = scheduleByBarber.get(barber.id)
    const override = overrideByBarber.get(barber.id)

    // Same working-window resolution rules as the availability engine:
    // an override for the date fully replaces the recurring schedule;
    // isAvailable=false means off for the day.
    let workingStart: string | null = null
    let workingEnd: string | null = null
    let workingBreaks: Array<{ start: string; end: string }> = []
    if (override) {
      if (!override.isAvailable) {
        workingStart = null
      } else if (override.startTime && override.endTime) {
        workingStart = override.startTime
        workingEnd = override.endTime
        if (override.breaks && Array.isArray(override.breaks)) {
          workingBreaks = override.breaks as Array<{ start: string; end: string }>
        }
      }
    } else if (schedule && !schedule.isOff) {
      workingStart = schedule.startTime
      workingEnd = schedule.endTime
      if (schedule.breaks && Array.isArray(schedule.breaks)) {
        workingBreaks = schedule.breaks as Array<{ start: string; end: string }>
      }
    }

    if (!workingStart || !workingEnd) {
      barberStatuses.push({
        barberId: barber.id,
        barberName: barber.name,
        isWorkingToday: false,
        workingWindow: null,
        utilization: null,
        openRanges: [],
        current: null,
        next: null,
      })
      continue
    }

    const window: Range = {
      start: localTimeToUTCFromYMD(workingStart, year, month, day, timezone),
      end: localTimeToUTCFromYMD(workingEnd, year, month, day, timezone),
    }
    const breaks: Range[] = workingBreaks
      .filter((b) => b && typeof b === 'object' && 'start' in b && 'end' in b)
      .map((b) => ({
        start: localTimeToUTCFromYMD(String(b.start), year, month, day, timezone),
        end: localTimeToUTCFromYMD(String(b.end), year, month, day, timezone),
      }))

    // Blocked time for this barber (or shop-wide barberId null)
    const blocked: Range[] = blockedTimes
      .filter((bt) => bt.barberId === barber.id || bt.barberId === null)
      .map((bt) => ({ start: bt.startTime, end: bt.endTime }))

    // Partial-day closures add to blocked time; all-day closure closes the day
    let allDayClosed = false
    for (const closure of closures) {
      if (closure.isAllDay) {
        allDayClosed = true
        continue
      }
      if (closure.startTime && closure.endTime) {
        blocked.push({
          start: localTimeToUTCFromYMD(closure.startTime, year, month, day, timezone),
          end: localTimeToUTCFromYMD(closure.endTime, year, month, day, timezone),
        })
      }
    }

    // Appointments occupying the chair today for this barber
    const chairAppointments = appointments.filter(
      (a) => a.barberId === barber.id && chairStatuses.includes(a.status)
    )
    const appointmentRanges: Range[] = chairAppointments.map((a) => ({
      start: a.startTime,
      end: a.endTime,
    }))

    // Cancelled / no-show appointments do NOT keep the chair busy
    let utilization: UtilizationResult | null = null
    let openRanges: Range[] = []
    if (!allDayClosed) {
      utilization = computeUtilization(window, appointmentRanges, breaks, blocked)
      const busy = [...appointmentRanges, ...breaks, ...blocked]
      // Open time is only shown from "now" forward
      const futureWindow: Range = { start: window.start > now ? window.start : now, end: window.end }
      if (futureWindow.start < futureWindow.end) {
        openRanges = computeFreeRanges(futureWindow, busy)
      }
    }

    // Current / next appointment (active statuses only)
    const activeSorted = appointments
      .filter((a) => a.barberId === barber.id && ['PENDING', 'CONFIRMED', 'RESCHEDULED'].includes(a.status))
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    const current = activeSorted.find((a) => a.startTime <= now && a.endTime > now)
    const next = activeSorted.find((a) => a.startTime > now)

    barberStatuses.push({
      barberId: barber.id,
      barberName: barber.name,
      isWorkingToday: true,
      workingWindow: { start: window.start.toISOString(), end: window.end.toISOString() },
      utilization,
      openRanges: openRanges
        .filter((r) => (r.end.getTime() - r.start.getTime()) / 60000 >= MIN_OPEN_GAP_MINUTES)
        .map((r) => ({
          start: r.start.toISOString(),
          end: r.end.toISOString(),
          minutes: Math.round((r.end.getTime() - r.start.getTime()) / 60000),
        })),
      current: current
        ? {
            customerName: `${current.customer.firstName} ${current.customer.lastName}`,
            serviceName: current.service?.name || '',
            endTime: current.endTime.toISOString(),
          }
        : null,
      next: next
        ? {
            customerName: `${next.customer.firstName} ${next.customer.lastName}`,
            serviceName: next.service?.name || '',
            startTime: next.startTime.toISOString(),
          }
        : null,
    })
  }

  return {
    dateStr,
    timezone,
    totals: {
      appointmentsToday: appointments.length,
      completed: count(['COMPLETED']),
      upcoming: upcoming.length,
      cancelled: count(['CANCELLED']),
      noShows: count(['NO_SHOW']),
      activeBarbers: barberStatuses.filter((b) => b.isWorkingToday).length,
    },
    scheduledServiceValue,
    barbers: barberStatuses,
  }
}

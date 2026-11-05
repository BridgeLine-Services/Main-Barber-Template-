import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { BookingSource } from '@prisma/client'
import { generateConfirmationNumber, generateCustomerAccessToken } from '@/lib/utils'
import { addMinutes, format } from 'date-fns'
import {
  dayBoundsFromYMD,
  localTimeToUTCFromYMD,
  dayOfWeekFromYMD,
  formatInTimezone,
  dateOnlyUTCFromYMD,
  toLocalDate,
  resolveBusinessTimezone,
} from '@/lib/timezone'

// ============================================================================
// Availability Engine
// The server — NOT the browser — determines whether a slot is available.
// Double-booking protection uses a database transaction with a unique check.
//
// CRITICAL TIMEZONE HANDLING:
// All date/time computations use the BUSINESS TIMEZONE via year/month/day
// components, not JS Date objects (which depend on the server's local timezone).
// On Vercel (UTC), using new Date(year, month-1, day) would be midnight UTC,
// which is off by one day for non-UTC businesses.
// ============================================================================

// Cache business timezone lookups within a request
const tzCache = new Map<string, string>()

export async function getBusinessTimezone(businessId: string): Promise<string> {
  if (tzCache.has(businessId)) return tzCache.get(businessId)!
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { timezone: true },
  })
  const tz = resolveBusinessTimezone(business)
  tzCache.set(businessId, tz)
  return tz
}

/**
 * Generate available time slots for a given barber + service on a specific date.
 *
 * @param dateStr - ISO date string "YYYY-MM-DD" representing the calendar day
 *                 in the business timezone
 */
export async function getAvailableSlots(params: {
  businessId: string
  barberId: string
  serviceId: string
  date: Date // the calendar day to check
  dateStr?: string // "YYYY-MM-DD" — preferred for timezone accuracy
}): Promise<{ time: string; available: boolean }[]> {
  const { businessId, barberId, serviceId, date } = params

  // Get business timezone for all date computations
  const timezone = await getBusinessTimezone(businessId)

  // Extract year/month/day — use dateStr if provided (timezone-safe),
  // otherwise fall back to the Date object's UTC values
  let year: number, month: number, day: number
  if (params.dateStr) {
    const parts = params.dateStr.split('-').map(Number)
    year = parts[0]; month = parts[1]; day = parts[2]
  } else {
    // Use UTC methods to avoid server-local timezone interference
    year = date.getUTCFullYear()
    month = date.getUTCMonth() + 1
    day = date.getUTCDate()
  }

  // Compute day boundaries in the business timezone, converted to UTC for DB queries
  const { start: dayStartUTC, end: dayEndUTC } = dayBoundsFromYMD(timezone, year, month, day)

  // Determine day of week in the business timezone
  const dayOfWeek = dayOfWeekFromYMD(timezone, year, month, day)

  // Parallel: service info, barber schedule, appointments, blocked times, closures, overrides
  const [service, business, barberService, schedule, appointments, blockedTimes, closures, override] = await Promise.all([
    prisma.service.findFirst({ where: { id: serviceId, businessId, isActive: true } }),
    prisma.business.findUnique({ where: { id: businessId }, select: { minAdvanceBookingMinutes: true, maxBookingWindowDays: true, bufferMinutes: true } }),
    prisma.barberService.findUnique({ where: { barberId_serviceId: { barberId, serviceId } } }),
    prisma.schedule.findUnique({ where: { barberId_dayOfWeek: { barberId, dayOfWeek } } }),
    prisma.appointment.findMany({
      where: {
        businessId,
        barberId,
        status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULED'] },
        startTime: {
          gte: dayStartUTC,
          lt: dayEndUTC,
        },
      },
    }),
    prisma.blockedTime.findMany({
      where: {
        businessId,
        OR: [
          { barberId },
          { barberId: null }, // shop-wide blocks
        ],
        startTime: {
          gte: dayStartUTC,
          lt: dayEndUTC,
        },
      },
    }),
    // Check for business closures on this date
    prisma.businessClosure.findMany({
      where: {
        businessId,
        isActive: true,
        startDate: { lte: dayEndUTC },
        endDate: { gte: dayStartUTC },
      },
    }),
    // Check for date-specific availability override for this barber
    prisma.availabilityOverride.findUnique({
      where: { barberId_date: { barberId, date: dateOnlyUTCFromYMD(year, month, day) } },
    }),
  ])

  if (!service || !service.isActive) return []
  if (barberService && !barberService.isActive) return []
  if (!barberService && (await prisma.barberService.count({ where: { barberId, serviceId } })) > 0) return []

  // ─── Availability Override takes priority over recurring schedule ─────────
  // If an override exists for this date, it completely replaces the recurring schedule.
  // isAvailable=false means the barber is off (vacation, personal, etc.)
  // isAvailable=true means custom hours for this specific date
  let workingStart: string
  let workingEnd: string
  let workingBreaks: Array<{ start: string; end: string }> = []

  if (override) {
    if (!override.isAvailable) return [] // Barber is off for this date
    if (!override.startTime || !override.endTime) return []
    workingStart = override.startTime
    workingEnd = override.endTime
    if (override.breaks && Array.isArray(override.breaks)) {
      workingBreaks = override.breaks as Array<{ start: string; end: string }>
    }
  } else {
    // Fall back to recurring weekly schedule
    if (!schedule || schedule.isOff) return []
    workingStart = schedule.startTime
    workingEnd = schedule.endTime
    if (schedule.breaks && Array.isArray(schedule.breaks)) {
      workingBreaks = schedule.breaks as Array<{ start: string; end: string }>
    }
  }

  const closureBlockedRanges: Array<{ startTime: Date; endTime: Date }> = []
  // Check business closures (holidays, vacations, etc.)
  for (const closure of closures) {
    if (closure.isAllDay) return [] // Entire day is closed
    // For partial-day closures, add to blocked ranges
    if (closure.startTime && closure.endTime) {
      // Convert closure times from business-local to UTC
      const closureStart = localTimeToUTCFromYMD(closure.startTime, year, month, day, timezone)
      const closureEnd = localTimeToUTCFromYMD(closure.endTime, year, month, day, timezone)
      closureBlockedRanges.push({ startTime: closureStart, endTime: closureEnd })
    }
  }

  const now = new Date()
  const duration = barberService?.durationOverride ?? service.duration // minutes

  // Booking rules: buffer time, minimum advance notice, maximum booking window
  const bufferMinutes = service.bufferMinutes ?? business?.bufferMinutes ?? 0
  const earliestStart = new Date(now.getTime() + (business?.minAdvanceBookingMinutes ?? 0) * 60_000)
  const latestStart = business?.maxBookingWindowDays
    ? new Date(now.getTime() + business.maxBookingWindowDays * 86_400_000)
    : null

  // Parse working hours and convert to UTC using business timezone
  const dayStart = localTimeToUTCFromYMD(workingStart, year, month, day, timezone)
  const dayEnd = localTimeToUTCFromYMD(workingEnd, year, month, day, timezone)

  // Parse breaks — convert from business-local times to UTC
  const breaks: Array<{ start: Date; end: Date }> = []
  for (const brk of workingBreaks) {
    if (brk && typeof brk === 'object' && 'start' in brk && 'end' in brk) {
      breaks.push({
        start: localTimeToUTCFromYMD(String(brk.start), year, month, day, timezone),
        end: localTimeToUTCFromYMD(String(brk.end), year, month, day, timezone),
      })
    }
  }

  // Parse blocked times into date ranges (already UTC from DB)
  const blockedRanges = [
    ...blockedTimes.map((bt) => ({
      start: bt.startTime,
      end: bt.endTime,
    })),
    ...closureBlockedRanges.map((r) => ({
      start: r.startTime,
      end: r.endTime,
    })),
  ]

  // Sort appointments by start time
  const sortedAppointments = appointments.sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime()
  )

  // Don't show past times (if checking today)

  // Walk the day in duration-minute increments
  // Keyed by display label, because a label must identify exactly one bookable
  // instant. On the night the clocks go back, 01:00 happens twice and both
  // occurrences format identically; a booking for "1:00 AM" can only ever
  // produce one of them, so offering both gives the customer an offer they
  // cannot actually book. Keep the occurrence that the booking path resolves
  // the label to (it prefers standard time, i.e. the later one).
  const slotsByLabel = new Map<string, { time: string; available: boolean }>()
  const slotInterval = 15 // 15-minute granularity for slot start times

  let cursor = new Date(dayStart)
  while (cursor < dayEnd) {
    const slotStart = new Date(cursor)
    const slotEnd = addMinutes(slotStart, duration)

    // Skip if slot end exceeds working hours
    if (slotEnd > dayEnd) break

    // Skip if in the past
    if (slotStart < now) {
      cursor = addMinutes(cursor, slotInterval)
      continue
    }

    let available = true

    // Advance-notice and booking-window rules: mark slots that violate them unavailable
    if (slotStart < earliestStart) available = false
    if (available && latestStart && slotStart > latestStart) available = false

    // Check overlap with existing appointments (buffer-aware: each appointment
    // occupies [start, end + buffer) for scheduling purposes)
    const slotOccupiedEnd = addMinutes(slotEnd, bufferMinutes)
    if (available) {
      for (const appt of sortedAppointments) {
        if (
          slotStart < addMinutes(appt.endTime, bufferMinutes) &&
          slotOccupiedEnd > appt.startTime
        ) {
          available = false
          break
        }
      }
    }

    // Check overlap with breaks
    if (available) {
      for (const brk of breaks) {
        if (slotStart < brk.end && slotEnd > brk.start) {
          available = false
          break
        }
      }
    }

    // Check overlap with blocked times
    if (available) {
      for (const block of blockedRanges) {
        if (slotStart < block.end && slotEnd > block.start) {
          available = false
          break
        }
      }
    }

    // Check if end time is after last appointment (edge case at day end)
    if (available && slotEnd > dayEnd) {
      available = false
    }

    // Format the slot time in the business timezone for display
    slotsByLabel.set(formatInTimezone(slotStart, timezone, 'h:mm a'), {
      time: formatInTimezone(slotStart, timezone, 'h:mm a'),
      available,
    })

    cursor = addMinutes(cursor, slotInterval)
  }

  return [...slotsByLabel.values()]
}

/**
 * Find the earliest available slot across all active barbers offering a given service on a date.
 */
/**
 * Convert a slot label like "2:30 PM" to minutes-since-midnight for
 * chronological comparison. Unparseable labels sort last.
 */
export function slotTimeToMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim())
  if (!match) return Number.MAX_SAFE_INTEGER
  let hours = parseInt(match[1], 10) % 12
  const minutes = parseInt(match[2], 10)
  if (match[3].toUpperCase() === 'PM') hours += 12
  return hours * 60 + minutes
}

export async function getEarliestAvailableSlot(params: {
  businessId: string
  serviceId: string
  date: Date
  dateStr?: string
}): Promise<{
  earliest: { barberId: string; barberName: string; time: string } | null
  slots: { time: string; available: boolean; barberId?: string; barberName?: string }[]
}> {
  const { businessId, serviceId, date, dateStr } = params

  const barbers = await prisma.barber.findMany({
    where: { businessId, isActive: true },
    include: {
      // Only serviceId is needed for the matching filter below — fetching
      // full BarberService rows was an oversized response for this hot path.
      services: { select: { serviceId: true } },
    },
    orderBy: { order: 'asc' },
  })

  const matchingBarbers = barbers.filter((barber) => {
    if (!barber.services || barber.services.length === 0) return true
    return barber.services.some((bs) => bs.serviceId === serviceId)
  })

  if (matchingBarbers.length === 0) {
    return { earliest: null, slots: [] }
  }

  const barberSlotsMap = await Promise.all(
    matchingBarbers.map(async (barber) => {
      const slots = await getAvailableSlots({
        businessId,
        barberId: barber.id,
        serviceId,
        date,
        dateStr,
      })
      return { barber, slots }
    })
  )

  const slotMap = new Map<
    string,
    { time: string; available: boolean; barberId?: string; barberName?: string }
  >()

  for (const { barber, slots } of barberSlotsMap) {
    for (const slot of slots) {
      if (!slotMap.has(slot.time)) {
        slotMap.set(slot.time, {
          time: slot.time,
          available: slot.available,
          ...(slot.available && { barberId: barber.id, barberName: barber.name }),
        })
      } else {
        const existing = slotMap.get(slot.time)!
        if (!existing.available && slot.available) {
          existing.available = true
          existing.barberId = barber.id
          existing.barberName = barber.name
        }
      }
    }
  }

  const mergedSlots = Array.from(slotMap.values()).sort(
    (a, b) => slotTimeToMinutes(a.time) - slotTimeToMinutes(b.time)
  )

  // Deterministic tie-break: when several barbers share the earliest time,
  // keep the lowest `order` barber — the merge above iterates barbers in
  // order-ascending sequence and only overwrites when a slot was NOT yet
  // available, so the first claimant (lowest order) is preserved.
  const earliestSlot = mergedSlots.find((s) => s.available)
  const earliest =
    earliestSlot && earliestSlot.barberId && earliestSlot.barberName
      ? {
          barberId: earliestSlot.barberId,
          barberName: earliestSlot.barberName,
          time: earliestSlot.time,
        }
      : null

  return { earliest, slots: mergedSlots }
}

/**
 * Canonical slot validation — the single source of truth for whether a
 * specific start time is bookable for a barber+service+business.
 *
 * Used by BOTH the initial booking AND reschedule to ensure one consistent
 * rule set. Never duplicate these checks — call this function.
 */
export async function validateSlot(params: {
  businessId: string
  barberId: string
  serviceId: string
  startTime: Date
  excludeAppointmentId?: string // exclude self when rescheduling
}): Promise<{ valid: boolean; error?: string; endTime?: Date }> {
  const { businessId, barberId, serviceId, startTime, excludeAppointmentId } = params

  // 1. Verify the barber belongs to this business and is active
  const barber = await prisma.barber.findFirst({
    where: { id: barberId, businessId, isActive: true },
  })
  if (!barber) return { valid: false, error: 'Barber not found or inactive' }

  // 2. Fetch the service
  const service = await prisma.service.findFirst({
    where: { id: serviceId, businessId, isActive: true },
  })
  if (!service) return { valid: false, error: 'Service not found or inactive' }

  const barberService = await prisma.barberService.findUnique({
    where: { barberId_serviceId: { barberId, serviceId } },
  })
  if (barberService && !barberService.isActive) return { valid: false, error: 'SERVICE_NOT_OFFERED' }

  // 3. Booking rules: advance notice + booking window (server-side enforced)
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { minAdvanceBookingMinutes: true, maxBookingWindowDays: true, bufferMinutes: true },
  })
  const now = new Date()
  if (business && startTime < new Date(now.getTime() + business.minAdvanceBookingMinutes * 60_000)) {
    return { valid: false, error: 'TOO_SOON' }
  }
  if (business?.maxBookingWindowDays && startTime > new Date(now.getTime() + business.maxBookingWindowDays * 86_400_000)) {
    return { valid: false, error: 'OUTSIDE_WINDOW' }
  }

  // 4. Compute end time + buffer
  const bufferMinutes = service.bufferMinutes ?? business?.bufferMinutes ?? 0
  const endTime = addMinutes(startTime, barberService?.durationOverride ?? service.duration)

  // 5. Check for conflicting appointments (double-booking protection, buffer-aware:
  //    each appointment occupies [start, end + buffer))
  const conflicting = await prisma.appointment.findFirst({
    where: {
      businessId,
      barberId,
      status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULED'] },
      startTime: { lt: addMinutes(endTime, bufferMinutes) },
      endTime: { gt: addMinutes(startTime, -bufferMinutes) },
      ...(excludeAppointmentId ? { NOT: { id: excludeAppointmentId } } : {}),
    },
  })
  if (conflicting) return { valid: false, error: 'SLOT_TAKEN' }

  // 5. Check barber schedule — availability override takes priority
  const timezone = await getBusinessTimezone(businessId)
  const localStart = toLocalDate(startTime, timezone)
  const year = localStart.year
  const month = localStart.month
  const day = localStart.day
  const dayOfWeek = localStart.weekday % 7
  const schedule = await prisma.schedule.findUnique({
    where: { barberId_dayOfWeek: { barberId, dayOfWeek } },
  })

  // Check for date-specific availability override using the business calendar day.
  const override = await prisma.availabilityOverride.findUnique({
    where: { barberId_date: { barberId, date: dateOnlyUTCFromYMD(year, month, day) } },
  })

  if (override) {
    // Override exists — it replaces the recurring schedule entirely
    if (!override.isAvailable) return { valid: false, error: 'BARBER_OFF' }
    if (!override.startTime || !override.endTime) return { valid: false, error: 'BARBER_OFF' }
    // Convert override times to UTC for comparison
    const y = year, m = month, d = day
    const overrideStart = localTimeToUTCFromYMD(override.startTime, y, m, d, timezone)
    const overrideEnd = localTimeToUTCFromYMD(override.endTime, y, m, d, timezone)
    if (startTime < overrideStart || endTime > overrideEnd) {
      return { valid: false, error: 'OUTSIDE_HOURS' }
    }
  } else {
    // No override — use recurring weekly schedule
    if (!schedule || schedule.isOff) return { valid: false, error: 'BARBER_OFF' }
    // Convert schedule times to UTC for comparison
    const y = year, m = month, d = day
    const scheduleStart = localTimeToUTCFromYMD(schedule.startTime, y, m, d, timezone)
    const scheduleEnd = localTimeToUTCFromYMD(schedule.endTime, y, m, d, timezone)
    if (startTime < scheduleStart || endTime > scheduleEnd) {
      return { valid: false, error: 'OUTSIDE_HOURS' }
    }
  }

  // 6. Check blocked times
  const blocked = await prisma.blockedTime.findFirst({
    where: {
      businessId,
      OR: [{ barberId }, { barberId: null }],
      startTime: { lt: endTime },
      endTime: { gt: startTime },
    },
  })
  if (blocked) return { valid: false, error: 'BLOCKED' }

  // 7. Check business closures (holidays, vacations) — same rule the POST path
  //    and slot display enforce, so reschedules can't move into closed days.
  const closures = await prisma.businessClosure.findMany({
    where: {
      businessId,
      isActive: true,
      startDate: { lte: endTime },
      endDate: { gte: startTime },
    },
  })
  for (const closure of closures) {
    if (closure.isAllDay) return { valid: false, error: 'CLOSED' }
    if (closure.startTime && closure.endTime) {
      const cStart = localTimeToUTCFromYMD(closure.startTime, year, month, day, timezone)
      const cEnd = localTimeToUTCFromYMD(closure.endTime, year, month, day, timezone)
      if (startTime < cEnd && endTime > cStart) return { valid: false, error: 'CLOSED' }
    }
  }

  return { valid: true, endTime }
}

/**
 * Create an appointment with full double-booking protection.
 * Uses a database transaction with a re-check inside to prevent race conditions.
 */

/**
 * Next available slot for a SPECIFIC barber over the coming days — powers
 * "NEXT AVAILABLE" chips in barber discovery (homepage team section,
 * /barbers cards, profile pages). Uses the same slot engine as the booking
 * flow; no parallel availability system. Returns null when nothing is open
 * in the window (renderers must omit the chip then — never fake data).
 */
export async function getBarberNextAvailable(params: {
  businessId: string
  barberId: string
  days?: number
}): Promise<{ date: string; time: string } | null> {
  const { businessId, barberId, days = 7 } = params

  // The barber must belong to this business and be active (tenant isolation).
  const barber = await prisma.barber.findFirst({
    where: { id: barberId, businessId, isActive: true },
    select: { id: true, services: { select: { serviceId: true } } },
  })
  if (!barber) return null

  // Pick the shortest active service this barber offers for slot math —
  // the shortest duration gives the widest honest availability picture.
  const service = await prisma.service.findFirst({
    where: { businessId, isActive: true },
    orderBy: { duration: 'asc' },
    select: { id: true },
  })
  if (!service) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let i = 0; i < days; i++) {
    const date = new Date(today)
    date.setDate(date.getDate() + i)
    const dateStr = format(date, 'yyyy-MM-dd')
    const slots = await getAvailableSlots({ businessId, barberId, serviceId: service.id, date })
    const open = slots.find((slot) => slot.available)
    if (open) return { date: dateStr, time: open.time }
  }
  return null
}

export async function createAppointmentSafely(params: {
  businessId: string
  barberId: string
  serviceId: string
  startTime: Date
  idempotencyKey?: string
  customerData: {
    firstName: string
    lastName: string
    phone: string
    email: string
    notes?: string | null
    smsConsent?: boolean
    answers?: Record<string, string | boolean | string[]>
    policiesAcceptedAt?: Date | null
    policyVersion?: string | null
    bookingSource?: string | null
    bookingSourceRef?: string | null
  }
  /** When the booking is made by an authenticated CUSTOMER account, the
   *  account→customer-record link is established here, server-side. */
  customerUserId?: string
  /** Prompt 8: canonical booking-source attribution, normalized server-side
   *  against the allowlist in src/lib/booking-source.ts. Absent = WEBSITE for
   *  the public flow (dashboard/manual bookings pass DIRECT themselves). */
  bookingSource?: BookingSource
  /** Staff-side manual entry (dashboard "Add Appointment"). Walk-ins start
   *  "now" and pre-arranged bookings can sit outside the public booking
   *  window, so the customer-facing advance-notice/window rules are waived.
   *  Availability, business-hours and double-booking checks still apply. */
  staffManual?: boolean
  /** Optional validated campaign token ([A-Za-z0-9_-]{1,64}). */
  bookingCampaign?: string | null
}): Promise<{ success: boolean; appointment?: Prisma.AppointmentGetPayload<{ include: { service: true; barber: true } }>; error?: string; customerAccessToken?: string }> {
  const { businessId, barberId, serviceId, startTime, idempotencyKey, customerData, customerUserId, bookingSource, bookingCampaign, staffManual } = params

  try {
    const runBooking = () => prisma.$transaction(async (tx) => {
      // 1. Verify the barber belongs to this business (tenant isolation)
      const barber = await tx.barber.findFirst({
        where: { id: barberId, businessId, isActive: true },
      })
      if (!barber) throw new Error('Barber not found or inactive')

      // 2. Fetch the service to get duration
      const service = await tx.service.findFirst({
        where: { id: serviceId, businessId, isActive: true },
      })
      if (!service) throw new Error('Service not found or inactive')

      const barberService = await tx.barberService.findUnique({
        where: { barberId_serviceId: { barberId, serviceId } },
      })
      if (barberService && !barberService.isActive) throw new Error('SERVICE_NOT_OFFERED')

      // 3. Booking rules: advance notice + booking window (enforced inside the
      //    transaction so direct POSTs can't bypass them)
      const business = await tx.business.findUnique({
        where: { id: businessId },
        select: { minAdvanceBookingMinutes: true, maxBookingWindowDays: true, bufferMinutes: true },
      })
      if (!business) throw new Error('Business not found')
      const bookingNow = new Date()
      if (!staffManual && startTime < new Date(bookingNow.getTime() + business.minAdvanceBookingMinutes * 60_000)) {
        throw new Error('TOO_SOON')
      }
      if (!staffManual && business.maxBookingWindowDays && startTime > new Date(bookingNow.getTime() + business.maxBookingWindowDays * 86_400_000)) {
        throw new Error('OUTSIDE_WINDOW')
      }

      // 4. Compute end time + buffer
      const bufferMinutes = service.bufferMinutes ?? business.bufferMinutes ?? 0
      const endTime = addMinutes(startTime, barberService?.durationOverride ?? service.duration)

      // 5. RE-CHECK availability inside the transaction (double-booking guard,
      //    buffer-aware: each appointment occupies [start, end + buffer))
      const conflicting = await tx.appointment.findFirst({
        where: {
          businessId,
          barberId,
          status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULED'] },
          startTime: { lt: addMinutes(endTime, bufferMinutes) },
          endTime: { gt: addMinutes(startTime, -bufferMinutes) },
        },
      })
      if (conflicting) throw new Error('SLOT_TAKEN')

      // 4. Check barber schedule — availability override takes priority
      const tz = await getBusinessTimezone(businessId)
      const localStart = toLocalDate(startTime, tz)
      const year = localStart.year
      const month = localStart.month
      const day = localStart.day
      const dayOfWeek = localStart.weekday % 7
      const schedule = await tx.schedule.findUnique({
        where: { barberId_dayOfWeek: { barberId, dayOfWeek } },
      })

      const override = await tx.availabilityOverride.findUnique({
        where: { barberId_date: { barberId, date: dateOnlyUTCFromYMD(year, month, day) } },
      })

      if (override) {
        if (!override.isAvailable) throw new Error('BARBER_OFF')
        if (!override.startTime || !override.endTime) throw new Error('BARBER_OFF')
        const y2 = startTime.getFullYear(), m2 = startTime.getMonth() + 1, d2 = startTime.getDate()
        const oStart = localTimeToUTCFromYMD(override.startTime, y2, m2, d2, tz)
        const oEnd = localTimeToUTCFromYMD(override.endTime, y2, m2, d2, tz)
        if (startTime < oStart || endTime > oEnd) throw new Error('OUTSIDE_HOURS')
      } else {
        if (!schedule || schedule.isOff) throw new Error('BARBER_OFF')
        const scheduleStart = localTimeToUTCFromYMD(schedule.startTime, year, month, day, tz)
        const scheduleEnd = localTimeToUTCFromYMD(schedule.endTime, year, month, day, tz)
        if (startTime < scheduleStart || endTime > scheduleEnd) throw new Error('OUTSIDE_HOURS')
      }

      // 5. Check blocked times
      const blocked = await tx.blockedTime.findFirst({
        where: {
          businessId,
          OR: [{ barberId }, { barberId: null }],
          startTime: { lt: endTime },
          endTime: { gt: startTime },
        },
      })
      if (blocked) throw new Error('BLOCKED')

      // 5b. Check business closures (holidays, vacations). The slot display
      // path (getAvailableSlots) already hides closure days; the POST path
      // must enforce the same rule so direct bookings can't slip through.
      const closures = await tx.businessClosure.findMany({
        where: {
          businessId,
          isActive: true,
          startDate: { lte: endTime },
          endDate: { gte: startTime },
        },
      })
      for (const closure of closures) {
        if (closure.isAllDay) throw new Error('CLOSED')
        if (closure.startTime && closure.endTime) {
          // Closure times are business-local clock strings on the appointment's local date
          const cStart = localTimeToUTCFromYMD(closure.startTime, year, month, day, tz)
          const cEnd = localTimeToUTCFromYMD(closure.endTime, year, month, day, tz)
          if (startTime < cEnd && endTime > cStart) throw new Error('CLOSED')
        }
      }

      // 6. Find or create the customer
      const customer = await tx.customer.upsert({
        where: {
          businessId_email: { businessId, email: customerData.email },
        },
        update: {
          firstName: customerData.firstName,
          lastName: customerData.lastName,
          phone: customerData.phone,
          notes: customerData.notes,
          smsConsent: customerData.smsConsent ?? false,
        },
        create: {
          businessId,
          firstName: customerData.firstName,
          lastName: customerData.lastName,
          phone: customerData.phone,
          email: customerData.email,
          notes: customerData.notes,
          smsConsent: customerData.smsConsent ?? false,
        },
      })

      // 6b. First booking by an authenticated CUSTOMER account: establish the
      // server-side account → customer-record link (never overwrites an
      // existing link; recorded in the audit log).
      if (customerUserId) {
        const linked = await tx.user.updateMany({
          where: { id: customerUserId, role: 'CUSTOMER', customerId: null },
          data: { customerId: customer.id },
        })
        if (linked.count > 0) {
          await tx.auditLog.create({
            data: {
              businessId,
              userId: customerUserId,
              action: 'CUSTOMER_LINKED',
              entityType: 'Customer',
              entityId: customer.id,
              newValues: { customerId: customer.id , description: 'Customer account linked to customer record on first booking' },
            },
          })
        }
      }

      // 7. Generate a unique confirmation number
      let confirmationNumber = generateConfirmationNumber()
      let existing = await tx.appointment.findUnique({ where: { confirmationNumber } })
      while (existing) {
        confirmationNumber = generateConfirmationNumber()
        existing = await tx.appointment.findUnique({ where: { confirmationNumber } })
      }

      // 8. Create the appointment with secure customer access token
      const customerAccessToken = generateCustomerAccessToken()
      const appointment = await tx.appointment.create({
        data: {
          confirmationNumber,
          customerAccessToken,
          idempotencyKey,
          businessId,
          customerId: customer.id,
          barberId,
          serviceId,
          startTime,
          endTime,
          status: 'CONFIRMED',
          customerNotes: customerData.notes ?? null,
          policiesAcceptedAt: customerData.policiesAcceptedAt ?? null,
          policyVersion: customerData.policyVersion ?? null,
          bookingSourceRef: customerData.bookingSourceRef ?? null,
          bookingSource: bookingSource ?? 'WEBSITE',
          bookingCampaign: bookingCampaign ?? null,
        },
        include: {
          service: true,
          barber: true,
        },
      })

      if (customerData.answers && Object.keys(customerData.answers).length > 0) {
        const questions = await tx.bookingQuestion.findMany({
          where: { businessId, isActive: true },
          orderBy: { sortOrder: 'asc' },
        })
        const responses = questions
          .filter((question) => customerData.answers?.[question.key] !== undefined)
          .map((question) => ({
            appointmentId: appointment.id,
            questionId: question.id,
            questionKey: question.key,
            questionLabel: question.label,
            questionType: question.type,
            questionOptions: question.options ?? undefined,
            answer: customerData.answers![question.key],
          }))
        if (responses.length > 0) await tx.appointmentIntakeResponse.createMany({ data: responses })
      }

      return appointment
    }, {
      isolationLevel: 'Serializable',
      // Room to finish under contention. The default 5 s is enough for a quiet
      // booking and not for eight people submitting the same slot at once; a
      // transaction that runs out of time does not double-book anyone, it just
      // tells a customer "try again" for no reason they can act on.
      timeout: 15_000,
      maxWait: 5_000,
    })

    // SERIALIZABLE aborts a transaction it could not order against a concurrent
    // one (P2034). That is not the same thing as a taken slot: a booking for a
    // DIFFERENT barber at the same instant trips it too. Postgres' instruction
    // is to try again, so we do. Without this, two customers booking different
    // barbers simultaneously would both be told the time had just been booked
    // when nothing had been booked at all. A genuine conflict still surfaces
    // fast, because SLOT_TAKEN is thrown on every attempt and is not retried.
    let result: Awaited<ReturnType<typeof runBooking>> | undefined
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        result = await runBooking()
        break
      } catch (error) {
        const retryCode = (error as { code?: string }).code
        const retryMessage = String((error as { message?: string }).message ?? '')
        // P2034: serialization failure. P2028: the transaction outlived its own
        // timeout and was rolled back. 40P01: Postgres detected a deadlock and
        // killed one side. All three are contention, all three rolled back, none
        // is a verdict on the slot, so all three are safe to repeat.
        //
        // 40P01 arrives wrapped in a connector error with no .code, exactly like
        // the exclusion-constraint violation that once leaked raw driver text to
        // a customer, so the message is matched as well as the code.
        const contention =
          retryCode === 'P2034' ||
          retryCode === 'P2028' ||
          retryMessage.includes('40P01') ||
          retryMessage.includes('deadlock detected')
        if (contention && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 40 * attempt))
          continue
        }
        throw error
      }
    }
    if (!result) throw new Error('SLOT_TAKEN')

    return { success: true, appointment: result, customerAccessToken: result.customerAccessToken }
  } catch (error) {
    const message = error.message || 'Unknown error'
    const code = (error as { code?: string })?.code
    // The database owns the last word on overlapping bookings: the
    // Appointment_no_active_overlap exclusion constraint rejects a second
    // appointment for the same barber and time even when two requests slip past
    // the application check. Prisma reports that as a wrapped connector error
    // with no .code, so matching on .code alone let the raw driver text
    // ("conflicting key value violates exclusion constraint ...") reach the
    // customer. Match the wrapped form as well.
    const isOverlapConflict =
      code === '23P01' ||
      message.includes('23P01') ||
      message.includes('Appointment_no_active_overlap')
    if (message === 'SLOT_TAKEN' || code === 'P2034' || isOverlapConflict) {
      return { success: false, error: 'That appointment time was just booked by another customer. Please choose another time.' }
    }
    if (message === 'BARBER_OFF') {
      return { success: false, error: 'The barber is not scheduled to work at this time.' }
    }
    if (message === 'BLOCKED') {
      return { success: false, error: 'This time slot has been blocked by the shop.' }
    }
    if (message === 'CLOSED') {
      return { success: false, error: 'The shop is closed at this time (holiday or closure).' }
    }
    // Anything unmapped is a technical failure, not something a customer can act
    // on. Keep the detail in the server log and hand back a sentence a person can
    // read. A thrown code that the caller branches on (BARBER_OFF, BLOCKED,
    // CLOSED, TOO_SOON, OUTSIDE_WINDOW, SERVICE_NOT_OFFERED) is passed through
    // above and never reaches here.
    const isCallerFacingCode = /^[A-Z_]{3,40}$/.test(message)
    if (isCallerFacingCode) return { success: false, error: message }
    console.error('booking failed unexpectedly:', message)
    return { success: false, error: 'We could not complete that booking just now. Please try again in a moment.' }
  }
}

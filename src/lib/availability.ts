import { prisma } from '@/lib/prisma'
import { generateConfirmationNumber, generateCustomerAccessToken } from '@/lib/utils'
import { addMinutes } from 'date-fns'
import {
  dayBoundsFromYMD,
  localTimeToUTCFromYMD,
  dayOfWeekFromYMD,
  formatInTimezone,
  dateOnlyUTCFromYMD,
  toLocalDate,
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

async function getBusinessTimezone(businessId: string): Promise<string> {
  if (tzCache.has(businessId)) return tzCache.get(businessId)!
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { timezone: true },
  })
  const tz = business?.timezone || 'America/New_York'
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
  const [service, schedule, appointments, blockedTimes, closures, override] = await Promise.all([
    prisma.service.findFirst({ where: { id: serviceId, businessId, isActive: true } }),
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

  // ─── Availability Override takes priority over recurring schedule ─────────
  // If an override exists for this date, it completely replaces the recurring schedule.
  // isAvailable=false means the barber is off (vacation, personal, etc.)
  // isAvailable=true means custom hours for this specific date
  let workingStart: string
  let workingEnd: string
  let workingBreaks: Array<{ start: string; end: string }> = []
  let usingOverride = false

  if (override) {
    if (!override.isAvailable) return [] // Barber is off for this date
    if (!override.startTime || !override.endTime) return []
    workingStart = override.startTime
    workingEnd = override.endTime
    if (override.breaks && Array.isArray(override.breaks)) {
      workingBreaks = override.breaks as Array<{ start: string; end: string }>
    }
    usingOverride = true
  } else {
    // Fall back to recurring weekly schedule
    if (!schedule || schedule.isOff) return []
    workingStart = schedule.startTime
    workingEnd = schedule.endTime
    if (schedule.breaks && Array.isArray(schedule.breaks)) {
      workingBreaks = schedule.breaks as Array<{ start: string; end: string }>
    }
  }

  // Check business closures (holidays, vacations, etc.)
  for (const closure of closures) {
    if (closure.isAllDay) return [] // Entire day is closed
    // For partial-day closures, add to blocked ranges
    if (closure.startTime && closure.endTime) {
      // Convert closure times from business-local to UTC
      const closureStart = localTimeToUTCFromYMD(closure.startTime, year, month, day, timezone)
      const closureEnd = localTimeToUTCFromYMD(closure.endTime, year, month, day, timezone)
      blockedTimes.push({ startTime: closureStart, endTime: closureEnd } as any)
    }
  }

  const duration = service.duration // minutes

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
  const blockedRanges = blockedTimes.map((bt) => ({
    start: bt.startTime,
    end: bt.endTime,
  }))

  // Sort appointments by start time
  const sortedAppointments = appointments.sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime()
  )

  // Don't show past times (if checking today)
  const now = new Date()

  // Walk the day in duration-minute increments
  const slots: { time: string; available: boolean }[] = []
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

    // Check overlap with existing appointments
    for (const appt of sortedAppointments) {
      if (
        slotStart < appt.endTime &&
        slotEnd > appt.startTime
      ) {
        available = false
        break
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
    slots.push({
      time: formatInTimezone(slotStart, timezone, 'h:mm a'),
      available,
    })

    cursor = addMinutes(cursor, slotInterval)
  }

  return slots
}

/**
 * Find the earliest available slot across all active barbers offering a given service on a date.
 */
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
      services: true,
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

  const mergedSlots = Array.from(slotMap.values())

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

  // 3. Compute end time
  const endTime = addMinutes(startTime, service.duration)

  // 4. Check for conflicting appointments (double-booking protection)
  const conflicting = await prisma.appointment.findFirst({
    where: {
      businessId,
      barberId,
      status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULED'] },
      startTime: { lt: endTime },
      endTime: { gt: startTime },
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
    const y = startTime.getFullYear(), m = startTime.getMonth() + 1, d = startTime.getDate()
    const overrideStart = localTimeToUTCFromYMD(override.startTime, y, m, d, timezone)
    const overrideEnd = localTimeToUTCFromYMD(override.endTime, y, m, d, timezone)
    if (startTime < overrideStart || endTime > overrideEnd) {
      return { valid: false, error: 'OUTSIDE_HOURS' }
    }
  } else {
    // No override — use recurring weekly schedule
    if (!schedule || schedule.isOff) return { valid: false, error: 'BARBER_OFF' }
    // Convert schedule times to UTC for comparison
    const y = startTime.getFullYear(), m = startTime.getMonth() + 1, d = startTime.getDate()
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

  return { valid: true, endTime }
}

/**
 * Create an appointment with full double-booking protection.
 * Uses a database transaction with a re-check inside to prevent race conditions.
 */
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
  }
}): Promise<{ success: boolean; appointment?: any; error?: string; customerAccessToken?: string }> {
  const { businessId, barberId, serviceId, startTime, idempotencyKey, customerData } = params

  try {
    const result = await prisma.$transaction(async (tx) => {
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

      // 3. Compute end time
      const endTime = addMinutes(startTime, service.duration)

      // 4. RE-CHECK availability inside the transaction (double-booking guard)
      const conflicting = await tx.appointment.findFirst({
        where: {
          businessId,
          barberId,
          status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULED'] },
          startTime: { lt: endTime },
          endTime: { gt: startTime },
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
          .filter((question: any) => customerData.answers?.[question.key] !== undefined)
          .map((question: any) => ({
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
    }, { isolationLevel: 'Serializable' })

    return { success: true, appointment: result, customerAccessToken: result.customerAccessToken }
  } catch (error: any) {
    const message = error.message || 'Unknown error'
    if (message === 'SLOT_TAKEN' || error?.code === 'P2034' || error?.code === '23P01') {
      return { success: false, error: 'That appointment was just booked by someone else. Please choose another time.' }
    }
    if (message === 'BARBER_OFF') {
      return { success: false, error: 'The barber is not scheduled to work at this time.' }
    }
    if (message === 'BLOCKED') {
      return { success: false, error: 'This time slot has been blocked by the shop.' }
    }
    return { success: false, error: message }
  }
}

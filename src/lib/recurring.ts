import { prisma } from '@/lib/prisma'
import { getAvailableSlots, validateSlot, createAppointmentSafely } from '@/lib/availability'
import { DateTime } from 'luxon'
import { localTimeToUTCFromYMD, resolveBusinessTimezone } from '@/lib/timezone'

// ============================================================================
// Recurring Appointment Engine
// Creates a series of appointments at regular intervals (2, 3, or 4 weeks).
// Checks availability for each occurrence and returns a preview with
// conflict resolution options before committing.
// ============================================================================

export type RecurringInterval = 2 | 3 | 4 // weeks

export interface RecurringPreviewOccurrence {
  date: Date
  dateLabel: string
  available: boolean
  reason?: string // why unavailable
  existingSlot?: string // the conflicting appointment
}

export interface RecurringPreview {
  occurrences: RecurringPreviewOccurrence[]
  totalOccurrences: number
  availableCount: number
  conflictCount: number
}

/**
 * Resolve the business timezone for wall-clock math. All occurrence dates and
 * slot instants are computed in the BUSINESS timezone (not the server's), so a
 * shop in America/Los_Angeles gets the same series on a UTC host as on a
 * local one.
 */
async function getBusinessTimezone(businessId: string): Promise<string> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { timezone: true },
  })
  return resolveBusinessTimezone(business)
}

/**
 * Parse a preferred time like "2:00 PM" or "14:00" into a UTC instant on the
 * given BUSINESS-LOCAL calendar date. The occurrence is a Luxon DateTime
 * already set to the business timezone.
 */
function slotInstantFromLocalTime(occurrenceLocal: DateTime, timeStr: string): Date {
  let hours = 0
  let minutes = 0
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (match) {
    hours = parseInt(match[1], 10)
    minutes = parseInt(match[2], 10)
    const period = match[3].toUpperCase()
    if (period === 'PM' && hours < 12) hours += 12
    if (period === 'AM' && hours === 12) hours = 0
  } else {
    const parts = timeStr.split(':')
    hours = parseInt(parts[0], 10) || 0
    minutes = parseInt(parts[1], 10) || 0
  }
  const hhmm = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
  return localTimeToUTCFromYMD(hhmm, occurrenceLocal.year, occurrenceLocal.month, occurrenceLocal.day, occurrenceLocal.zoneName)
}

/**
 * Compute the i-th occurrence on the business-local calendar. Adding days on
 * the local calendar (rather than 24h increments on the UTC instant) keeps
 * the wall-clock date stable across DST transitions.
 */
function occurrenceLocalDate(startDate: Date, intervalDays: number, index: number, timezone: string): DateTime {
  return DateTime.fromJSDate(startDate).setZone(timezone).plus({ days: index * intervalDays })
}

/**
 * Preview a recurring appointment series WITHOUT creating any appointments.
 * Checks barber availability for each occurrence and returns conflicts.
 */
export async function previewRecurringAppointments(params: {
  businessId: string
  barberId: string
  serviceId: string
  startDate: Date
  intervalWeeks: RecurringInterval
  totalOccurrences: number
  preferredTime?: string // e.g. "2:00 PM" — the time on each date
}): Promise<RecurringPreview> {
  const { businessId, barberId, serviceId, startDate, intervalWeeks, totalOccurrences, preferredTime } = params

  const intervalDays = intervalWeeks * 7
  const timezone = await getBusinessTimezone(businessId)
  const occurrences: RecurringPreviewOccurrence[] = []

  for (let i = 0; i < totalOccurrences; i++) {
    const occurrenceLocal = occurrenceLocalDate(startDate, intervalDays, i, timezone)
    const dateLabel = occurrenceLocal.setLocale('en-US').toFormat('ccc, LLL d')
    const occurrenceInstant = occurrenceLocal.startOf('day').toUTC().toJSDate()

    // Check if barber is working on this day (JS dayOfWeek: 0 = Sunday)
    const dayOfWeek = occurrenceLocal.weekday % 7
    const schedule = await prisma.schedule.findUnique({
      where: { barberId_dayOfWeek: { barberId, dayOfWeek } },
    })

    if (!schedule || schedule.isOff) {
      occurrences.push({
        date: occurrenceInstant,
        dateLabel,
        available: false,
        reason: 'Barber not working on this day',
      })
      continue
    }

    // Check for business closures on this date
    const closures = await prisma.businessClosure.findMany({
      where: {
        businessId,
        isActive: true,
        startDate: { lte: occurrenceInstant },
        endDate: { gte: occurrenceInstant },
      },
    })

    if (closures.some(c => c.isAllDay)) {
      occurrences.push({
        date: occurrenceInstant,
        dateLabel,
        available: false,
        reason: 'Shop closed',
      })
      continue
    }

    // Check for blocked times (business-local day bounds expressed in UTC)
    const dayBounds = {
      start: occurrenceLocal.startOf('day').toUTC().toJSDate(),
      end: occurrenceLocal.endOf('day').toUTC().toJSDate(),
    }

    const blockedTimes = await prisma.blockedTime.findMany({
      where: {
        businessId,
        OR: [{ barberId }, { barberId: null }],
        startTime: { gte: dayBounds.start, lt: dayBounds.end },
      },
    })

    // If we have a preferred time, validate the specific slot
    if (preferredTime) {
      const bookingDate = slotInstantFromLocalTime(occurrenceLocal, preferredTime)
      const validation = await validateSlot({
        businessId,
        barberId,
        serviceId,
        startTime: bookingDate,
      })

      if (!validation.valid) {
        // Check if it's a blocked time or closure
        const isBlocked = blockedTimes.some(bt =>
          bookingDate < bt.endTime && bookingDate >= bt.startTime
        )
        occurrences.push({
          date: occurrenceInstant,
          dateLabel,
          available: false,
          reason: isBlocked ? 'Time blocked' : validation.error,
        })
        continue
      }

      occurrences.push({
        date: occurrenceInstant,
        dateLabel,
        available: true,
      })
    } else {
      // No preferred time — check if ANY slot is available on this date
      const slots = await getAvailableSlots({
        businessId,
        barberId,
        serviceId,
        date: occurrenceInstant,
      })

      const hasAvailable = slots.some(s => s.available)

      if (!hasAvailable) {
        occurrences.push({
          date: occurrenceInstant,
          dateLabel,
          available: false,
          reason: 'No available slots',
        })
        continue
      }

      occurrences.push({
        date: occurrenceInstant,
        dateLabel,
        available: true,
      })
    }
  }

  const conflictCount = occurrences.filter(o => !o.available).length

  return {
    occurrences,
    totalOccurrences: occurrences.length,
    availableCount: occurrences.length - conflictCount,
    conflictCount,
  }
}

/**
 * Create a recurring appointment series.
 * Only creates appointments for available occurrences.
 * Returns the created appointments and any skipped conflicts.
 */
export async function createRecurringAppointments(params: {
  businessId: string
  barberId: string
  serviceId: string
  startDate: Date
  intervalWeeks: RecurringInterval
  totalOccurrences: number
  preferredTime: string
  customerData: {
    firstName: string
    lastName: string
    phone: string
    email: string
    notes?: string
    smsConsent?: boolean
  }
  createdBy?: string
}): Promise<{
  created: any[]
  conflicts: { date: Date; dateLabel: string; reason: string }[]
}> {
  const { businessId, barberId, serviceId, startDate, intervalWeeks, totalOccurrences, preferredTime, customerData, createdBy } = params
  const intervalDays = intervalWeeks * 7
  const timezone = await getBusinessTimezone(businessId)
  const created: any[] = []
  const conflicts: { date: Date; dateLabel: string; reason: string }[] = []

  for (let i = 0; i < totalOccurrences; i++) {
    const occurrenceLocal = occurrenceLocalDate(startDate, intervalDays, i, timezone)
    const dateLabel = occurrenceLocal.setLocale('en-US').toFormat('ccc, LLL d')
    const occurrenceInstant = occurrenceLocal.startOf('day').toUTC().toJSDate()

    const bookingDate = slotInstantFromLocalTime(occurrenceLocal, preferredTime)

    const result = await createAppointmentSafely({
      businessId,
      barberId,
      serviceId,
      startTime: bookingDate,
      customerData,
    })

    if (result.success) {
      created.push(result.appointment)
    } else {
      conflicts.push({ date: occurrenceInstant, dateLabel, reason: result.error || 'Unknown error' })
    }
  }

  // Log to audit log
  if (created.length > 0) {
    try {
      await prisma.auditLog.create({
        data: {
          businessId,
          action: 'APPOINTMENT_CREATED',
          entityType: 'RecurringSeries',
          newValues: {
            barberId,
            serviceId,
            intervalWeeks,
            totalOccurrences,
            createdCount: created.length,
            conflictCount: conflicts.length,
            createdBy,
          },
        },
      })
    } catch (e) {
      // Non-critical
    }
  }

  return { created, conflicts }
}

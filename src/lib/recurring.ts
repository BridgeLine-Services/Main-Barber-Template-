import type { Appointment } from '@prisma/client'
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
 * Parse a preferred time like "2:00 PM" or "14:00".
 *
 * Strict and bounded on purpose: the previous version ran an unbounded regular
 * expression and, on anything it did not recognise, quietly produced midnight.
 * A recurring appointment booked at 00:00 is worse than a clear rejection, so
 * this returns null and callers refuse the input.
 */
export const MAX_PREFERRED_TIME_LENGTH = 12

export function parsePreferredTime(raw: unknown): { hours: number; minutes: number } | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (value.length === 0 || value.length > MAX_PREFERRED_TIME_LENGTH) return null
  const match = /^(\d{1,2}):(\d{2})(?:\s?([AaPp][Mm]))?$/.exec(value)
  if (!match) return null
  let hours = Number(match[1])
  const minutes = Number(match[2])
  const period = match[3]?.toUpperCase()
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
  if (minutes < 0 || minutes > 59) return null
  if (period) {
    if (hours < 1 || hours > 12) return null
    hours = hours % 12
    if (period === 'PM') hours += 12
  } else if (hours > 23) {
    return null
  }
  return { hours, minutes }
}

/** Human-facing wording for a rejected preferred time. */
export const PREFERRED_TIME_ERROR =
  'Enter the visit time as HH:MM, for example 14:30 or 2:30 PM.'

function slotInstantFromLocalTime(occurrenceLocal: DateTime, timeStr: string): Date {
  const parsed = parsePreferredTime(timeStr)
  if (!parsed) throw new Error(PREFERRED_TIME_ERROR)
  const hhmm = `${parsed.hours.toString().padStart(2, '0')}:${parsed.minutes.toString().padStart(2, '0')}`
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
    const schedule = await prisma.schedule.findUnique({ // perf-ok: bounded per-occurrence conflict check for one recurring series
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
    const closures = await prisma.businessClosure.findMany({ // perf-ok: bounded per-occurrence conflict check for one recurring series
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

    const blockedTimes = await prisma.blockedTime.findMany({ // perf-ok: bounded per-occurrence conflict check for one recurring series
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
  created: Appointment[]
  conflicts: { date: Date; dateLabel: string; reason: string }[]
}> {
  const { businessId, barberId, serviceId, startDate, intervalWeeks, totalOccurrences, preferredTime, customerData, createdBy } = params
  const intervalDays = intervalWeeks * 7
  const timezone = await getBusinessTimezone(businessId)
  const created: Appointment[] = []
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
      await prisma.auditLog.create({ // perf-ok: bounded per-occurrence conflict check for one recurring series
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
    } catch (_e) {
      // Non-critical
    }
  }

  return { created, conflicts }
}

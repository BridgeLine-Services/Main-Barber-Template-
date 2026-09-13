/**
 * Cancellation-Fill Assistant
 * ---------------------------
 * Internal operational feature: after an appointment is cancelled, help the
 * shop offer the released slot to an eligible waitlist entry.
 *
 * - Operates AFTER the cancellation has been processed; it never alters
 *   existing cancellation behavior.
 * - Candidates come exclusively from the existing WaitlistEntry model and are
 *   prioritized using information the customer actually provided (requested
 *   service, requested barber, preferred date/time range, entry creation
 *   time). No invented preferences, no arbitrary scoring.
 * - Notification reuses the existing infrastructure (sendWaitlistSlotNotification)
 *   and the existing public claim flow, which re-validates slot availability at
 *   booking time (race-condition safe).
 */

import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { sendWaitlistSlotNotification, isEmailConfigured } from '@/lib/notifications'
import { isTwilioConfigured } from '@/lib/twilio'
import { getBusinessTimezone } from '@/lib/availability'

/** How long a waitlist offer holds before it expires (minutes). */
export const OFFER_HOLD_MINUTES = 15

export interface OpeningSlot {
  appointmentId: string
  businessId: string
  barberId: string
  barberName: string
  serviceId: string
  serviceName: string
  startTime: Date
  endTime: Date
  timezone: string
}

export interface WaitlistCandidateInput {
  id: string
  businessId: string
  customerId: string | null
  firstName: string
  lastName: string
  phone: string
  email: string
  barberId: string | null
  serviceId: string
  preferredDate: Date
  preferredTimeRange: string | null
  status: string
  notifiedAt: Date | null
  expiresAt: Date | null
  offeredSlotStart: Date | null
  createdAt: Date
}

export interface RankedCandidate {
  entryId: string
  businessId: string
  customerId: string | null
  name: string
  phone: string
  email: string
  requestedBarberId: string | null
  requestedServiceId: string
  preferredDate: string // YYYY-MM-DD in the business timezone
  preferredTimeRange: string | null
  createdAt: string
  matchReasons: string[]
}

function ymdInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/**
 * WaitlistEntry.preferredDate is a date-only column stored as UTC midnight.
 * It must be compared by its UTC calendar date — formatting it in the
 * business timezone would shift it a day for non-UTC shops.
 */
function ymdDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Map a moment in time (in the business timezone) to the coarse day-part
 * buckets the waitlist model already uses: morning / afternoon / evening.
 */
export function dayPartOf(date: Date, timezone: string): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).format(date)
  )
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

/**
 * Deterministically rank waitlist entries against a released slot.
 *
 * Eligibility (an entry is only a candidate when ALL hold):
 * - belongs to the same business (defense in depth; queries are scoped too)
 * - entry status is WAITING (no pending/accepted/expired offers)
 * - the entry requested exactly the service of the cancelled appointment
 * - the entry requested this barber or any barber (barberId null)
 * - the entry's preferred date is the slot's date or earlier (a customer who
 *   asked for a later date has not asked for this slot)
 *
 * Priority order (stable; ties fall through to the next criterion):
 * 1. A specific-barber request matching this barber ranks above "any barber".
 * 2. Preferred date equal to the slot date ranks above an earlier request date.
 * 3. A preferred time range matching the slot's day-part ranks above no match.
 * 4. Earlier-created entries rank first (first-come, first-served).
 *
 * Every criterion is derived from fields the customer provided when joining
 * the waitlist — there is no invented preference and no numeric scoring.
 */
export function rankWaitlistCandidates(
  entries: WaitlistCandidateInput[],
  opening: { businessId: string; barberId: string; serviceId: string; startTime: Date; timezone: string },
  now: Date = new Date()
): RankedCandidate[] {
  const slotDay = ymdInTimezone(opening.startTime, opening.timezone)
  const slotDayPart = dayPartOf(opening.startTime, opening.timezone)

  const eligible = entries.filter((entry) => {
    if (entry.businessId !== opening.businessId) return false
    if (entry.status !== 'WAITING') return false
    if (entry.serviceId !== opening.serviceId) return false
    if (entry.barberId !== null && entry.barberId !== opening.barberId) return false
    if (ymdDateOnly(entry.preferredDate) > slotDay) return false
    return true
  })

  const withReasons = eligible.map((entry) => {
    const matchReasons: string[] = []
    const entryDay = ymdDateOnly(entry.preferredDate)
    if (entry.barberId === opening.barberId) matchReasons.push('Requested this barber')
    else matchReasons.push('Open to any barber')
    if (entryDay === slotDay) matchReasons.push('Requested this date')
    else matchReasons.push('Requested an earlier date')
    if (entry.preferredTimeRange) {
      const wanted = entry.preferredTimeRange.toLowerCase()
      matchReasons.push(wanted === slotDayPart ? `Requested ${slotDayPart} times` : `Requested ${wanted} times`)
    }

    return {
      entry,
      ranks: {
        barber: entry.barberId === opening.barberId ? 0 : 1,
        date: entryDay === slotDay ? 0 : 1,
        timeRange: entry.preferredTimeRange ? (entry.preferredTimeRange.toLowerCase() === slotDayPart ? 0 : 1) : 2,
        createdAt: entry.createdAt.getTime(),
      },
      matchReasons,
    }
  })

  withReasons.sort((a, b) => {
    if (a.ranks.barber !== b.ranks.barber) return a.ranks.barber - b.ranks.barber
    if (a.ranks.date !== b.ranks.date) return a.ranks.date - b.ranks.date
    if (a.ranks.timeRange !== b.ranks.timeRange) return a.ranks.timeRange - b.ranks.timeRange
    return a.ranks.createdAt - b.ranks.createdAt
  })

  return withReasons.map(({ entry, matchReasons }) => ({
    entryId: entry.id,
    businessId: entry.businessId,
    customerId: entry.customerId,
    name: `${entry.firstName} ${entry.lastName}`,
    phone: entry.phone,
    email: entry.email,
    requestedBarberId: entry.barberId,
    requestedServiceId: entry.serviceId,
    preferredDate: ymdDateOnly(entry.preferredDate),
    preferredTimeRange: entry.preferredTimeRange,
    createdAt: entry.createdAt.toISOString(),
    matchReasons,
  }))
}

/**
 * Resolve a cancelled appointment into an "opening" that can be offered.
 * Returns null when the appointment is not a usable opening:
 * - it was never cancelled, or
 * - its slot is already in the past, or
 * - the slot has been re-booked by someone else (availability re-check).
 */
export async function getOpeningForAppointment(businessId: string, appointmentId: string): Promise<OpeningSlot | null> {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, businessId },
    include: { barber: { select: { id: true, name: true } }, service: { select: { id: true, name: true } } },
  })
  if (!appointment) return null
  if (appointment.status !== 'CANCELLED') return null

  const now = new Date()
  if (appointment.startTime <= now) return null

  const conflicting = await prisma.appointment.findFirst({
    where: {
      businessId,
      barberId: appointment.barberId,
      status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULED'] },
      startTime: { lt: appointment.endTime },
      endTime: { gt: appointment.startTime },
    },
    select: { id: true },
  })
  if (conflicting) return null

  const timezone = await getBusinessTimezone(businessId)

  return {
    appointmentId: appointment.id,
    businessId,
    barberId: appointment.barberId,
    barberName: appointment.barber.name,
    serviceId: appointment.serviceId,
    serviceName: appointment.service.name,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    timezone,
  }
}

/**
 * Eligible waitlist entries for an opening, in priority order.
 */
export async function getEligibleCandidates(opening: OpeningSlot): Promise<RankedCandidate[]> {
  const slotDay = ymdInTimezone(opening.startTime, opening.timezone)
  // The preferredDate column is a date-only value; compare against the slot's
  // calendar date in the business timezone to keep the semantics stable.
  const slotDateOnly = new Date(`${slotDay}T00:00:00.000Z`)

  const entries = await prisma.waitlistEntry.findMany({
    where: {
      businessId: opening.businessId,
      status: 'WAITING',
      serviceId: opening.serviceId,
      OR: [{ barberId: null }, { barberId: opening.barberId }],
      preferredDate: { lte: slotDateOnly },
    },
    orderBy: { createdAt: 'asc' },
  })

  return rankWaitlistCandidates(
    entries.map((entry) => ({
      id: entry.id,
      businessId: entry.businessId,
      customerId: entry.customerId,
      firstName: entry.firstName,
      lastName: entry.lastName,
      phone: entry.phone,
      email: entry.email,
      barberId: entry.barberId,
      serviceId: entry.serviceId,
      preferredDate: entry.preferredDate,
      preferredTimeRange: entry.preferredTimeRange,
      status: entry.status,
      notifiedAt: entry.notifiedAt,
      expiresAt: entry.expiresAt,
      offeredSlotStart: entry.offeredSlotStart,
      createdAt: entry.createdAt,
    })),
    {
      businessId: opening.businessId,
      barberId: opening.barberId,
      serviceId: opening.serviceId,
      startTime: opening.startTime,
      timezone: opening.timezone,
    }
  )
}

export type OfferResult =
  | { outcome: 'OFFERED'; claimToken: string; expiresAt: Date }
  | { outcome: 'ALREADY_NOTIFIED' }
  | { outcome: 'SLOT_TAKEN' }
  | { outcome: 'NOT_FOUND' }

/**
 * Offer an opening to a chosen waitlist entry.
 *
 * Race-condition safety:
 * - The slot is re-checked for conflicts immediately before the offer.
 * - The entry is transitioned WAITING -> NOTIFIED with a conditional updateMany
 *   so a concurrent notify for the same entry loses atomically (duplicate
 *   notification prevention).
 * - Booking still goes through the existing claim endpoint, which re-validates
 *   availability at claim time — the slot is never assumed to remain open.
 */
export async function offerOpeningToCandidate(params: {
  opening: OpeningSlot
  entryId: string
  claimOrigin: string
  actorLabel: string
}): Promise<OfferResult> {
  const { opening, entryId, claimOrigin } = params

  const entry = await prisma.waitlistEntry.findFirst({
    where: { id: entryId, businessId: opening.businessId },
  })
  if (!entry) return { outcome: 'NOT_FOUND' }

  // Re-check the slot at offer time (it may have been re-booked since the
  // cancellation).
  const conflicting = await prisma.appointment.findFirst({
    where: {
      businessId: opening.businessId,
      barberId: opening.barberId,
      status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULED'] },
      startTime: { lt: opening.endTime },
      endTime: { gt: opening.startTime },
    },
    select: { id: true },
  })
  if (conflicting) return { outcome: 'SLOT_TAKEN' }

  if (entry.status !== 'WAITING') return { outcome: 'ALREADY_NOTIFIED' }

  const claimToken = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + OFFER_HOLD_MINUTES * 60 * 1000)

  // Atomic WAITING -> NOTIFIED transition. If two staff members notify the
  // same entry simultaneously, exactly one wins.
  const claimed = await prisma.waitlistEntry.updateMany({
    where: { id: entry.id, businessId: opening.businessId, status: 'WAITING' },
    data: {
      status: 'NOTIFIED',
      notifiedAt: new Date(),
      expiresAt,
      claimToken,
      offeredSlotStart: opening.startTime,
      offeredSlotEnd: opening.endTime,
      offeredBarberId: opening.barberId,
    },
  })
  if (claimed.count !== 1) return { outcome: 'ALREADY_NOTIFIED' }

  const claimUrl = `${claimOrigin}/waitlist/claim?token=${claimToken}`
  const business = await prisma.business.findUnique({
    where: { id: opening.businessId },
    select: { name: true, phone: true, email: true },
  })

  // Reuse the existing notification infrastructure. If neither email nor SMS
  // is configured nothing is sent externally, but the offer is still recorded
  // on the entry — the dashboard remains an internal recommendation list and
  // the shop can share the claim link in person.
  try {
    await sendWaitlistSlotNotification({
      businessId: opening.businessId,
      entryId: entry.id,
      customer: { firstName: entry.firstName, lastName: entry.lastName, email: entry.email, phone: entry.phone },
      service: { name: opening.serviceName, duration: 0 },
      barber: { name: opening.barberName },
      slotStart: opening.startTime,
      slotEnd: opening.endTime,
      claimToken,
      claimUrl,
      business: {
        name: business?.name || 'the shop',
        phone: business?.phone ?? null,
        email: business?.email ?? null,
      },
    })
  } catch (error) {
    console.error('Cancellation-fill notification failed:', error)
  }

  return { outcome: 'OFFERED', claimToken, expiresAt }
}

/** Whether any outbound channel is configured (for UI messaging only). */
export function anyNotificationChannelConfigured(): boolean {
  return isEmailConfigured() || isTwilioConfigured()
}

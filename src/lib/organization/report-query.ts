/**
 * Reading the numbers behind an organization report (Priority 2 stage 3).
 *
 * Every query is scoped to a business id that came from the resolved organization context,
 * never from a request. Each figure is read inside its own try/catch so one unreadable
 * source produces "unknown" for that figure rather than a zero that looks like a fact.
 *
 * This module returns counts and money only. It never selects a customer name, email,
 * phone or address, which is what keeps corporate reporting aggregate.
 */

import { prisma } from '@/lib/prisma'
import { weeklyOpenMinutes, type ScheduleRow } from '@/lib/analytics/utilisation'
import type { LocationRollup } from './reporting'

export interface ReportRange {
  start: Date
  end: Date
  label: string
}

export interface LocationRef {
  businessId: string
  name: string
  region: string | null
  status: string
}

async function safely<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch {
    return null
  }
}

const SETTLED = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const
const COUNTS_AS_BOOKED = ['COMPLETED', 'CONFIRMED', 'PENDING', 'RESCHEDULED'] as const

export async function loadLocationRollup(location: LocationRef, range: ReportRange): Promise<LocationRollup> {
  const businessId = location.businessId
  const window = { gte: range.start, lte: range.end }

  const [appointments, completed, cancelled] = await Promise.all([
    safely(() => prisma.appointment.count({ where: { businessId, startTime: window } })),
    safely(() => prisma.appointment.count({ where: { businessId, startTime: window, status: 'COMPLETED' } })),
    safely(() => prisma.appointment.count({ where: { businessId, startTime: window, status: 'CANCELLED' } })),
  ])

  const paymentRows = await safely(() =>
    prisma.payment.findMany({
      where: { businessId, createdAt: window, status: { in: [...SETTLED] } },
      select: { amount: true, refundedAmount: true, kind: true },
    }),
  )

  const grossRevenueCents = paymentRows
    ? Math.round(paymentRows.filter((p) => p.kind !== 'REFUND').reduce((sum, p) => sum + p.amount, 0) * 100)
    : null
  const refundsCents = paymentRows
    ? Math.round(paymentRows.reduce((sum, p) => sum + (p.refundedAmount ?? 0), 0) * 100)
    : null
  const netRevenueCents = grossRevenueCents !== null && refundsCents !== null ? grossRevenueCents - refundsCents : null

  const commissionRows = await safely(() =>
    prisma.commissionEntry.findMany({
      where: { businessId, createdAt: window },
      select: { commissionAmount: true, adjustment: true, refundAdjustment: true },
    }),
  )
  const commissionsCents = commissionRows
    ? Math.round(commissionRows.reduce((sum, c) => sum + c.commissionAmount + c.adjustment + c.refundAdjustment, 0) * 100)
    : null

  const newCustomers = await safely(() => prisma.customer.count({ where: { businessId, createdAt: window } }))
  const returningRows = await safely(() =>
    prisma.appointment.findMany({
      where: { businessId, startTime: window, status: 'COMPLETED', customer: { createdAt: { lt: range.start } } },
      select: { customerId: true },
      distinct: ['customerId'],
    }),
  )
  const returningCustomers = returningRows ? returningRows.length : null

  const activeMemberships = await safely(() => prisma.membership.count({ where: { businessId, status: 'ACTIVE' } }))
  const staffCount = await safely(() => prisma.barber.count({ where: { businessId } }))

  // Schedules belong to barbers, so the business is reached through the barber relation.
  const schedules = await safely(() =>
    prisma.schedule.findMany({
      where: { barber: { businessId } },
      select: { dayOfWeek: true, startTime: true, endTime: true, isOff: true },
    }),
  )
  const bookedRows = await safely(() =>
    prisma.appointment.findMany({
      where: { businessId, startTime: window, status: { in: [...COUNTS_AS_BOOKED] } },
      select: { startTime: true, endTime: true },
    }),
  )

  let utilisationPercent: number | null = null
  if (schedules && bookedRows) {
    const weekly = weeklyOpenMinutes(schedules as ScheduleRow[])
    const days = Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000))
    if (weekly !== null && weekly > 0) {
      const available = (weekly / 7) * days
      const booked = bookedRows.reduce((sum, row) => sum + Math.max(0, (row.endTime.getTime() - row.startTime.getTime()) / 60_000), 0)
      utilisationPercent = available > 0 ? Math.min(100, Math.round((booked / available) * 100)) : null
    }
  }

  return {
    businessId,
    name: location.name,
    region: location.region,
    status: location.status,
    grossRevenueCents,
    refundsCents,
    netRevenueCents,
    commissionsCents,
    // No expense ledger exists in this template, so this is unknown rather than zero.
    recordedExpensesCents: null,
    appointments,
    completed,
    cancelled,
    newCustomers,
    returningCustomers,
    activeMemberships,
    membershipRevenueCents: null,
    utilisationPercent,
    staffCount,
  }
}

export async function loadLocationRefs(businessIds: string[]): Promise<LocationRef[]> {
  if (businessIds.length === 0) return []
  const rows = await prisma.organizationLocation.findMany({
    where: { businessId: { in: businessIds } },
    select: { businessId: true, region: true, status: true, business: { select: { name: true } } },
  })
  return rows.map((row) => ({
    businessId: row.businessId,
    name: row.business.name,
    region: row.region,
    status: row.status,
  }))
}

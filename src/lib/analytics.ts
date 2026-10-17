// ============================================================================
// Analytics Engine — Business intelligence for barbershop dashboard
// Computes: today's stats, business performance, services per barber, peak hours
// ============================================================================

import { prisma } from '@/lib/prisma'
import { AppointmentStatus } from '@prisma/client'
import { DateTime } from 'luxon'
import { resolveBusinessTimezone } from '@/lib/timezone'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TodayStats {
  totalAppointments: number
  cancellations: number
  noShows: number
  newCustomers: number
  completed: number
  upcoming: number
}

export interface BusinessPerformance {
  totalAppointments: number
  completedAppointments: number
  cancelledAppointments: number
  noShowAppointments: number
  collectedRevenue: number
  /** Prompt 10 reconciliation: legacy service-price sum (estimate only) and
   * its delta vs ledger revenue. Never displayed as revenue. */
  serviceValueEstimate: number
  revenueDelta: number
  averageTicket: number
  cancellationRate: number
  noShowRate: number
  retentionRate: number
  newCustomers: number
  returningCustomers: number
  totalCustomers: number
}

export interface ServiceBarberBreakdown {
  serviceName: string
  totalCount: number
  barberBreakdown: { barberName: string; count: number }[]
}

export interface PeakHour {
  dayOfWeek: string
  hour: string
  count: number
}

export interface AnalyticsResult {
  today: TodayStats
  performance: BusinessPerformance
  servicesPerBarber: ServiceBarberBreakdown[]
  peakHours: PeakHour[]
  /** Prompt 8: booking-source attribution for range appointments. Rows with
   * no source (pre-§8 history) are bucketed as UNKNOWN — never fabricated. */
  bookingSourceBreakdown: { source: string; count: number }[]
  barberPerformance: {
    barberName: string
    appointments: number
    revenue: number
    cancellations: number
    noShows: number
  }[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function businessDayBounds(timezone: string, date: Date) {
  const local = DateTime.fromJSDate(date).setZone(timezone)
  return {
    start: local.startOf('day').toUTC().toJSDate(),
    end: local.endOf('day').toUTC().toJSDate(),
  }
}

export interface AnalyticsRange {
  start?: Date
  end?: Date
}

function resolveRange(timezone: string, rangeDays: number, range?: AnalyticsRange) {
  if (range?.start && range?.end) {
    if (range.start > range.end) throw new Error('Analytics range start must precede end')
    return { start: range.start, end: range.end }
  }
  const now = DateTime.now().setZone(timezone)
  return {
    start: now.minus({ days: Math.max(1, rangeDays) - 1 }).startOf('day').toUTC().toJSDate(),
    end: now.endOf('day').toUTC().toJSDate(),
  }
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour < 12) return `${hour} AM`
  if (hour === 12) return '12 PM'
  return `${hour - 12} PM`
}

// ─── Main Analytics Function ────────────────────────────────────────────────

export async function getAnalytics(
  businessId: string,
  rangeDays: number = 30,
  range?: AnalyticsRange
): Promise<AnalyticsResult> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { timezone: true },
  })
  const timezone = resolveBusinessTimezone(business)
  const now = new Date()
  const todayBounds = businessDayBounds(timezone, now)
  const selectedRange = resolveRange(timezone, rangeDays, range)
  const todayStart = todayBounds.start
  const todayEnd = todayBounds.end
  const rangeStart = selectedRange.start
  const rangeEnd = selectedRange.end

  // ── Today's stats ──────────────────────────────────────────────────────────
  const [
    todayAppointments,
    todayCancellations,
    todayNoShows,
    todayNewCustomers,
  ] = await Promise.all([
    prisma.appointment.count({
      where: {
        businessId,
        startTime: { gte: todayStart, lte: todayEnd },
      },
    }),
    prisma.appointment.count({
      where: {
        businessId,
        status: AppointmentStatus.CANCELLED,
        startTime: { gte: todayStart, lte: todayEnd },
      },
    }),
    prisma.appointment.count({
      where: {
        businessId,
        status: AppointmentStatus.NO_SHOW,
        startTime: { gte: todayStart, lte: todayEnd },
      },
    }),
    prisma.customer.count({
      where: {
        businessId,
        createdAt: { gte: todayStart, lte: todayEnd },
      },
    }),
  ])

  const todayCompleted = await prisma.appointment.count({
    where: {
      businessId,
      status: AppointmentStatus.COMPLETED,
      startTime: { gte: todayStart, lte: todayEnd },
    },
  })

  const todayUpcoming = await prisma.appointment.count({
    where: {
      businessId,
      status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
      startTime: { gte: todayStart, lte: todayEnd },
    },
  })

  const today: TodayStats = {
    totalAppointments: todayAppointments,
    cancellations: todayCancellations,
    noShows: todayNoShows,
    newCustomers: todayNewCustomers,
    completed: todayCompleted,
    upcoming: todayUpcoming,
  }

  // ── Business Performance (range) ───────────────────────────────────────────
  const [
    allRangeAppointments,
    rangeCompleted,
    rangeCancelled,
    rangeNoShow,
    rangeNewCustomers,
    totalCustomers,
    rangeCompletedWithService,
    rangePayments,
  ] = await Promise.all([
    prisma.appointment.count({
      where: {
        businessId,
        startTime: { gte: rangeStart, lte: rangeEnd },
      },
    }),
    prisma.appointment.count({
      where: {
        businessId,
        status: AppointmentStatus.COMPLETED,
        startTime: { gte: rangeStart, lte: rangeEnd },
      },
    }),
    prisma.appointment.count({
      where: {
        businessId,
        status: AppointmentStatus.CANCELLED,
        startTime: { gte: rangeStart, lte: rangeEnd },
      },
    }),
    prisma.appointment.count({
      where: {
        businessId,
        status: AppointmentStatus.NO_SHOW,
        startTime: { gte: rangeStart, lte: rangeEnd },
      },
    }),
    prisma.customer.count({
      where: {
        businessId,
        createdAt: { gte: rangeStart, lte: rangeEnd },
      },
    }),
    prisma.customer.count({
      where: { businessId, archivedAt: null },
    }),
    prisma.appointment.findMany({
      where: {
        businessId,
        status: AppointmentStatus.COMPLETED,
        startTime: { gte: rangeStart, lte: rangeEnd },
      },
      select: {
        customerId: true,
        service: { select: { price: true } },
      },
    }),
    prisma.payment.findMany({
      where: {
        businessId,
        createdAt: { gte: rangeStart, lte: rangeEnd },
        status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] },
        kind: { in: ['CHARGE', 'DEPOSIT', 'CANCELLATION_FEE', 'NO_SHOW_FEE'] },
      },
      select: { amount: true, refundedAmount: true },
    }),
  ])

  // Financial reporting uses settled ledger rows, not listed service prices.
  // Refunds are subtracted from the original payment and tips are excluded.
  const collectedRevenue = rangePayments.reduce(
    (sum, payment) => sum + Math.max(0, payment.amount - payment.refundedAmount),
    0,
  )
  const averageTicket = rangeCompleted > 0 ? collectedRevenue / rangeCompleted : 0

  // Prompt 10: reconciliation delta — ledger revenue vs the legacy
  // service-price estimate. Positive = collected beyond listed prices
  // (fees, upgrades); negative = completed visits with no settled payment.
  const serviceValueEstimate = rangeCompletedWithService.reduce(
    (sum, a) => sum + (a.service?.price || 0),
    0,
  )
  const revenueDelta = collectedRevenue - serviceValueEstimate

  // Retention rate: customers who had >1 completed appointment in range
  const customerVisitCounts = new Map<string, number>()
  for (const a of rangeCompletedWithService) {
    customerVisitCounts.set(a.customerId, (customerVisitCounts.get(a.customerId) || 0) + 1)
  }
  const returningCustomers = Array.from(customerVisitCounts.values()).filter(c => c > 1).length
  const customersWithVisits = customerVisitCounts.size
  const retentionRate = customersWithVisits > 0
    ? (returningCustomers / customersWithVisits) * 100
    : 0

  const cancellationRate = allRangeAppointments > 0
    ? (rangeCancelled / allRangeAppointments) * 100
    : 0
  const noShowRate = allRangeAppointments > 0
    ? (rangeNoShow / allRangeAppointments) * 100
    : 0

  const performance: BusinessPerformance = {
    totalAppointments: allRangeAppointments,
    completedAppointments: rangeCompleted,
    cancelledAppointments: rangeCancelled,
    noShowAppointments: rangeNoShow,
    collectedRevenue,
    serviceValueEstimate,
    revenueDelta,
    averageTicket,
    cancellationRate,
    noShowRate,
    retentionRate,
    newCustomers: rangeNewCustomers,
    returningCustomers,
    totalCustomers,
  }

  // ── Services Per Barber ─────────────────────────────────────────────────────
  const completedAppointments = await prisma.appointment.findMany({
    where: {
      businessId,
      status: AppointmentStatus.COMPLETED,
      startTime: { gte: rangeStart, lte: rangeEnd },
    },
    include: {
      service: { select: { name: true } },
      barber: { select: { name: true } },
    },
  })

  // Group by service, then by barber within each service
  const serviceMap = new Map<string, { totalCount: number; barbers: Map<string, number> }>()
  for (const a of completedAppointments) {
    const serviceName = a.service?.name || 'Unknown'
    if (!serviceMap.has(serviceName)) {
      serviceMap.set(serviceName, { totalCount: 0, barbers: new Map() })
    }
    const svc = serviceMap.get(serviceName)!
    svc.totalCount++
    const barberName = a.barber?.name || 'Unknown'
    svc.barbers.set(barberName, (svc.barbers.get(barberName) || 0) + 1)
  }

  const servicesPerBarber: ServiceBarberBreakdown[] = Array.from(serviceMap.entries())
    .map(([serviceName, data]) => ({
      serviceName,
      totalCount: data.totalCount,
      barberBreakdown: Array.from(data.barbers.entries())
        .map(([barberName, count]) => ({ barberName, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.totalCount - a.totalCount)

  // ── Peak Hours ──────────────────────────────────────────────────────────────
  const hourMap = new Map<string, number>()
  for (const a of completedAppointments) {
    const dayName = DAY_NAMES[a.startTime.getDay()]
    const hourLabel = formatHour(a.startTime.getHours())
    const key = `${dayName} ${hourLabel}`
    hourMap.set(key, (hourMap.get(key) || 0) + 1)
  }

  const peakHours: PeakHour[] = Array.from(hourMap.entries())
    .map(([key, count]) => {
      const [dayOfWeek, ...hourParts] = key.split(' ')
      return { dayOfWeek, hour: hourParts.join(' '), count }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // ── Barber Performance ──────────────────────────────────────────────────────
  const barberMap = new Map<string, { appointments: number; revenue: number; cancellations: number; noShows: number }>()
  const allRangeAppts = await prisma.appointment.findMany({
    where: {
      businessId,
      startTime: { gte: rangeStart, lte: rangeEnd },
    },
    include: {
      barber: { select: { name: true } },
      service: { select: { price: true } },
    },
  })

  for (const a of allRangeAppts) {
    const barberName = a.barber?.name || 'Unknown'
    if (!barberMap.has(barberName)) {
      barberMap.set(barberName, { appointments: 0, revenue: 0, cancellations: 0, noShows: 0 })
    }
    const b = barberMap.get(barberName)!
    b.appointments++
    if (a.status === AppointmentStatus.COMPLETED) {
      b.revenue += a.service?.price || 0
    }
    if (a.status === AppointmentStatus.CANCELLED) b.cancellations++
    if (a.status === AppointmentStatus.NO_SHOW) b.noShows++
  }

  const barberPerformance = Array.from(barberMap.entries())
    .map(([barberName, data]) => ({ barberName, ...data }))
    .sort((a, b) => b.revenue - a.revenue)

  // ── Prompt 8: booking-source breakdown ─────────────────────────────────────
  const sourceRows = await prisma.appointment.findMany({
    where: { businessId, startTime: { gte: rangeStart, lte: rangeEnd } },
    select: { bookingSource: true },
  })
  const sourceCounts = new Map<string, number>()
  for (const a of sourceRows) {
    const key = a.bookingSource ?? 'UNKNOWN'
    sourceCounts.set(key, (sourceCounts.get(key) || 0) + 1)
  }
  const bookingSourceBreakdown = Array.from(sourceCounts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)

  return {
    today,
    performance,
    servicesPerBarber,
    peakHours,
    barberPerformance,
    bookingSourceBreakdown,
  }
}

// ============================================================================
// Analytics Engine — Business intelligence for barbershop dashboard
// Computes: today's stats, business performance, services per barber, peak hours
// ============================================================================

import { prisma } from '@/lib/prisma'
import { AppointmentStatus } from '@prisma/client'

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
  barberPerformance: {
    barberName: string
    appointments: number
    revenue: number
    cancellations: number
    noShows: number
  }[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

function daysAgo(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(0, 0, 0, 0)
  return d
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
  rangeDays: number = 30
): Promise<AnalyticsResult> {
  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const rangeStart = daysAgo(rangeDays)

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
        startTime: { gte: rangeStart },
      },
    }),
    prisma.appointment.count({
      where: {
        businessId,
        status: AppointmentStatus.COMPLETED,
        startTime: { gte: rangeStart },
      },
    }),
    prisma.appointment.count({
      where: {
        businessId,
        status: AppointmentStatus.CANCELLED,
        startTime: { gte: rangeStart },
      },
    }),
    prisma.appointment.count({
      where: {
        businessId,
        status: AppointmentStatus.NO_SHOW,
        startTime: { gte: rangeStart },
      },
    }),
    prisma.customer.count({
      where: {
        businessId,
        createdAt: { gte: rangeStart },
      },
    }),
    prisma.customer.count({
      where: { businessId, archivedAt: null },
    }),
    prisma.appointment.findMany({
      where: {
        businessId,
        status: AppointmentStatus.COMPLETED,
        startTime: { gte: rangeStart },
      },
      select: {
        customerId: true,
        service: { select: { price: true } },
      },
    }),
    prisma.payment.findMany({
      where: {
        businessId,
        createdAt: { gte: rangeStart },
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
      startTime: { gte: rangeStart },
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
      startTime: { gte: rangeStart },
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

  return {
    today,
    performance,
    servicesPerBarber,
    peakHours,
    barberPerformance,
  }
}

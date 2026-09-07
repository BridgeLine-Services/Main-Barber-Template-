import { prisma } from '@/lib/prisma'
import { getRebookingTasks } from '@/lib/rebooking-engine'

export interface RetentionDashboardMetrics {
  due: number
  overdue: number
  atRisk: number
  inactive: number
  cancellations: number
  noShows: number
  todayAppointments: number
  tomorrowAppointments: number
}

export async function getRetentionDashboardMetrics(businessId: string): Promise<RetentionDashboardMetrics> {
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startTomorrow = new Date(startToday)
  startTomorrow.setDate(startTomorrow.getDate() + 1)
  const startDayAfter = new Date(startTomorrow)
  startDayAfter.setDate(startDayAfter.getDate() + 1)

  const [tasks, cancellations, noShows, todayAppointments, tomorrowAppointments] = await Promise.all([
    getRebookingTasks(businessId),
    prisma.appointment.count({ where: { businessId, status: 'CANCELLED', updatedAt: { gte: startToday } } }),
    prisma.appointment.count({ where: { businessId, status: 'NO_SHOW', updatedAt: { gte: startToday } } }),
    prisma.appointment.count({ where: { businessId, startTime: { gte: startToday, lt: startTomorrow }, status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULED'] } } }),
    prisma.appointment.count({ where: { businessId, startTime: { gte: startTomorrow, lt: startDayAfter }, status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULED'] } } }),
  ])

  return {
    due: tasks.length,
    overdue: tasks.filter((task) => task.daysOverdue > 0).length,
    atRisk: tasks.filter((task) => task.daysOverdue >= 30).length,
    inactive: tasks.filter((task) => task.daysOverdue >= 90).length,
    cancellations,
    noShows,
    todayAppointments,
    tomorrowAppointments,
  }
}

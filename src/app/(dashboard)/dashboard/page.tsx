import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { TodayAppointmentsView } from '@/components/dashboard/TodayAppointmentsView'
import type { Prisma } from '@prisma/client'

export default async function DashboardHomePage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user
  const businessId = user.businessId
  const userRole = user.role
  const barberId = user.barberId

  // If owner has no business yet, redirect to onboarding
  if (userRole === 'OWNER' && !businessId) {
    redirect('/dashboard/onboarding')
  }

  // Start and end of today
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

  const todayDateStr = now.toISOString().split('T')[0]

  // Build where filter
  const whereFilter: Prisma.AppointmentWhereInput = {
    businessId,
    startTime: {
      gte: startOfDay,
      lte: endOfDay,
    },
  }

  // If BARBER role, limit to their appointments
  if (userRole === 'BARBER' && barberId) {
    whereFilter.barberId = barberId
  }

  let appointments: Prisma.AppointmentGetPayload<{ include: { customer: true; barber: true; service: true } }>[] = []
  try {
    appointments = await prisma.appointment.findMany({
      where: whereFilter,
      include: {
        customer: true,
        barber: true,
        service: true,
      },
      orderBy: {
        startTime: 'asc',
      },
    })
  } catch (error) {
    console.error('Failed to load appointments:', error)
  }

  // Format dates to JSON safe strings
  const formattedAppointments = appointments.map((a) => ({
    ...a,
    startTime: a.startTime instanceof Date ? a.startTime.toISOString() : a.startTime,
    endTime: a.endTime instanceof Date ? a.endTime.toISOString() : a.endTime,
    createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
    updatedAt: a.updatedAt instanceof Date ? a.updatedAt.toISOString() : a.updatedAt,
    customer: a.customer
      ? {
          ...a.customer,
          createdAt: a.customer.createdAt instanceof Date ? a.customer.createdAt.toISOString() : a.customer.createdAt,
          updatedAt: a.customer.updatedAt instanceof Date ? a.customer.updatedAt.toISOString() : a.customer.updatedAt,
        }
      : null,
    barber: a.barber
      ? {
          ...a.barber,
          createdAt: a.barber.createdAt instanceof Date ? a.barber.createdAt.toISOString() : a.barber.createdAt,
          updatedAt: a.barber.updatedAt instanceof Date ? a.barber.updatedAt.toISOString() : a.barber.updatedAt,
        }
      : null,
    service: a.service
      ? {
          ...a.service,
          createdAt: a.service.createdAt instanceof Date ? a.service.createdAt.toISOString() : a.service.createdAt,
          updatedAt: a.service.updatedAt instanceof Date ? a.service.updatedAt.toISOString() : a.service.updatedAt,
        }
      : null,
  }))

  return (
    <TodayAppointmentsView
      initialAppointments={formattedAppointments}
      todayDateStr={todayDateStr}
      userName={user.name || 'User'}
      userRole={userRole}
      barberId={barberId || undefined}
    />
  )
}

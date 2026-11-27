import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { TodayAppointmentsView } from '@/components/dashboard/TodayAppointmentsView'
import { resolveBusinessTimezone, formatInTimezone, dayBoundsFromYMD } from '@/lib/timezone'
import type { Prisma } from '@prisma/client'
import { RoleWelcomeCard } from '@/components/dashboard/RoleWelcomeCard'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { withTenant } from '@/lib/tenant-context'
import { can } from '@/lib/organization/capabilities'

export default async function DashboardHomePage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user
  const businessId = user.businessId
  const userRole = user.role
  const barberId = user.barberId
  const organizationResult = user.id
    ? await resolveOrganizationContext(user.id).catch(() => null)
    : null
  const organizationContext = organizationResult?.ok ? organizationResult.context : null
  const organizationRole = organizationContext?.role ?? null
  const dashboardExperienceRole = organizationRole && organizationRole !== 'BARBER' && organizationRole !== 'CUSTOMER'
    ? organizationRole
    : userRole
  const assignedLocationCount = organizationContext?.locationBusinessIds.length
  const canReadLocationAppointments = organizationContext
    ? can(organizationContext.role, 'appointments.location.read')
    : false
  const managerHomeBusinessId = canReadLocationAppointments
    && organizationContext?.homeBusinessId
    && organizationContext.locationBusinessIds.includes(organizationContext.homeBusinessId)
    ? organizationContext.homeBusinessId
    : null
  const dashboardBusinessId = canReadLocationAppointments ? managerHomeBusinessId : businessId

  // If owner has no business yet, redirect to onboarding
  if (userRole === 'OWNER' && !businessId) {
    redirect('/dashboard/onboarding')
  }

  // Start and end of today — in the business timezone, so the daily list
  // matches the shop's calendar day (not the server's UTC day).
  const tzBusiness = dashboardBusinessId
    ? await prisma.business.findUnique({ where: { id: dashboardBusinessId }, select: { timezone: true } }).catch(() => null)
    : null
  const businessTz = resolveBusinessTimezone(tzBusiness)
  const now = new Date()
  // Business-timezone YMD for the list bounds and client refreshes
  const todayDateStr = formatInTimezone(now, businessTz, 'yyyy-MM-dd')
  const [todayY, todayM, todayD] = todayDateStr.split('-').map(Number)
  const todayBounds = dayBoundsFromYMD(businessTz, todayY, todayM, todayD)
  const startOfDay = todayBounds.start
  const endOfDay = todayBounds.end

  // Build where filter
  const whereFilter: Prisma.AppointmentWhereInput = {
    businessId: dashboardBusinessId,
    startTime: {
      gte: startOfDay,
      lte: endOfDay,
    },
  }

  // If BARBER role, limit to their appointments
  if (userRole === 'BARBER' && barberId && !canReadLocationAppointments) {
    whereFilter.barberId = barberId
  }

  let appointments: Prisma.AppointmentGetPayload<{ include: { customer: true; barber: true; service: true } }>[] = []
  let appointmentsLoadFailed = !dashboardBusinessId
  if (dashboardBusinessId) {
    try {
      appointments = await withTenant(dashboardBusinessId, (tx) => tx.appointment.findMany({
        where: whereFilter,
        include: {
          customer: true,
          barber: true,
          service: true,
        },
        orderBy: {
          startTime: 'asc',
        },
      }))
    } catch (error) {
      appointmentsLoadFailed = true
      console.error('Failed to load appointments:', error)
    }
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
    <>
      <RoleWelcomeCard role={dashboardExperienceRole} assignedLocationCount={assignedLocationCount} />
      <TodayAppointmentsView
        initialAppointments={formattedAppointments}
        initialLoadError={appointmentsLoadFailed}
        todayDateStr={todayDateStr}
        userName={user.name || 'User'}
        userRole={userRole}
        barberId={barberId || undefined}
      />
    </>
  )
}

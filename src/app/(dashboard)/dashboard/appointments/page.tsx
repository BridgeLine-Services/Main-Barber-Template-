import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Prisma } from '@prisma/client'
import { AppointmentsListView } from '@/components/dashboard/AppointmentsListView'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { withTenant } from '@/lib/tenant-context'
import { can } from '@/lib/organization/capabilities'

export default async function AppointmentsPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user
  const userRole = user.role
  const barberId = user.barberId
  const organizationResult = user.id
    ? await resolveOrganizationContext(user.id).catch(() => null)
    : null
  const organizationContext = organizationResult?.ok ? organizationResult.context : null
  const canReadLocationAppointments = organizationContext
    ? can(organizationContext.role, 'appointments.location.read')
    : false
  const isLocationManager = organizationContext?.role === 'LOCATION_MANAGER'
  const managerHomeBusinessId = canReadLocationAppointments
    && organizationContext?.homeBusinessId
    && organizationContext.locationBusinessIds.includes(organizationContext.homeBusinessId)
    ? organizationContext.homeBusinessId
    : null
  const businessId = canReadLocationAppointments ? managerHomeBusinessId : user.businessId

  const whereFilter: Prisma.AppointmentWhereInput = { businessId }
  if (userRole === 'BARBER' && barberId && !canReadLocationAppointments) {
    whereFilter.barberId = barberId
  }

  type AppointmentWithIncludes = Prisma.AppointmentGetPayload<{
    include: { customer: true; barber: true; service: true; intakeResponses: true }
  }>
  let appointments: AppointmentWithIncludes[] = []
  let barbers: Array<{ id: string; name: string }> = []
  let appointmentsLoadFailed = !businessId
  if (businessId) {
    try {
      appointments = await withTenant(businessId, (tx) => tx.appointment.findMany({
        where: whereFilter,
        include: {
          customer: true,
          barber: true,
          service: true,
          intakeResponses: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { startTime: 'desc' },
        take: 300,
      }))

      barbers = await withTenant(businessId, (tx) => tx.barber.findMany({
        where: { businessId, isActive: true },
        select: { id: true, name: true },
        orderBy: { order: 'asc' },
      }))
    } catch (error) {
      appointmentsLoadFailed = true
      console.error('Failed to load appointments:', error)
    }
  }

  const formattedAppointments = appointments.map((a) => ({
    ...a,
    startTime: a.startTime.toISOString(),
    endTime: a.endTime.toISOString(),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    customer: a.customer
      ? {
          ...a.customer,
          createdAt: a.customer.createdAt.toISOString(),
          updatedAt: a.customer.updatedAt.toISOString(),
        }
      : null,
    barber: a.barber
      ? {
          ...a.barber,
          createdAt: a.barber.createdAt.toISOString(),
          updatedAt: a.barber.updatedAt.toISOString(),
        }
      : null,
    service: a.service
      ? {
          ...a.service,
          createdAt: a.service.createdAt.toISOString(),
          updatedAt: a.service.updatedAt.toISOString(),
        }
      : null,
  }))

  return (
    <AppointmentsListView
      initialAppointments={formattedAppointments}
      barbers={barbers}
      userRole={userRole}
      isLocationManager={isLocationManager}
      initialLoadError={appointmentsLoadFailed}
    />
  )
}

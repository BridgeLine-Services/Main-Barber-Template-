import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { canManageBusiness } from '@/lib/permissions'
import { ServicesClient } from '@/components/dashboard/ServicesClient'
import { BarberServicesClient } from '@/components/dashboard/BarberServicesClient'

export default async function ServicesPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user as any
  if (!canManageBusiness(user.role)) {
    return <BarberServicesClient />
  }

  const businessId = user.businessId

  let services: any[] = []
  let barbers: any[] = []

  try {
    [services, barbers] = await Promise.all([
      prisma.service.findMany({
        where: { businessId },
        include: {
          barbers: {
            include: {
              barber: true,
            },
          },
        },
        orderBy: { order: 'asc' },
      }),
      prisma.barber.findMany({
        where: { businessId, isActive: true },
        orderBy: { name: 'asc' },
      }),
    ])
  } catch (error) {
    console.error('Failed to load services:', error)
  }

  const serializedServices = services.map((s) => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    barbers: s.barbers.map((b: any) => ({
      barberId: b.barberId,
      serviceId: b.serviceId,
      barberName: b.barber?.name,
    })),
  }))

  const serializedBarbers = barbers.map((b) => ({
    id: b.id,
    name: b.name,
    isActive: b.isActive,
  }))

  return (
    <div className="max-w-7xl mx-auto">
      <ServicesClient initialServices={serializedServices} barbers={serializedBarbers} />
    </div>
  )
}

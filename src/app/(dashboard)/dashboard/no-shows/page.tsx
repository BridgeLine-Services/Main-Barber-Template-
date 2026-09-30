import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { canManageBusiness } from '@/lib/permissions'
import { NoShowManagementClient } from './NoShowManagementClient'

export default async function NoShowManagementPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user
  if (!canManageBusiness(user.role)) {
    redirect('/dashboard')
  }

  let initialData: any = null

  try {
    const noShows = await prisma.appointment.findMany({
      where: {
        businessId: user.businessId,
        status: 'NO_SHOW',
      },
      include: {
        customer: {
          select: { id: true, firstName: true, lastName: true, phone: true, email: true },
        },
        barber: { select: { name: true } },
        service: { select: { name: true, price: true } },
      },
      orderBy: { startTime: 'desc' },
      take: 100,
    })

    const customerNoShowCounts = new Map<string, number>()
    for (const a of noShows) {
      customerNoShowCounts.set(a.customerId, (customerNoShowCounts.get(a.customerId) || 0) + 1)
    }

    let policy = await prisma.noShowPolicy.findFirst({
      where: { businessId: user.businessId },
    })

    if (!policy) {
      policy = await prisma.noShowPolicy.create({
        data: { businessId: user.businessId },
      })
    }

    const serializedNoShows = noShows.map(a => ({
      ...a,
      startTime: a.startTime.toISOString(),
      endTime: a.endTime.toISOString(),
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      noShowCount: customerNoShowCounts.get(a.customerId) || 1,
    }))

    initialData = {
      noShows: serializedNoShows,
      policy: {
        ...policy,
        createdAt: policy.createdAt.toISOString(),
        updatedAt: policy.updatedAt.toISOString(),
      },
      stats: {
        total: noShows.length,
        uniqueCustomers: customerNoShowCounts.size,
        repeatOffenders: Array.from(customerNoShowCounts.values()).filter(c => c >= 2).length,
      },
    }
  } catch (error) {
    console.error('Failed to load no-shows:', error)
  }

  return <NoShowManagementClient initialData={initialData} />
}

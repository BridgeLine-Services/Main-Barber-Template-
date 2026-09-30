import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { canManageBusiness } from '@/lib/permissions'
import { NoShowManagementClient } from './NoShowManagementClient'
import type { NoShowData } from './NoShowManagementClient'

export default async function NoShowManagementPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user
  if (!canManageBusiness(user.role)) {
    redirect('/dashboard')
  }

  let initialData: NoShowData | null = null

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
      id: a.id,
      confirmationNumber: a.confirmationNumber,
      startTime: a.startTime.toISOString(),
      noShowCount: customerNoShowCounts.get(a.customerId) || 1,
      noShowReason: a.noShowReason,
      noShowAt: a.noShowAt ? a.noShowAt.toISOString() : null,
      customer: a.customer,
      barber: a.barber,
      service: a.service,
    }))

    initialData = {
      noShows: serializedNoShows,
      policy: {
        id: policy.id,
        firstNoShow: policy.firstNoShow,
        secondNoShow: policy.secondNoShow,
        thirdNoShow: policy.thirdNoShow,
        requireDeposit: policy.requireDeposit,
        depositAmount: policy.depositAmount,
        isActive: policy.isActive,
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

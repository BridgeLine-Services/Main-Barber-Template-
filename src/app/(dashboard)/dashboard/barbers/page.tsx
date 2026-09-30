import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { canManageBusiness } from '@/lib/permissions'
import { BarbersClient } from '@/components/dashboard/BarbersClient'

export default async function BarbersPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user
  if (!canManageBusiness(user.role)) {
    redirect('/dashboard')
  }

  const businessId = user.businessId

  let barbers: Prisma.BarberGetPayload<{ include: { _count: { select: { appointments: true } } } }>[] = []
  try {
    barbers = await prisma.barber.findMany({
      where: { businessId },
      include: {
        _count: {
          select: { appointments: true },
        },
      },
      orderBy: { order: 'asc' },
    })
  } catch (error) {
    console.error('Failed to load barbers:', error)
  }

  const serializedBarbers = barbers.map((b) => ({
    ...b,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }))

  return (
    <div className="max-w-7xl mx-auto">
      <BarbersClient initialBarbers={serializedBarbers} />
    </div>
  )
}

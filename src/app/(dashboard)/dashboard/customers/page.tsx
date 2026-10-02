import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { CustomersListView } from '@/components/dashboard/CustomersListView'

export default async function CustomersPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user
  const businessId = user.businessId
  const isBarber = user.role === 'BARBER'
  const barberId = user.barberId

  const whereClause: Prisma.CustomerWhereInput = { businessId }
  if (isBarber && barberId) {
    whereClause.appointments = {
      some: { barberId },
    }
  }

  type CustomerWithIncludes = Prisma.CustomerGetPayload<{
    include: {
      _count: { select: { appointments: true } }
      appointments: { select: { startTime: true }; orderBy: { startTime: 'desc' }; take: number }
    }
  }>
  let customers: CustomerWithIncludes[] = []
  try {
    customers = await prisma.customer.findMany({
      where: whereClause,
      include: {
        _count: {
          select: { appointments: true },
        },
        appointments: {
          select: { startTime: true },
          orderBy: { startTime: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    })
  } catch (error) {
    console.error('Failed to load customers:', error)
  }

  const serializedCustomers = customers.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    appointments: c.appointments.map((a) => ({
      ...a,
      startTime: a.startTime.toISOString(),
    })),
  }))

  const isOwner = user.role === 'OWNER'

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {isOwner && (
        <div className="flex justify-end">
          <a href="/api/dashboard/customers/export" download>
            <button className="inline-flex items-center gap-2 rounded-lg border border-input bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-[var(--dash-hover)] hover:border-[var(--dash-brand-border)]">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Export CSV
            </button>
          </a>
        </div>
      )}
      <CustomersListView initialCustomers={serializedCustomers} />
    </div>
  )
}

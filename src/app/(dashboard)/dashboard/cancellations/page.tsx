import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { CancellationIntelligenceClient } from './CancellationIntelligenceClient'

export default async function CancellationIntelligencePage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user as any
  if (user.role !== 'OWNER') {
    redirect('/dashboard')
  }

  let records: any[] = []
  let stats: any = { total: 0, byReason: {}, uniqueCustomers: 0 }

  try {
    const rawRecords = await prisma.cancellationRecord.findMany({
      where: { businessId: user.businessId },
      include: {
        customer: {
          select: { id: true, firstName: true, lastName: true, phone: true, email: true },
        },
        appointment: {
          select: {
            id: true,
            status: true,
            startTime: true,
            endTime: true,
            service: { select: { id: true, name: true } },
            barber: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    const now = new Date()
    records = rawRecords.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      appointment: r.appointment
        ? {
            id: r.appointment.id,
            status: r.appointment.status,
            serviceName: r.appointment.service?.name || '',
            barberName: r.appointment.barber?.name || '',
            startTime: r.appointment.startTime.toISOString(),
            endTime: r.appointment.endTime.toISOString(),
            fillable: r.appointment.status === 'CANCELLED' && r.appointment.startTime > now,
          }
        : null,
    }))

    stats = {
      total: records.length,
      byReason: records.reduce((acc, r) => {
        acc[r.reason] = (acc[r.reason] || 0) + 1
        return acc
      }, {} as Record<string, number>),
      uniqueCustomers: new Set(records.map(r => r.customerId)).size,
    }
  } catch (error) {
    console.error('Failed to load cancellations:', error)
  }

  return <CancellationIntelligenceClient initialRecords={records} initialStats={stats} />
}

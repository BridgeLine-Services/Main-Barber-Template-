import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getReliabilitySummary } from '@/lib/reliability'
import { handleApiError } from '@/lib/api-errors'

// GET /api/dashboard/no-shows — list no-show appointments and policy
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const user = session.user as any
    if (user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    try {
      // Get no-show appointments
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
        take: limit,
      })
      // Count all lifecycle outcomes per customer so limited result pages do not under-report risk.
      const customerAppointments = await prisma.appointment.findMany({
        where: { businessId: user.businessId },
        select: { customerId: true, status: true },
      })
      const customerMetrics = new Map<string, { completed: number; cancelled: number; noShows: number }>()
      for (const appointment of customerAppointments) {
        const metrics = customerMetrics.get(appointment.customerId) || { completed: 0, cancelled: 0, noShows: 0 }
        if (appointment.status === 'COMPLETED') metrics.completed++
        if (appointment.status === 'CANCELLED') metrics.cancelled++
        if (appointment.status === 'NO_SHOW') metrics.noShows++
        customerMetrics.set(appointment.customerId, metrics)
      }
      const customerNoShowCounts = new Map<string, number>()
      for (const [customerId, metrics] of customerMetrics) {
        customerNoShowCounts.set(customerId, metrics.noShows)
      }
      // Get or create no-show policy
      let policy = await prisma.noShowPolicy.findFirst({
        where: { businessId: user.businessId },
      })
      if (!policy) {
        policy = await prisma.noShowPolicy.create({
          data: { businessId: user.businessId },
        })
      }
      const serializedNoShows = noShows.map(a => {
        const metrics = customerMetrics.get(a.customerId) || { completed: 0, cancelled: 0, noShows: 1 }
        return {
          ...a,
          startTime: a.startTime.toISOString(),
          endTime: a.endTime.toISOString(),
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
          noShowCount: customerNoShowCounts.get(a.customerId) || 1,
          reliability: getReliabilitySummary(metrics),
        }
      })
      return NextResponse.json({
        noShows: serializedNoShows,
        policy,
        stats: {
          total: noShows.length,
          uniqueCustomers: customerNoShowCounts.size,
          repeatOffenders: Array.from(customerNoShowCounts.values()).filter(c => c >= 2).length,
        },
      })
    } catch (error) {
      console.error('No-show fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch no-shows' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/no-shows')
  }
}

// PATCH /api/dashboard/no-shows — update no-show policy
export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const user = session.user as any
    if (user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    try {
      const body = await request.json()
      const { firstNoShow, secondNoShow, thirdNoShow, requireDeposit, depositAmount, isActive } = body
      let policy = await prisma.noShowPolicy.findFirst({
        where: { businessId: user.businessId },
      })
      if (!policy) {
        policy = await prisma.noShowPolicy.create({
          data: {
            businessId: user.businessId,
            firstNoShow: firstNoShow || 'warning',
            secondNoShow: secondNoShow || 'flag',
            thirdNoShow: thirdNoShow || 'require_confirmation',
            requireDeposit: requireDeposit || false,
            depositAmount: depositAmount || null,
            isActive: isActive ?? true,
          },
        })
      } else {
        policy = await prisma.noShowPolicy.update({
          where: { id: policy.id },
          data: {
            ...(firstNoShow !== undefined && { firstNoShow }),
            ...(secondNoShow !== undefined && { secondNoShow }),
            ...(thirdNoShow !== undefined && { thirdNoShow }),
            ...(requireDeposit !== undefined && { requireDeposit }),
            ...(depositAmount !== undefined && { depositAmount: depositAmount ? parseFloat(depositAmount) : null }),
            ...(isActive !== undefined && { isActive }),
          },
        })
      }
      await prisma.auditLog.create({
        data: {
          businessId: user.businessId,
          userId: user.id,
          action: 'NO_SHOW_POLICY_UPDATED',
          entityType: 'NoShowPolicy',
          entityId: policy.id,
          newValues: { firstNoShow, secondNoShow, thirdNoShow, requireDeposit } as any,
        },
      })
      return NextResponse.json(policy)
    } catch (error) {
      console.error('No-show policy update error:', error)
      return NextResponse.json({ error: 'Failed to update policy' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/no-shows')
  }
}

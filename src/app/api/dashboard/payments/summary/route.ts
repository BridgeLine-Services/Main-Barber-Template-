import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { getPosSettings } from '@/lib/payments/pos'

/**
 * Owner financial dashboard tiles. Shop-wide financials — owner only.
 */
export async function GET() {
  try {
    const session = (await getServerSession(authOptions)) as { user?: { role: string; businessId?: string | null } } | null
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role !== 'OWNER' && user.role !== 'PLATFORM_OWNER') {
      return NextResponse.json({ error: 'Forbidden — owner access required' }, { status: 403 })
    }
    const businessId = user.businessId!
    const settings = await getPosSettings(businessId)
    if (!settings.enabled) return NextResponse.json({ posEnabled: false })

    const now = new Date()
    const startOfDay = new Date(now)
    startOfDay.setHours(0, 0, 0, 0)
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const payments = await prisma.payment.findMany({
      where: { businessId, createdAt: { gte: monthStart }, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } },
    })
    const r2 = (n: number) => Math.round(n * 100) / 100
    const since = (d: Date) => payments.filter((p) => p.createdAt >= d)
    const rev = (list: typeof payments) => r2(list.filter((p) => p.kind !== 'TIP' && p.kind !== 'REFUND').reduce((s, p) => s + p.amount, 0))
    const kindSum = (list: typeof payments, kind: string) => r2(list.filter((p) => p.kind === kind).reduce((s, p) => s + p.amount, 0))
    const methodSum = (list: typeof payments, method: string) =>
      r2(list.filter((p) => p.method === method && p.kind !== 'REFUND').reduce((s, p) => s + p.amount, 0))

    const charges = payments.filter((p) => p.kind === 'CHARGE')
    const refundsAll = await prisma.payment.aggregate({
      where: { businessId, kind: 'REFUND', status: 'SUCCEEDED', createdAt: { gte: monthStart } },
      _sum: { amount: true },
    })
    const outstandingRows = await prisma.appointment.findMany({
      where: { businessId, status: 'COMPLETED' },
      include: { service: { select: { price: true } }, payments: { where: { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } } } },
    })
    const outstanding = r2(
      outstandingRows.reduce((s, a) => {
        const collected = a.payments
          .filter((p) => p.kind !== 'TIP' && p.kind !== 'REFUND')
          .reduce((s2, p) => s2 + p.amount - p.refundedAmount, 0)
        return s + Math.max(0, (a.service?.price ?? 0) - collected)
      }, 0),
    )

    return NextResponse.json({
      posEnabled: true,
      todayRevenue: rev(since(startOfDay)),
      weekRevenue: rev(since(weekAgo)),
      monthRevenue: rev(payments),
      cardRevenue: methodSum(payments, 'CARD'),
      cashRevenue: methodSum(payments, 'CASH') + methodSum(payments, 'IN_PERSON'),
      tips: kindSum(payments, 'TIP'),
      refunds: r2(Math.abs(refundsAll._sum.amount ?? 0)),
      deposits: kindSum(payments, 'DEPOSIT'),
      outstanding,
      completedTransactions: charges.length,
      averageTicket: charges.length ? r2(charges.reduce((s, p) => s + p.amount, 0) / charges.length) : 0,
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/payments/summary')
  }
}

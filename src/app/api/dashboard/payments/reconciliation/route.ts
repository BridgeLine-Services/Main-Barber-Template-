import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { getPosSettings } from '@/lib/payments/pos'

/**
 * Owner reconciliation view. Shop-wide financials — owner only, never
 * exposed to barbers or business admins.
 */
export async function GET(request: Request) {
  try {
    const session = (await getServerSession(authOptions)) as { user?: { role: string; businessId?: string | null } } | null
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role !== 'OWNER' && user.role !== 'PLATFORM_OWNER') {
      return NextResponse.json({ error: 'Forbidden — owner access required' }, { status: 403 })
    }
    const businessId = user.businessId!
    const settings = await getPosSettings(businessId)
    if (!settings.enabled) return NextResponse.json({ error: 'Payments & POS is disabled' }, { status: 400 })

    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const filters: Record<string, unknown> = { businessId }
    if (from || to) {
      filters.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(`${to.slice(0, 10)}T23:59:59.999Z`) } : {}),
      }
    }
    if (searchParams.get('barberId')) filters.barberId = searchParams.get('barberId')
    if (searchParams.get('method')) filters.method = searchParams.get('method')
    if (searchParams.get('status')) filters.status = searchParams.get('status')
    if (searchParams.get('appointmentId')) filters.appointmentId = searchParams.get('appointmentId')

    const payments = await prisma.payment.findMany({
      where: filters,
      include: { refunds: { select: { amount: true, status: true } } },
    })

    const succeeded = payments.filter((p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED')
    const r2 = (n: number) => Math.round(n * 100) / 100
    const sum = (list: typeof payments, kinds: string[]) =>
      r2(list.filter((p) => kinds.includes(p.kind)).reduce((s, p) => s + p.amount, 0))
    const serviceRevenue = sum(succeeded, ['CHARGE', 'DEPOSIT', 'CANCELLATION_FEE', 'NO_SHOW_FEE'])
    const refunds = r2(payments.filter((p) => p.kind === 'REFUND' && p.status === 'SUCCEEDED').reduce((s, p) => s + Math.abs(p.amount), 0))
    const deposits = sum(succeeded, ['DEPOSIT'])
    const tips = sum(succeeded, ['TIP'])
    const byMethod = (m: string) => sum(succeeded.filter((p) => p.method === m), ['CHARGE', 'DEPOSIT', 'TIP', 'CANCELLATION_FEE', 'NO_SHOW_FEE'])

    // Outstanding balances: appointments with completed visits whose
    // (service total) exceeds what was collected.
    const appointmentIds = [...new Set(payments.map((p) => p.appointmentId).filter(Boolean))] as string[]
    let outstanding = 0
    if (appointmentIds.length) {
      const appts = await prisma.appointment.findMany({
        where: { businessId, id: { in: appointmentIds }, status: 'COMPLETED' },
        include: { service: { select: { price: true } }, payments: true },
      })
      for (const a of appts) {
        const collected = a.payments
          .filter((p) => (p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED') && p.kind !== 'TIP' && p.kind !== 'REFUND')
          .reduce((s, p) => s + p.amount - p.refundedAmount, 0)
        const price = a.service?.price ?? 0
        if (price > collected) outstanding += price - collected
      }
    }

    return NextResponse.json({
      grossSales: serviceRevenue,
      refunds,
      tips,
      deposits,
      cashPayments: byMethod('CASH'),
      cardPayments: byMethod('CARD') + byMethod('IN_PERSON'),
      onlinePayments: byMethod('CARD'),
      netSales: r2(serviceRevenue - refunds),
      outstandingBalances: r2(outstanding),
      transactionCount: succeeded.filter((p) => p.kind === 'CHARGE').length,
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/payments/reconciliation')
  }
}

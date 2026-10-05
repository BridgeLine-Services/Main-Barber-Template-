import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { getPaymentProvider } from '@/lib/payments'
import { getPosSettings } from '@/lib/payments/pos'
import { adjustCommissionsForRefund } from '@/lib/commissions'
import { adjustGiftCardForRefund } from '@/lib/gift-cards'

/** Refund (full or partial). Owner/admin only — never exposed to barbers. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = (await getServerSession(authOptions)) as { user?: { role: string; businessId?: string | null } } | null
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role !== 'OWNER' && user.role !== 'PLATFORM_OWNER' && user.role !== 'BUSINESS_ADMIN') {
      return NextResponse.json({ error: 'Forbidden — owner or manager access required' }, { status: 403 })
    }
    const businessId = user.businessId!
    const settings = await getPosSettings(businessId)
    if (!settings.enabled) return NextResponse.json({ error: 'Payments & POS is disabled' }, { status: 400 })

    const { id } = await params
    const body = (await request.json()) as { amount?: number; reason?: string }
    const payment = await prisma.payment.findFirst({ where: { id, businessId } }) // tenant-scoped
    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    if (payment.kind === 'REFUND') return NextResponse.json({ error: 'Cannot refund a refund' }, { status: 400 })

    const provider = getPaymentProvider(payment.provider)
    if (!provider) return NextResponse.json({ error: `Unknown provider ${payment.provider}` }, { status: 400 })
    if (!provider.online && payment.provider !== 'in_person') {
      return NextResponse.json({ error: 'Provider cannot process refunds' }, { status: 400 })
    }

    const amount = body.amount != null ? Math.round(body.amount * 100) / 100 : undefined
    const result = await prisma.$transaction(async (tx) => {
      const res = await provider.refund(
        { businessId, tx },
        {
          paymentId: payment.id,
          reason: body.reason,
          idempotencyKey: `refund:${payment.id}:${amount ?? 'full'}:${Date.now()}`,
          ...(amount !== undefined ? { amount } : {}),
        } as never,
      )
      // Refunds reduce the commissioned barber's payout in the same
      // transaction (idempotent — recomputed from refundedAmount).
      if (res.ok) {
        await adjustCommissionsForRefund(tx, businessId, payment.id)
        // Gift cards: restore balance for refunded redemptions, remove
        // value for refunded purchases. Idempotent.
        await adjustGiftCardForRefund(tx, businessId, payment.id)
      }
      return res
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ refund: result.payment })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/payments/[id]/refund')
  }
}

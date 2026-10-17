/**
 * Dashboard ecommerce: order management (owner/staff, session-scoped).
 *   GET  /api/dashboard/ecommerce/orders           — list + stats
 *   PATCH /api/dashboard/ecommerce/orders/[id]     — fulfillment, cancel, refund
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { StorefrontError, advanceFulfillment, cancelOrder, listOrders, orderStats } from '@/lib/ecommerce'

type SessionUser = { id?: string; role: string; businessId?: string | null }

export async function GET(request: Request) {
  try {
    const session = (await getServerSession(authOptions)) as { user?: SessionUser } | null
    const user = session?.user
    if (!user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const status = new URL(request.url).searchParams.get('status')
    const orders = await listOrders(user.businessId, {
      status: (['PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELED', 'PAYMENT_FAILED', 'REFUNDED'] as const).includes(status as never)
        ? (status as never)
        : undefined,
    })
    return NextResponse.json({ orders, stats: await orderStats(user.businessId) })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/ecommerce/orders')
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const session = (await getServerSession(authOptions)) as { user?: SessionUser } | null
    const user = session?.user
    if (!user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = (await request.json().catch(() => null)) as { action?: string; next?: 'PROCESSING' | 'SHIPPED' | 'DELIVERED'; trackingNumber?: string; restock?: boolean } | null
    if (!body?.action) return NextResponse.json({ error: 'action required' }, { status: 400 })

    switch (body.action) {
      case 'fulfill': {
        const order = await advanceFulfillment(
          user.businessId,
          id,
          (['PROCESSING', 'SHIPPED', 'DELIVERED'] as const).includes(body.next as never) ? (body.next as never) : (undefined as never),
          body.trackingNumber
        )
        return NextResponse.json({ success: true, status: order.status })
      }
      case 'cancel': {
        const order = await cancelOrder(user.businessId, id, body.restock ?? true)
        return NextResponse.json({ success: true, status: order.status })
      }
      case 'refund': {
        // Refunds flow through the SAME provider refund path as every other
        // payment (mirrors /api/dashboard/payments/[id]/refund), including
        // commission/gift-card adjustments. Amount defaults to a full refund.
        const order = await prisma.shopOrder.findFirst({ where: { id, businessId: user.businessId } })
        if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
        if (!order.paymentId) return NextResponse.json({ error: 'Order has no settled payment to refund' }, { status: 409 })
        const payment = await prisma.payment.findFirst({ where: { id: order.paymentId, businessId: user.businessId } })
        if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
        const { getPaymentProvider } = await import('@/lib/payments')
        const { adjustCommissionsForRefund } = await import('@/lib/commissions')
        const { adjustGiftCardForRefund } = await import('@/lib/gift-cards')
        const provider = getPaymentProvider(payment.provider)
        if (!provider) return NextResponse.json({ error: `Unknown provider ${payment.provider}` }, { status: 400 })
        const result = await prisma.$transaction(async (tx) => {
          const res = await provider.refund(
            { businessId: user.businessId!, tx },
            {
              paymentId: payment.id,
              idempotencyKey: `order-refund:${order.id}:${Date.now()}`,
            } as never,
          )
          if (res.ok) {
            await adjustCommissionsForRefund(tx, user.businessId!, payment.id)
            await adjustGiftCardForRefund(tx, user.businessId!, payment.id)
          }
          return res
        })
        if (!result.ok) return NextResponse.json({ error: result.error ?? 'Refund failed' }, { status: 409 })
        const updated = await prisma.shopOrder.update({ where: { id: order.id }, data: { status: 'REFUNDED' } })
        return NextResponse.json({ success: true, status: updated.status })
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error) {
    if (error instanceof StorefrontError) {
      const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'BAD_STATE' || error.code === 'BAD_TRANSITION' ? 409 : 400
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    return handleApiError(error, 'PATCH /api/dashboard/ecommerce/orders/[id]')
  }
}

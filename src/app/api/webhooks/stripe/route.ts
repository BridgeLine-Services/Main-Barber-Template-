/**
 * Stripe webhook — the settlement source of truth for online charges.
 *
 * SECURITY: signature verified (timing-safe HMAC) against
 * STRIPE_WEBHOOK_SECRET before anything is trusted. Duplicate event
 * deliveries are no-ops: every processed Stripe event id is recorded in
 * the StripeEvent table (unique) and re-checks are skipped. Ledger
 * updates also go through the status machine and use the Payment row's
 * own idempotency (already-succeeded payments are left alone).
 */
import { NextResponse } from 'next/server'
import { verifyStripeSignature } from '@/lib/payments/providers/stripe-client'
import { canTransition, transitionError } from '@/lib/payments'
import { prisma } from '@/lib/prisma'

export async function POST(request: Request) {
  const rawBody = await request.text()
  const event = verifyStripeSignature(rawBody, request.headers.get('stripe-signature'))
  if (!event) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }
  const eventId = (event.id as string) ?? 'unknown'
  const type = (event.type as string) ?? 'unknown'

  try {
    // Idempotency: insert-first. A unique violation means this event was
    // already processed — acknowledge and do nothing.
    try {
      await prisma.stripeEvent.create({ data: { eventId, type } })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        return NextResponse.json({ received: true, duplicate: true })
      }
      throw e
    }

    const data = (event.data as { object?: Record<string, unknown> })?.object ?? {}
    const paymentId =
      ((data.metadata as Record<string, unknown> | undefined)?.paymentId as string | undefined) ??
      undefined
    const intentId = (data.id as string) ?? undefined

    const payment = paymentId
      ? await prisma.payment.findFirst({ where: { id: paymentId } }) // ledger row itself is tenant-scoped
      : intentId
        ? await prisma.payment.findFirst({ where: { providerRefId: intentId } })
        : null

    if (!payment) {
      // Not ours (or missing metadata) — acknowledge so Stripe stops retrying.
      return NextResponse.json({ received: true, ignored: true })
    }

    if (type === 'payment_intent.succeeded' && canTransition(payment.status, 'SUCCEEDED')) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCEEDED',
          providerRefId: (intentId as string) ?? payment.providerRefId,
        },
      })
      if (payment.kind === 'NO_SHOW_FEE') {
        try {
          const { recordCommissionForFeePayment } = await import('@/lib/commissions')
          await prisma.$transaction((tx) => recordCommissionForFeePayment(tx, payment.businessId, payment.id))
        } catch (err) {
          console.error('no-show fee commission failed', err)
        }
      }
    } else if (type === 'payment_intent.payment_failed' && canTransition(payment.status, 'FAILED')) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failureReason: ((data.last_payment_error as Record<string, unknown> | undefined)?.message as string | undefined)?.slice(0, 280) ?? 'Payment failed',
        },
      })
    } else if (type === 'payment_intent.canceled' && canTransition(payment.status, 'CANCELED')) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'CANCELED' } })
    } else if (type === 'charge.refunded') {
      // Refunds initiated in Stripe (dashboard) sync back into the ledger.
      const refundedTotal = ((data.amount_refunded as number) ?? 0) / 100
      const original = refundedTotal > 0 ? payment.amount - refundedTotal >= 0.005 : false
      const target = original ? 'PARTIALLY_REFUNDED' : 'REFUNDED'
      if (canTransition(payment.status, target)) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { refundedAmount: Math.round(refundedTotal * 100) / 100, status: target },
        })
        // Keep commission payouts in sync with dashboard-initiated refunds.
        try {
          const { adjustCommissionsForRefund } = await import('@/lib/commissions')
          await prisma.$transaction((tx) => adjustCommissionsForRefund(tx, payment.businessId, payment.id))
        } catch (err) {
          console.error('commission refund adjustment failed', err)
        }
      } else if (payment.status !== 'SUCCEEDED') {
        console.warn(`stripe webhook: illegal refund transition ${payment.status} -> ${target}: ${transitionError(payment.status, target)}`)
      }
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Stripe webhook processing error:', error)
    // Delete the dedup row so a retry can reprocess cleanly.
    await prisma.stripeEvent.deleteMany({ where: { eventId } }).catch(() => {})
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

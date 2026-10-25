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
  if (!process.env.STRIPE_WEBHOOK_SECRET?.trim()) {
    return NextResponse.json({ error: 'Stripe webhook is not configured (STRIPE_WEBHOOK_SECRET is missing)' }, { status: 503 })
  }
  const rawBody = await request.text()
  const event = verifyStripeSignature(rawBody, request.headers.get('stripe-signature'))
  if (!event) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }
  const eventId = (event.id as string) ?? 'unknown'
  const type = (event.type as string) ?? 'unknown'

  try {
    // Claim the event atomically. A completed duplicate is safe to acknowledge;
    // a concurrent delivery must remain retryable instead of being mistaken for
    // completed work. Failed claims are reusable by Stripe's next delivery.
    try {
      await prisma.stripeEvent.create({ data: { eventId, type, status: 'PROCESSING' } })
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e
      const existing = await prisma.stripeEvent.findUnique({ where: { eventId }, select: { status: true } })
      if (existing?.status === 'COMPLETED') {
        return NextResponse.json({ received: true, duplicate: true })
      }
      if (existing?.status === 'PROCESSING') {
        return NextResponse.json({ error: 'Webhook is already processing' }, { status: 409 })
      }
      const reclaimed = await prisma.stripeEvent.updateMany({
        where: { eventId, status: 'FAILED' },
        data: { status: 'PROCESSING', failedAt: null, failure: null },
      })
      if (reclaimed.count !== 1) {
        return NextResponse.json({ error: 'Webhook claim unavailable' }, { status: 409 })
      }
    }

    const data = (event.data as { object?: Record<string, unknown> })?.object ?? {}

    // ── Membership subscription lifecycle (prompt 6C) ─────────────────────
    // These events have no Payment row: the membership resolves by its
    // stored subscriptionRef. The event was already signature-verified and
    // deduped above; each handler is additionally idempotent at state level
    // so replayed or out-of-order events cannot duplicate or rewind periods.
    if (type === 'invoice.paid' || type === 'invoice.payment_failed' ||
        type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
      const { subscription: sub, lines, status } = data as {
        subscription?: string | Record<string, unknown>
        lines?: { data?: Array<{ subscription?: string }> }
        status?: string
        cancel_at_period_end?: boolean
      }
      const subscriptionRef =
        typeof sub === 'string'
          ? sub
          : (sub as { id?: string } | undefined)?.id ??
            lines?.data?.[0]?.subscription ??
            (data.id as string | undefined)
      if (!subscriptionRef) {
        return NextResponse.json({ received: true, ignored: true })
      }
      const mb = await import('@/lib/memberships')
      if (type === 'invoice.paid') {
        const lines = Array.isArray((data.lines as { data?: unknown[] } | undefined)?.data)
          ? ((data.lines as { data: Array<{ subscription?: string; period?: { end?: number } }> }).data)
          : []
        const matchingLines = lines.filter((line) => !line.subscription || line.subscription === String(subscriptionRef))
        const periodEnds = matchingLines
          .map((line) => line.period?.end)
          .filter((end): end is number => typeof end === 'number' && Number.isFinite(end) && end > 0)
        if (periodEnds.length === 0) {
          throw new Error('invoice.paid missing a valid subscription line period end')
        }
        const periodEnd = new Date(Math.max(...periodEnds) * 1000)
        if (!Number.isFinite(periodEnd.getTime())) {
          throw new Error('invoice.paid contains an invalid subscription period end')
        }
        await mb.handleSubscriptionInvoicePaid(String(subscriptionRef), periodEnd)
      } else if (type === 'invoice.payment_failed') {
          await mb.handleSubscriptionInvoiceFailed(String(subscriptionRef))
        } else if (type === 'customer.subscription.updated') {
          await mb.handleSubscriptionUpdated(
            String(subscriptionRef),
            String(status ?? 'unknown'),
            data.cancel_at_period_end === true
          )
        } else {
        await mb.handleSubscriptionDeleted(String(subscriptionRef))
      }
      await prisma.stripeEvent.update({ where: { eventId }, data: { status: 'COMPLETED', processedAt: new Date() } })
      return NextResponse.json({ received: true })
    }

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

    if (type === 'payment_intent.succeeded' && (payment.status === 'SUCCEEDED' || canTransition(payment.status, 'SUCCEEDED'))) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCEEDED',
          providerRefId: (intentId as string) ?? payment.providerRefId,
        },
      })
      // A settled gift-card PURCHASE payment activates its card (online
      // customer purchases — POS sales are already ACTIVE).
      if ((payment.metadata as Record<string, unknown> | null)?.giftCardPurchase === true) {
        try {
          const { activateGiftCardForPayment } = await import('@/lib/gift-cards')
          await activateGiftCardForPayment(payment.id)
        } catch (err) {
          console.error('gift card activation failed', err)
          throw err
        }
      }
      // A settled membership enrollment payment activates the membership
      // (PENDING -> ACTIVE). Idempotent: re-delivery is a no-op.
      if ((payment.metadata as Record<string, unknown> | null)?.membershipEnrollment === true) {
        try {
          const { activateMembershipForPayment } = await import('@/lib/memberships')
          await activateMembershipForPayment(payment.id)
        } catch (err) {
          console.error('membership activation failed', err)
          throw err
        }
      }
      // A settled shop order payment marks the order PAID. Idempotent:
      // re-delivery is a no-op (status guard inside).
      if ((payment.metadata as Record<string, unknown> | null)?.shopOrder === true) {
        try {
          const { markOrderPaidForPayment } = await import('@/lib/ecommerce')
          await markOrderPaidForPayment(payment.id)
        } catch (err) {
          console.error('shop order activation failed', err)
          throw err
        }
      }
      if (payment.kind === 'NO_SHOW_FEE') {
        try {
          const { recordCommissionForFeePayment } = await import('@/lib/commissions')
          await prisma.$transaction((tx) => recordCommissionForFeePayment(tx, payment.businessId, payment.id))
        } catch (err) {
          console.error('no-show fee commission failed', err)
          throw err
        }
      }
    } else if (type === 'payment_intent.payment_failed' && (payment.status === 'FAILED' || canTransition(payment.status, 'FAILED'))) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failureReason: ((data.last_payment_error as Record<string, unknown> | undefined)?.message as string | undefined)?.slice(0, 280) ?? 'Payment failed',
        },
      })
      if ((payment.metadata as Record<string, unknown> | null)?.shopOrder === true) {
        try {
          const { markOrderPaymentFailed } = await import('@/lib/ecommerce')
          await markOrderPaymentFailed(payment.id)
        } catch (err) {
          console.error('shop order failure handling failed', err)
        }
      }
    } else if (type === 'payment_intent.canceled' && (payment.status === 'CANCELED' || canTransition(payment.status, 'CANCELED'))) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'CANCELED' } })
      if ((payment.metadata as Record<string, unknown> | null)?.shopOrder === true) {
        try {
          const { markOrderPaymentFailed } = await import('@/lib/ecommerce')
          await markOrderPaymentFailed(payment.id)
        } catch (err) {
          console.error('shop order cancellation handling failed', err)
        }
      }
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
          const { adjustGiftCardForRefund } = await import('@/lib/gift-cards')
          await prisma.$transaction(async (tx) => {
            await adjustCommissionsForRefund(tx, payment.businessId, payment.id)
            await adjustGiftCardForRefund(tx, payment.businessId, payment.id)
          })
        } catch (err) {
          console.error('commission refund adjustment failed', err)
        }
      } else if (payment.status !== 'SUCCEEDED') {
        console.warn(`stripe webhook: illegal refund transition ${payment.status} -> ${target}: ${transitionError(payment.status, target)}`)
      }
    }

    await prisma.stripeEvent.update({ where: { eventId }, data: { status: 'COMPLETED', processedAt: new Date() } })
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Stripe webhook processing error:', error)
    await prisma.stripeEvent.updateMany({
      where: { eventId, status: 'PROCESSING' },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failure: error instanceof Error ? error.message.slice(0, 500) : 'Webhook processing failed',
      },
    }).catch(() => {})
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

/**
 * Stripe payment provider — server-side only.
 *
 * Implements the PaymentProvider contract (see docs/PAYMENTS.md) using
 * Stripe's REST API via fetch. SECURITY RULES:
 *   - STRIPE_SECRET_KEY lives in server env vars only; it is never
 *     returned to clients and never imported in client components.
 *   - No card data ever touches this server: online charges go through
 *     Stripe-hosted PaymentIntents confirmed client-side or by webhooks.
 *   - Every write uses an idempotency key so retries/webhook replays
 *     cannot double-charge.
 *   - The StripeEvent table deduplicates webhook deliveries.
 */
import type {
  CreateChargeInput, Payment, PaymentKind, PaymentStatus,
  PaymentProvider, ProviderContext, ProviderResult, RefundInput,
} from '../types'
import { canTransition, transitionError } from '../state-machine'
import { stripeApi, stripeConfigured } from './stripe-client'

const AMOUNT_SCALE = 100 // Stripe takes cents

/** Fetch failure marker: `{ __error }` instead of a Stripe response. */
type ApiFail = { __error: string }
const isFail = (v: unknown): v is ApiFail => typeof v === 'object' && v !== null && '__error' in v

async function getPayment(ctx: ProviderContext, paymentId: string) {
  return ctx.tx.payment.findFirst({
    where: { id: paymentId, businessId: ctx.businessId }, // tenant-scoped read
  })
}

export const stripeProvider: PaymentProvider = {
  id: 'stripe',
  online: true,

  async createCharge(ctx, input: CreateChargeInput): Promise<ProviderResult> {
    if (input.amount <= 0) return { ok: false, payment: null as never, error: 'Amount must be positive' }
    if (!stripeConfigured()) {
      return { ok: false, payment: null as never, error: 'Stripe is not configured (missing STRIPE_SECRET_KEY)' }
    }
    // Ledger row first (PENDING → PROCESSING once the intent exists).
    const payment = await ctx.tx.payment.create({
      data: {
        businessId: ctx.businessId,
        kind: input.kind,
        method: 'CARD',
        provider: this.id,
        amount: input.amount,
        currency: input.currency ?? 'USD',
        status: 'PENDING',
        appointmentId: input.appointmentId,
        customerId: input.customerId,
        idempotencyKey: input.idempotencyKey,
        metadata: (input.metadata ?? undefined) as never,
      },
    })

    const intent = await stripeApi('/v1/payment_intents', {
      method: 'POST',
      body: {
        amount: String(Math.round(input.amount * AMOUNT_SCALE)),
        currency: (input.currency ?? 'USD').toLowerCase(),
        // Webhook is the settlement source of truth for online charges.
        'automatic_payment_methods[enabled]': 'true',
        description: `barber:${input.kind}:${input.appointmentId ?? 'no-appointment'}`,
        'metadata[businessId]': ctx.businessId,
        'metadata[paymentId]': payment.id,
        'metadata[kind]': input.kind,
      },
      idempotencyKey: input.idempotencyKey ?? `pi-create-${payment.id}`,
    }).catch((err: Error): ApiFail => ({ __error: err.message }))

    if (isFail(intent)) {
      const failed = await ctx.tx.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failureReason: intent.__error.slice(0, 280) },
      })
      return { ok: false, payment: failed, error: intent.__error }
    }

    const updated = await ctx.tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'PROCESSING',
        providerRefId: intent.id as string,
        metadata: {
          ...((input.metadata ?? {}) as Record<string, unknown>),
          clientSecret: intent.client_secret as string,
        } as never,
      },
    })
    return { ok: true, payment: updated }
  },

  async confirm(ctx, paymentId): Promise<ProviderResult> {
    // Online settlement happens client-side / at Stripe; webhook marks
    // SUCCEEDED. This only syncs state for a payment Stripe already
    // settled (e.g. retried webhook handling).
    const payment = await getPayment(ctx, paymentId)
    if (!payment) return { ok: false, payment: null as never, error: 'Payment not found' }
    if (payment.status === 'SUCCEEDED') return { ok: true, payment }
    if (!payment.providerRefId) {
      return { ok: false, payment, error: 'Payment has no Stripe reference' }
    }
    const intent = await stripeApi(`/v1/payment_intents/${encodeURIComponent(payment.providerRefId)}`, { method: 'GET' })
      .catch((err: Error): ApiFail => ({ __error: err.message }))
    if (isFail(intent)) return { ok: false, payment, error: intent.__error }
    if (intent.status !== 'succeeded') return { ok: false, payment, error: `Intent status: ${intent.status}` }
    if (!canTransition(payment.status, 'SUCCEEDED' as PaymentStatus)) {
      return { ok: false, payment, error: transitionError(payment.status, 'SUCCEEDED') }
    }
    const updated = await ctx.tx.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED' } })
    return { ok: true, payment: updated }
  },

  async refund(ctx, input: RefundInput): Promise<ProviderResult> {
    const payment = await getPayment(ctx, input.paymentId)
    if (!payment) return { ok: false, payment: null as never, error: 'Payment not found' }
    if (payment.kind === 'REFUND') return { ok: false, payment, error: 'Cannot refund a refund' }
    if (payment.status !== 'SUCCEEDED' && payment.status !== 'PARTIALLY_REFUNDED') {
      return { ok: false, payment, error: transitionError(payment.status, 'REFUNDED') }
    }
    // amount is the amount to reverse NOW (<= remaining); input.amount of
    // RefundInput is unused because the checkout layer computes it.
    const refundAmount = (input as RefundInput & { amount?: number }).amount ?? payment.amount - payment.refundedAmount
    const remaining = Math.round((payment.amount - payment.refundedAmount) * AMOUNT_SCALE) / AMOUNT_SCALE
    if (refundAmount <= 0 || refundAmount > remaining) {
      return { ok: false, payment, error: `Refund amount must be between 0 and ${remaining.toFixed(2)}` }
    }

    // Stripe refund (if the charge went through Stripe online).
    let stripeRefundId: string | undefined
    if (payment.provider === this.id && payment.providerRefId) {
      const refund = await stripeApi('/v1/refunds', {
        method: 'POST',
        body: {
          'payment_intent': payment.providerRefId,
          amount: String(Math.round(refundAmount * AMOUNT_SCALE)),
          'metadata[paymentId]': payment.id,
        },
        idempotencyKey: input.idempotencyKey ?? `refund-${payment.id}-${refundAmount}`,
      }).catch((err: Error): ApiFail => ({ __error: err.message }))
      if (isFail(refund)) return { ok: false, payment, error: refund.__error }
      if (!isFail(refund)) stripeRefundId = refund.id as string
    }

    const refundRow = await ctx.tx.payment.create({
      data: {
        businessId: ctx.businessId,
        appointmentId: payment.appointmentId,
        customerId: payment.customerId,
        barberId: payment.barberId,
        kind: 'REFUND',
        method: payment.method,
        provider: this.id,
        providerRefId: stripeRefundId,
        amount: -refundAmount,
        currency: payment.currency,
        status: 'SUCCEEDED',
        originalPaymentId: payment.id,
        idempotencyKey: input.idempotencyKey,
        metadata: { reason: input.reason ?? null, refundedVia: 'dashboard' } as never,
      },
    })

    const newRefunded = Math.round((payment.refundedAmount + refundAmount) * AMOUNT_SCALE) / AMOUNT_SCALE
    const fully = newRefunded >= payment.amount - 0.005
    if (!canTransition(payment.status, (fully ? 'REFUNDED' : 'PARTIALLY_REFUNDED') as PaymentStatus)) {
      throw new Error(transitionError(payment.status, fully ? 'REFUNDED' : 'PARTIALLY_REFUNDED'))
    }
    await ctx.tx.payment.update({
      where: { id: payment.id },
      data: { refundedAmount: newRefunded, status: fully ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
    })
    return { ok: true, payment: refundRow }
  },
}

export type { Payment, PaymentKind }

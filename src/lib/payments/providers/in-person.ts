/**
 * In-person (pay-at-shop) provider — the template's default.
 *
 * The customer pays at the shop; the ledger records the charge as
 * PENDING when the appointment is booked and a staff member marks it
 * SUCCEEDED when the money is collected. Refunds reverse a settled
 * payment. No online settlement, no webhooks, no card data — anywhere.
 */
import type {
  CreateChargeInput, PaymentProvider, PaymentStatus,
  ProviderContext, ProviderResult, RefundInput,
} from '../types'
import { canTransition, transitionError } from '../state-machine'

async function getPayment(ctx: ProviderContext, paymentId: string) {
  return ctx.tx.payment.findFirst({
    where: { id: paymentId, businessId: ctx.businessId }, // tenant-scoped read
  })
}

export const inPersonProvider: PaymentProvider = {
  id: 'in_person',
  online: false,

  async createCharge(ctx, input: CreateChargeInput): Promise<ProviderResult> {
    if (input.amount <= 0) return { ok: false, payment: null as never, error: 'Amount must be positive' }
    const payment = await ctx.tx.payment.create({
      data: {
        businessId: ctx.businessId,
        kind: input.kind,
        method: 'IN_PERSON',
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
    return { ok: true, payment }
  },

  async confirm(ctx, paymentId): Promise<ProviderResult> {
    const payment = await getPayment(ctx, paymentId)
    if (!payment) return { ok: false, payment: null as never, error: 'Payment not found' }
    if (!canTransition(payment.status, 'SUCCEEDED' as PaymentStatus)) {
      return { ok: false, payment, error: transitionError(payment.status, 'SUCCEEDED') }
    }
    const updated = await ctx.tx.payment.update({ where: { id: paymentId }, data: { status: 'SUCCEEDED' } })
    return { ok: true, payment: updated }
  },

  async refund(ctx, input: RefundInput): Promise<ProviderResult> {
    const payment = await getPayment(ctx, input.paymentId)
    if (!payment) return { ok: false, payment: null as never, error: 'Payment not found' }
    if (payment.kind === 'REFUND') return { ok: false, payment, error: 'Cannot refund a refund' }
    if (payment.status !== 'SUCCEEDED') {
      return { ok: false, payment, error: transitionError(payment.status, 'REFUNDED') }
    }
    // Refund row (kind=REFUND, negative amount) + original marked
    // REFUNDED, atomically inside the caller's transaction.
    const refund = await ctx.tx.payment.create({
      data: {
        businessId: ctx.businessId,
        appointmentId: payment.appointmentId,
        customerId: payment.customerId,
        kind: 'REFUND',
        method: payment.method,
        provider: this.id,
        amount: -payment.amount,
        currency: payment.currency,
        status: 'SUCCEEDED',
        originalPaymentId: payment.id,
        idempotencyKey: input.idempotencyKey,
        metadata: { reason: input.reason ?? null } as never,
      },
    })
    await ctx.tx.payment.update({
      where: { id: payment.id }, data: { status: 'REFUNDED' },
    })
    return { ok: true, payment: refund }
  },
}

/**
 * Payment architecture types (Requirement 23).
 *
 * The template's default behavior is pay-at-shop (IN_PERSON). This
 * interface lets a deployment add an online provider (e.g. Stripe)
 * WITHOUT rewriting booking logic: booking code only ever talks to a
 * PaymentProvider through this contract and to the Payment ledger.
 *
 * SECURITY RULES for every implementation:
 *   - never accept or store raw card numbers or CVV
 *   - all provider operations run server-side only
 *   - never expose secret keys to the browser (server env vars only)
 *   - validate webhook signatures before trusting event payloads
 *   - use idempotency keys so retries/webhooks cannot double-charge
 */
import type { Prisma, Payment, PaymentKind, PaymentStatus } from '@prisma/client'

export type { Payment, PaymentKind, PaymentStatus }

export interface ProviderContext {
  /** Tenant the payment belongs to — required on every operation. */
  businessId: string
  /** Prisma transaction (so ledger writes are atomic with the flow). */
  tx: Prisma.TransactionClient
}

export interface CreateChargeInput {
  amount: number
  currency?: string
  kind: PaymentKind
  appointmentId?: string
  customerId?: string
  /** Deduplication key (provider retries, webhook replays). */
  idempotencyKey?: string
  metadata?: Record<string, unknown>
}

export interface RefundInput {
  paymentId: string
  reason?: string
  idempotencyKey?: string
}

export interface ProviderResult {
  ok: boolean
  payment: Payment
  /** Human-readable failure reason; never include secrets or card data. */
  error?: string
}

export interface PaymentProvider {
  /** Stable provider id persisted on Payment rows, e.g. "in_person". */
  readonly id: string
  /** True if the provider settles money online (needs webhook config). */
  readonly online: boolean
  /** Record a charge intent in the ledger. */
  createCharge(ctx: ProviderContext, input: CreateChargeInput): Promise<ProviderResult>
  /** Attempt settlement of a pending/processing payment. */
  confirm(ctx: ProviderContext, paymentId: string): Promise<ProviderResult>
  /** Reverse a SUCCEEDED payment (full refund). */
  refund(ctx: ProviderContext, input: RefundInput): Promise<ProviderResult>
}

/**
 * STRIPE SUBSCRIPTIONS — recurring billing for memberships (prompt 6C).
 *
 * Server-side only. Builds on the existing raw `stripeApi` helper (no SDK
 * dependency, form-encoded REST calls with Idempotency-Key support).
 *
 * Fail-closed: every call throws unless the required Stripe credentials are configured —
 * callers surface a clear "recurring billing not configured" message and
 * NEVER simulate a subscription. A membership becomes ACTIVE only when a
 * signature-verified `invoice.paid` / first-payment webhook confirms it
 * (or POS settles the first period, the pre-existing one-time path).
 *
 * Provider object reuse: the Stripe Price id is cached on the plan row
 * (`providerPriceRef`) so renewals and later enrollments reuse one price;
 * the Stripe Customer id is cached on the membership row
 * (`providerCustomerRef`). Only provider references are stored — never
 * card data or tokens.
 */
import { missingStripeConfiguration, stripeApi, stripeConfigured } from '@/lib/payments/providers/stripe-client'
import type { MembershipPlan } from '@prisma/client'

export function subscriptionsConfigured(): boolean {
  return stripeConfigured()
}

const INTERVAL_TO_STRIPE: Record<MembershipPlan['billingInterval'], string> = {
  MONTHLY: 'month',
  QUARTERLY: 'month',
  YEARLY: 'year',
}
const INTERVAL_MONTHS: Record<MembershipPlan['billingInterval'], number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
}

/**
 * Create (or reuse) the provider Customer for this membership.
 * Cached on the membership row: the customer is per shop-customer
 * relationship (metadata carries businessId + membershipId for audit).
 */
export async function ensureStripeCustomer(opts: {
  businessId: string
  membershipId: string
  email: string
  name?: string | null
  existingRef?: string | null
}): Promise<string> {
  if (opts.existingRef) return opts.existingRef
  const customer = (await stripeApi('/v1/customers', {
    method: 'POST',
    body: {
      email: opts.email,
      ...(opts.name ? { name: opts.name } : {}),
      'metadata[businessId]': opts.businessId,
      'metadata[membershipId]': opts.membershipId,
    },
    idempotencyKey: `mb-customer:${opts.membershipId}`,
  })) as { id: string }
  return customer.id
}

/**
 * Create (or reuse) the provider Price for a plan. Cached on the plan row
 * so the price is stable across enrollments; Stripe requires a Product per
 * price, created once per plan.
 */
export async function ensureStripePrice(opts: {
  plan: Pick<MembershipPlan, 'id' | 'name' | 'price' | 'currency' | 'billingInterval'>
  existingRef?: string | null
}): Promise<string> {
  if (opts.existingRef) return opts.existingRef
  const product = (await stripeApi('/v1/products', {
    method: 'POST',
    body: {
      name: `Membership: ${opts.plan.name}`,
      'metadata[planId]': opts.plan.id,
    },
    idempotencyKey: `mb-plan-product:${opts.plan.id}`,
  })) as { id: string }

  const months = INTERVAL_MONTHS[opts.plan.billingInterval]
  const price = (await stripeApi('/v1/prices', {
    method: 'POST',
    body: {
      currency: (opts.plan.currency || 'USD').toLowerCase(),
      unit_amount: String(Math.round(opts.plan.price * 100)),
      'recurring[interval]': INTERVAL_TO_STRIPE[opts.plan.billingInterval],
      ...(months !== 1 ? { 'recurring[interval_count]': String(months) } : {}),
      product: product.id,
    },
    idempotencyKey: `mb-plan-price:${opts.plan.id}`,
  })) as { id: string }
  return price.id
}

export interface CreatedSubscription {
  subscriptionRef: string
  providerCustomerRef: string
  providerPriceRef: string
  /** Payment-intent client secret when the first charge needs card input. */
  clientSecret: string | null
  /** Stripe status, e.g. active, incomplete, past_due. */
  status: string
}

/**
 * Create the provider subscription for a PENDING membership. The membership
 * must already exist (tenant-checked) — this never creates ledger records.
 * Idempotency-Key on the Stripe call makes a retried enrollment safe.
 */
export async function createSubscriptionForMembership(opts: {
  businessId: string
  membershipId: string
  customerId: string
  email: string
  name?: string | null
  plan: Pick<MembershipPlan, 'id' | 'name' | 'price' | 'currency' | 'billingInterval'>
  existingCustomerRef?: string | null
  existingPriceRef?: string | null
}): Promise<CreatedSubscription> {
  if (!subscriptionsConfigured()) {
    throw new Error(`Recurring billing is not fully configured (missing ${missingStripeConfiguration().join(', ')})`)
  }
  const customerRef = await ensureStripeCustomer({
    businessId: opts.businessId,
    membershipId: opts.membershipId,
    email: opts.email,
    name: opts.name,
    existingRef: opts.existingCustomerRef,
  })
  const priceRef = await ensureStripePrice({ plan: opts.plan, existingRef: opts.existingPriceRef })

  const subscription = (await stripeApi('/v1/subscriptions', {
    method: 'POST',
    body: {
      customer: customerRef,
      'items[0][price]': priceRef,
      'metadata[businessId]': opts.businessId,
      'metadata[membershipId]': opts.membershipId,
      'metadata[customerId]': opts.customerId,
      'payment_behavior': 'allow_incomplete',
      'collection_method': 'charge_automatically',
      'expand[0]': 'latest_invoice.payment_intent',
    },
    idempotencyKey: `mb-subscription:${opts.membershipId}`,
  })) as {
    id: string
    status: string
    latest_invoice?: { payment_intent?: { client_secret?: string } | null } | null
  }

  return {
    subscriptionRef: subscription.id,
    providerCustomerRef: customerRef,
    providerPriceRef: priceRef,
    clientSecret: subscription.latest_invoice?.payment_intent?.client_secret ?? null,
    status: subscription.status,
  }
}

/**
 * Provider-side IMMEDIATE cancellation. Stripe's DELETE endpoint always
 * cancels at once; period-end cancellation uses the UPDATE endpoint
 * (scheduleSubscriptionCancelAtPeriodEnd).
 */
export async function cancelSubscription(subscriptionRef: string): Promise<void> {
  if (!subscriptionsConfigured()) {
    throw new Error(`Recurring billing is not fully configured (missing ${missingStripeConfiguration().join(', ')})`)
  }
  await stripeApi(`/v1/subscriptions/${encodeURIComponent(subscriptionRef)}`, {
    method: 'DELETE',
    idempotencyKey: `mb-cancel-now:${subscriptionRef}`,
  })
}

/** Period-end cancellation (autoRenew = false) via the UPDATE endpoint. */
export async function scheduleSubscriptionCancelAtPeriodEnd(subscriptionRef: string): Promise<void> {
  if (!subscriptionsConfigured()) {
    throw new Error(`Recurring billing is not fully configured (missing ${missingStripeConfiguration().join(', ')})`)
  }
  await stripeApi(`/v1/subscriptions/${encodeURIComponent(subscriptionRef)}`, {
    method: 'POST',
    body: { cancel_at_period_end: 'true' },
    idempotencyKey: `mb-cancel-eop:${subscriptionRef}`,
  })
}

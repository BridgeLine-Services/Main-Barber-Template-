/**
 * Payment provider registry (Requirement 23).
 *
 * Resolves the PaymentProvider for a business. The template ships
 * pay-at-shop (in_person) by default. The Stripe provider registers
 * only when all required Stripe credentials are configured — a shop with online
 * payments requested but no key fails closed (pay-at-shop), never
 * invents a provider. Booking logic never changes: see docs/PAYMENTS.md.
 */
import type { PaymentProvider } from './types'
import { inPersonProvider } from './providers/in-person'
import { stripeProvider } from './providers/stripe'
import { missingStripeConfiguration, stripeConfigured } from './providers/stripe-client'

export * from './types'
export * from './state-machine'
export { inPersonProvider, stripeProvider, stripeConfigured }

const REGISTRY: Record<string, PaymentProvider> = {
  [inPersonProvider.id]: inPersonProvider,
  [stripeProvider.id]: stripeProvider,
}

/**
 * Resolve the provider for a business based on its payment configuration.
 * `paymentInPerson === false` requires a registered ONLINE provider that
 * is actually configured — otherwise we fail closed rather than invent
 * a provider.
 */
export function resolvePaymentProvider(opts: { paymentInPerson: boolean }): PaymentProvider {
  if (opts.paymentInPerson) return inPersonProvider
  if (stripeConfigured()) return stripeProvider
  const missing = missingStripeConfiguration()
  throw new Error(
    `Business has online payments enabled but Stripe is not fully configured. Missing: ${missing.join(', ')} (see docs/PAYMENTS.md).`,
  )
}

export function getPaymentProvider(providerId: string): PaymentProvider | undefined {
  return REGISTRY[providerId]
}

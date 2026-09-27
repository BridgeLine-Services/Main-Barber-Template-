/**
 * Payment provider registry (Requirement 23).
 *
 * Resolves the PaymentProvider for a business. Today the template ships
 * exactly one provider: pay-at-shop (in_person), matching
 * Business.paymentInPerson. When a deployment adds an online provider
 * (Stripe etc.), register it here and extend the business-level
 * payment configuration — booking logic does not change.
 * See docs/PAYMENTS.md for the integration contract.
 */
import type { PaymentProvider } from './types'
import { inPersonProvider } from './providers/in-person'

export * from './types'
export * from './state-machine'
export { inPersonProvider }

const REGISTRY: Record<string, PaymentProvider> = {
  [inPersonProvider.id]: inPersonProvider,
}

/**
 * Resolve the provider for a business based on its payment configuration.
 * `paymentInPerson === false` without a registered online provider is a
 * configuration error: we fail closed rather than inventing a provider.
 */
export function resolvePaymentProvider(opts: { paymentInPerson: boolean }): PaymentProvider {
  if (opts.paymentInPerson) return inPersonProvider
  throw new Error(
    'Business has online payments enabled but no payment provider is configured. ' +
    'Register the provider in src/lib/payments/index.ts (see docs/PAYMENTS.md).'
  )
}

export function getPaymentProvider(providerId: string): PaymentProvider | undefined {
  return REGISTRY[providerId]
}

export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { resolveBusiness } from '@/lib/tenant'
import { isStorefrontUsable } from '@/lib/ecommerce'
import { resolvePaymentProvider } from '@/lib/payments'
import { stripeConfigured } from '@/lib/payments/providers/stripe-client'
import { Section } from '@/components/customer/Section'
import { CheckoutClient } from './CheckoutClient'

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Checkout' }
}

export default async function CheckoutPage() {
  const business = await resolveBusiness().catch(() => null)
  const usable = business ? await isStorefrontUsable(business.id).catch(() => false) : false

  // Online payment requires the shop's online provider AND Stripe keys —
  // same gate as gift cards. Fail closed: without it the order is still
  // created and the customer is told the shop will settle it in store.
  let onlineAvailable = false
  if (usable && business) {
    try {
      const provider = resolvePaymentProvider({ paymentInPerson: business.paymentInPerson ?? true })
      onlineAvailable = Boolean(provider?.online && provider.id === 'stripe' && stripeConfigured())
    } catch {
      onlineAvailable = false
    }
  }

  return (
    <Section className="pt-12 lg:pt-20 pb-24">
      <CheckoutClient
        slug={business?.slug ?? ''}
        shopName={business?.name ?? 'the shop'}
        enabled={usable}
        publishableKey={onlineAvailable ? process.env.STRIPE_PUBLISHABLE_KEY ?? '' : ''}
      />
    </Section>
  )
}

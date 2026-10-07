export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { generatePageMetadata } from '@/lib/generate-page-metadata'
import { resolveBusiness } from '@/lib/tenant'
import { getGiftCardSettings, giftCardDenominations } from '@/lib/gift-cards'
import { resolvePaymentProvider } from '@/lib/payments'
import { stripeConfigured } from '@/lib/payments/providers/stripe-client'
import { GiftCardPurchaseForm } from './GiftCardPurchaseForm'
import { Section, SectionHeading } from '@/components/customer/Section'
import { Reveal } from '@/components/motion/reveal'
import { Gift, MapPin, Phone } from 'lucide-react'
import { Card } from '@/components/ui/card'

export async function generateMetadata(): Promise<Metadata> {
  return generatePageMetadata({
    titleSuffix: 'Gift Cards',
    description: 'Buy a digital gift card for friends and family — redeemable for any service.',
    path: '/gift-cards',
  })
}

export default async function GiftCardsPage() {
  const business = await resolveBusiness().catch(() => null)
  const shopName = business?.name || 'Barber Shop'

  const settings = business ? await getGiftCardSettings(business.id) : null
  const enabled = Boolean(settings?.enabled)

  // Online purchase needs the shop's online provider AND Stripe keys.
  let onlineAvailable = false
  if (enabled && business) {
    try {
      const provider = resolvePaymentProvider({ paymentInPerson: business.paymentInPerson ?? true })
      onlineAvailable = Boolean(provider?.online && provider.id === 'stripe' && stripeConfigured())
    } catch {
      onlineAvailable = false
    }
  }
  const publishableKey = onlineAvailable ? process.env.STRIPE_PUBLISHABLE_KEY ?? '' : ''

  const phone = business?.phone || null
  const fullAddress = [business?.address, business?.city, business?.state, business?.zipCode]
    .filter(Boolean)
    .join(', ') || null

  return (
    <Section className="pt-12 lg:pt-20 pb-24">
      <SectionHeading
        eyebrow="Gift Cards"
        title={`Give the Gift of a Fresh Cut`}
        description={`Treat someone to ${shopName}. Digital gift cards are delivered instantly and work like cash for any service.`}
      />

      <Reveal className="mt-10">
        {!enabled ? (
          <Card className="mx-auto max-w-xl p-8 text-center">
            <Gift className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold">Gift cards are coming soon</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {shopName} isn&apos;t selling gift cards right now. Check back later or give us a call.
            </p>
            {phone && (
              <a
                href={`tel:${phone.replace(/\D/g, '')}`}
                className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:brightness-125"
              >
                <Phone className="h-4 w-4" aria-hidden /> {phone}
              </a>
            )}
          </Card>
        ) : onlineAvailable ? (
          <div className="mx-auto max-w-2xl">
            <GiftCardPurchaseForm
              shopName={shopName}
              denominations={giftCardDenominations(settings!)}
              publishableKey={publishableKey}
            />
          </div>
        ) : (
          <Card className="mx-auto max-w-xl p-8 text-center">
            <MapPin className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold">Available in-store</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {shopName} gift cards are sold right at the shop — pick one up on your next visit.
            </p>
            {fullAddress && (
              <p className="mt-4 text-sm text-muted-foreground">{fullAddress}</p>
            )}
            {phone && (
              <a
                href={`tel:${phone.replace(/\D/g, '')}`}
                className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:brightness-125"
              >
                <Phone className="h-4 w-4" aria-hidden /> {phone}
              </a>
            )}
          </Card>
        )}
      </Reveal>
    </Section>
  )
}

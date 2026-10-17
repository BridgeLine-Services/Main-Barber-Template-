export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { resolveBusiness } from '@/lib/tenant'
import { isStorefrontUsable } from '@/lib/ecommerce'
import { Section } from '@/components/customer/Section'
import { CartClient } from './CartClient'

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Cart' }
}

export default async function CartPage() {
  const business = await resolveBusiness().catch(() => null)
  const usable = business ? await isStorefrontUsable(business.id).catch(() => false) : false

  return (
    <Section className="pt-12 lg:pt-20 pb-24">
      <CartClient slug={business?.slug ?? ''} enabled={usable} />
    </Section>
  )
}

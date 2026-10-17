export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { generatePageMetadata } from '@/lib/generate-page-metadata'
import { resolveBusiness } from '@/lib/tenant'
import { isStorefrontUsable, listPublicProducts } from '@/lib/ecommerce'
import { Section, SectionHeading } from '@/components/customer/Section'
import { ShopClient } from './ShopClient'

export async function generateMetadata(): Promise<Metadata> {
  return generatePageMetadata({
    titleSuffix: 'Shop',
    description: 'Shop products from our online store — reserve online, pay securely.',
    path: '/shop',
  })
}

export default async function ShopPage() {
  const business = await resolveBusiness().catch(() => null)

  if (!business || !(await isStorefrontUsable(business.id).catch(() => false))) {
    return (
      <Section className="pt-12 lg:pt-20 pb-24">
        <SectionHeading
          eyebrow="Shop"
          title="Online shop coming soon"
          description="This shop's online store is not available right now. Check back soon or give us a call."
        />
      </Section>
    )
  }

  const products = await listPublicProducts(business.id)
  return (
    <ShopClient
      slug={business.slug}
      shopName={business.name}
      products={products}
    />
  )
}

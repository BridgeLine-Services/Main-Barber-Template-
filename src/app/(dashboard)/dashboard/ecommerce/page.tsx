import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getEcommerceSettings } from '@/lib/ecommerce'
import { isFeatureEnabledForBusiness } from '@/lib/features'
import { ProductsClient } from './ProductsClient'

/**
 * Owner-managed Ecommerce dashboard: storefront master switch + tax/shipping
 * settings, product catalog CRUD (create/edit/publish/unpublish/stock), and a
 * shortcut to order management. All mutations go through the session-scoped,
 * tenant-checked /api/dashboard/ecommerce/* routes.
 */
export default async function EcommercePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const user = session.user
  if (!user.businessId || (user.role !== 'OWNER' && user.role !== 'PLATFORM_OWNER' && user.role !== 'BUSINESS_ADMIN')) {
    redirect('/dashboard')
  }

  const [products, settings, featureEnabled] = await Promise.all([
    prisma.product.findMany({
      where: { businessId: user.businessId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    getEcommerceSettings(user.businessId),
    isFeatureEnabledForBusiness(user.businessId, 'ecommerce').catch(() => false),
  ])

  return (
    <ProductsClient
      initialProducts={products.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        category: p.category,
        productType: p.productType,
        price: p.price,
        compareAtPrice: p.compareAtPrice,
        images: p.images,
        published: p.published,
        stock: p.stock,
        lowStockThreshold: p.lowStockThreshold,
        sku: p.sku,
        sortOrder: p.sortOrder,
      }))}
      initialSettings={{
        enabled: settings.enabled,
        currency: settings.currency,
        taxRatePercent: settings.taxRatePercent,
        shippingFlatRate: settings.shippingFlatRate,
        freeShippingThreshold: settings.freeShippingThreshold,
        supportEmail: settings.supportEmail,
      }}
      featureEnabled={featureEnabled}
    />
  )
}

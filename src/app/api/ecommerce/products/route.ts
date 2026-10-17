/**
 * Public storefront: published products (guest, no account).
 * GET /api/ecommerce/products?slug=<businessSlug>
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { isStorefrontUsable, listPublicProducts } from '@/lib/ecommerce'

export async function GET(request: Request) {
  try {
    const slug = new URL(request.url).searchParams.get('slug')
    if (!slug) return NextResponse.json({ error: 'Missing shop slug' }, { status: 400 })
    const business = await prisma.business.findUnique({ where: { slug }, select: { id: true } })
    if (!business) return NextResponse.json({ error: 'Shop not found' }, { status: 404 })
    if (!(await isStorefrontUsable(business.id))) {
      return NextResponse.json({ enabled: false, products: [] }, { status: 200 })
    }
    return NextResponse.json({ enabled: true, products: await listPublicProducts(business.id) })
  } catch (error) {
    return handleApiError(error, 'GET /api/ecommerce/products')
  }
}

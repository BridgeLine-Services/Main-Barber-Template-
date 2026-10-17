/**
 * Dashboard ecommerce: product catalog CRUD (owner-managed).
 *   GET    /api/dashboard/ecommerce/products — list (all, incl. unpublished)
 *   POST   /api/dashboard/ecommerce/products — owner create
 *   PATCH  /api/dashboard/ecommerce/products — owner update { id, ... }
 *   DELETE /api/dashboard/ecommerce/products?id= — owner unpublish (soft)
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { can } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const productSchema = z.object({
  name: z.string().trim().min(2).max(200),
  slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and hyphens only'),
  description: z.string().trim().max(5000).nullable().optional(),
  category: z.string().trim().max(100).nullable().optional(),
  productType: z.enum(['PHYSICAL', 'DIGITAL']).default('PHYSICAL'),
  price: z.number().positive().max(100000),
  compareAtPrice: z.number().positive().max(100000).nullable().optional(),
  images: z.array(z.string().trim().max(500)).max(10).default([]),
  published: z.boolean().default(false),
  digitalAssetUrl: z.string().trim().max(1000).nullable().optional(),
  stock: z.number().int().min(-1).max(1000000).default(0),
  lowStockThreshold: z.number().int().min(0).max(100000).default(5),
  sku: z.string().trim().max(100).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).default(0),
})

type SessionUser = { role: string; businessId?: string | null }

async function sessionUser(): Promise<SessionUser | null> {
  const session = (await getServerSession(authOptions)) as { user?: SessionUser } | null
  const user = session?.user
  if (!user?.businessId) return null
  return user
}

export async function GET() {
  try {
    const user = await sessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const products = await prisma.product.findMany({
      where: { businessId: user.businessId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    return NextResponse.json({ products })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/ecommerce/products')
  }
}

export async function POST(request: Request) {
  try {
    const user = await sessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!can(user.role, 'business.manage-settings')) {
      return NextResponse.json({ error: 'Only owners can manage products' }, { status: 403 })
    }
    const parsed = productSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
    }
    try {
      const product = await prisma.product.create({ data: { businessId: user.businessId, ...parsed.data } })
      return NextResponse.json({ success: true, product }, { status: 201 })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        return NextResponse.json({ error: 'A product with this slug already exists' }, { status: 409 })
      }
      throw e
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/ecommerce/products')
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await sessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!can(user.role, 'business.manage-settings')) {
      return NextResponse.json({ error: 'Only owners can manage products' }, { status: 403 })
    }
    const body = (await request.json().catch(() => null)) as (Partial<z.infer<typeof productSchema>> & { id: string }) | null
    if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const { id, ...patch } = body
    const parsed = productSchema.partial().safeParse(patch)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
    }
    // Tenant scope: businessId in the WHERE — foreign ids are a 404.
    const result = await prisma.product.updateMany({
      where: { id, businessId: user.businessId },
      data: parsed.data,
    })
    if (result.count === 0) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/ecommerce/products')
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await sessionUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!can(user.role, 'business.manage-settings')) {
      return NextResponse.json({ error: 'Only owners can manage products' }, { status: 403 })
    }
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Product id required' }, { status: 400 })
    // Unpublish rather than delete: order history keeps its snapshots and
    // the product can be restored by the owner.
    const result = await prisma.product.updateMany({
      where: { id, businessId: user.businessId },
      data: { published: false },
    })
    if (result.count === 0) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/ecommerce/products')
  }
}

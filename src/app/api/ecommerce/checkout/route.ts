/**
 * Public storefront checkout: create a PENDING order (guest-friendly).
 * POST /api/ecommerce/checkout?slug=<businessSlug>
 *
 * Body: { lines: [{productId, quantity}], email, name?, address?, idempotencyKey? }
 * All prices/totals are computed server-side. The order is NOT paid here —
 * payment is created and settled through the provider (webhook) or POS.
 * A PaymentIntent for the order total is created when Stripe is configured;
 * the returned client secret drives the confirmation on the client.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { StorefrontError, createOrder } from '@/lib/ecommerce'
import { z } from 'zod'

const addressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(1).max(20),
  country: z.string().trim().min(2).max(2),
})

const checkoutSchema = z.object({
  lines: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(100) })).min(1),
  email: z.string().trim().email(),
  name: z.string().trim().max(200).optional(),
  address: addressSchema.nullable().optional(),
  idempotencyKey: z.string().trim().max(200).optional(),
})

export async function POST(request: Request) {
  try {
    const slug = new URL(request.url).searchParams.get('slug')
    if (!slug) return NextResponse.json({ error: 'Missing shop slug' }, { status: 400 })
    const business = await prisma.business.findUnique({ where: { slug }, select: { id: true } })
    if (!business) return NextResponse.json({ error: 'Shop not found' }, { status: 404 })

    const parsed = checkoutSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid checkout', details: parsed.error.flatten() }, { status: 400 })
    }

    const order = await createOrder({
      businessId: business.id,
      lines: parsed.data.lines,
      shipping: { email: parsed.data.email, name: parsed.data.name, address: parsed.data.address ?? null },
      idempotencyKey: parsed.data.idempotencyKey,
    })

    // Online payment: create a PENDING payment row through the shop's
    // configured ONLINE provider (Stripe) when available — mirroring the
    // gift-card purchase route. Fail closed otherwise: the order simply
    // waits for POS checkout; nothing is simulated.
    let clientSecret: string | null = null
    let onlinePaymentEnabled = false
    const fullBusiness = await prisma.business.findUnique({
      where: { id: business.id },
      select: { paymentInPerson: true },
    })
    let provider: ReturnType<typeof import('@/lib/payments').resolvePaymentProvider> | undefined
    try {
      const mod = await import('@/lib/payments')
      const resolved = mod.resolvePaymentProvider({ paymentInPerson: fullBusiness?.paymentInPerson ?? true })
      provider = resolved?.online ? resolved : undefined
    } catch {
      provider = undefined
    }
    if (provider) {
      const charge = await provider.createCharge(
        { businessId: business.id, tx: prisma },
        {
          amount: order.total,
          kind: 'CHARGE',
          idempotencyKey: `order:${order.id}`,
          metadata: { orderId: order.id, shopOrder: true },
        },
      )
      if (charge.ok) {
        clientSecret = (charge.payment.metadata as Record<string, unknown> | null)?.clientSecret as string | undefined ?? null
        onlinePaymentEnabled = true
      }
    }

    return NextResponse.json(
      {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        total: order.total,
        currency: order.currency,
        clientSecret,
        onlinePaymentEnabled,
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof StorefrontError) {
      const status = error.code === 'STOREFRONT_DISABLED' ? 503
        : error.code === 'OUT_OF_STOCK' || error.code === 'PRODUCT_UNAVAILABLE' || error.code.startsWith('INVALID') || error.code === 'EMPTY_CART' ? 409 : 400
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    return handleApiError(error, 'POST /api/ecommerce/checkout')
  }
}

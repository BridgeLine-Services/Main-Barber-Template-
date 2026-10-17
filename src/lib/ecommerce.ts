/**
 * ECOMMERCE — optional product storefront (see docs/ECOMMERCE.md).
 *
 * Invariants (enforced here, not in the UI):
 *   1. Fail-closed: feature flag 'ecommerce' AND EcommerceSettings.enabled.
 *   2. Server-side price verification: cart lines are matched to DB products
 *      by id; unit prices are snapshotted from the DATABASE, never from the
 *      request body. Totals are recomputed server-side.
 *   3. Inventory is race-safe: stock is decremented with a single atomic
 *      conditional UPDATE (`stock >= qty`), so concurrent checkouts cannot
 *      oversell. Cancellation/restock increments back inside a transaction.
 *   4. An order is PAID only when its payment settles (Stripe webhook or POS
 *      confirmation). Duplicate webhooks cannot double-process: the
 *      payment->order link is `@unique` and status transitions are guarded.
 *   5. Tenant scope: every query filters by businessId; products from
 *      another business are rejected at order creation.
 *   6. No raw card data ever touches the app — only provider references.
 *
 * Guest checkout is supported (customerId nullable, email required) so the
 * public booking promise — no account needed — is preserved.
 */
import { prisma } from '@/lib/prisma'
import type { Prisma, ShopOrder } from '@prisma/client'
import { isFeatureEnabledForBusiness } from '@/lib/features'

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getEcommerceSettings(businessId: string) {
  let settings = await prisma.ecommerceSettings.findUnique({ where: { businessId } })
  if (!settings) {
    settings = await prisma.ecommerceSettings.create({ data: { businessId } })
  }
  return settings
}

export async function isStorefrontUsable(businessId: string): Promise<boolean> {
  if (!(await isFeatureEnabledForBusiness(businessId, 'ecommerce'))) return false
  return (await getEcommerceSettings(businessId)).enabled
}

export class StorefrontError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'StorefrontError'
  }
}

// ─── Catalog ──────────────────────────────────────────────────────────────────

export interface PublicProduct {
  id: string
  name: string
  slug: string
  description: string | null
  category: string | null
  productType: 'PHYSICAL' | 'DIGITAL'
  price: number
  compareAtPrice: number | null
  images: string[]
  inStock: boolean // false when stock is tracked and 0
}

export async function listPublicProducts(businessId: string): Promise<PublicProduct[]> {
  const products = await prisma.product.findMany({
    where: { businessId, published: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    category: p.category,
    productType: p.productType,
    price: p.price,
    compareAtPrice: p.compareAtPrice,
    images: p.images,
    inStock: p.stock === -1 || p.stock > 0,
  }))
}

// ─── Cart → Order (server-side verification) ──────────────────────────────────

export interface CartLine {
  productId: string
  quantity: number
}

export interface ShippingInfo {
  email: string
  name?: string
  address?: {
    line1: string
    line2?: string
    city: string
    state: string
    postalCode: string
    country: string
  } | null
}

export interface CreateOrderInput {
  businessId: string
  lines: CartLine[]
  shipping: ShippingInfo
  customerId?: string | null
  idempotencyKey?: string
  paymentMethod?: 'CARD' | 'IN_PERSON' // POS path is dashboard-only
}

export type OrderWithItems = ShopOrder & {
  items: { id: string; productId: string; name: string; unitPrice: number; quantity: number; lineTotal: number }[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Create a PENDING order from a cart. Prices/totals are computed from the
 * database. Stock is reserved atomically. An idempotency key dedupes
 * double-clicks and webhook retries. Payment links via metadata.orderId and
 * is activated only when the provider settles it.
 */
export async function createOrder(input: CreateOrderInput): Promise<OrderWithItems> {
  const { businessId, lines, shipping } = input
  if (!(await isStorefrontUsable(businessId))) {
    throw new StorefrontError('storefront is disabled', 'STOREFRONT_DISABLED')
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new StorefrontError('cart is empty', 'EMPTY_CART')
  }
  if (!EMAIL_RE.test(shipping.email || '')) {
    throw new StorefrontError('a valid email is required', 'INVALID_EMAIL')
  }
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100) {
      throw new StorefrontError('invalid quantity', 'INVALID_QUANTITY')
    }
  }

  // Idempotent re-submission: return the original order unchanged.
  if (input.idempotencyKey) {
    const existing = await prisma.shopOrder.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { items: true },
    })
    if (existing) {
      if (existing.businessId !== businessId) {
        // Same key across tenants is a bug/abuse — never leak the other order.
        throw new StorefrontError('invalid checkout', 'IDEMPOTENCY_CONFLICT')
      }
      return existing
    }
  }

  const settings = await getEcommerceSettings(businessId)
  const needsShipping = await orderNeedsShipping(businessId, lines)

  return prisma.$transaction(async (tx) => {
    // 1. Verify every product against THIS business and reserve stock
    //    atomically (conditional decrement = no oversell under concurrency).
    const verified: { productId: string; name: string; unitPrice: number; quantity: number }[] = []
    for (const line of lines) {
      const product = await tx.product.findFirst({
        where: { id: line.productId, businessId, published: true },
      })
      if (!product) {
        throw new StorefrontError(`product ${line.productId} is not available`, 'PRODUCT_UNAVAILABLE')
      }
      if (product.productType === 'PHYSICAL' && product.stock !== -1) {
        const reserved = await tx.product.updateMany({
          where: { id: product.id, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        })
        if (reserved.count === 0) {
          throw new StorefrontError(`${product.name} is out of stock`, 'OUT_OF_STOCK')
        }
      } else if (product.productType === 'DIGITAL' && product.stock !== -1) {
        const reserved = await tx.product.updateMany({
          where: { id: product.id, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        })
        if (reserved.count === 0) {
          throw new StorefrontError(`${product.name} is out of stock`, 'OUT_OF_STOCK')
        }
      }
      verified.push({
        productId: product.id,
        name: product.name,
        unitPrice: product.price, // DATABASE price — client price is never read
        quantity: line.quantity,
      })
    }

    // 2. Totals — recomputed server-side.
    const subtotal = round2(verified.reduce((sum, v) => sum + v.unitPrice * v.quantity, 0))
    let shippingAmount = 0
    if (needsShipping) {
      const freeThreshold = settings.freeShippingThreshold
      shippingAmount = freeThreshold != null && subtotal >= freeThreshold ? 0 : settings.shippingFlatRate
    }
    const taxAmount = round2((subtotal * settings.taxRatePercent) / 100)
    const total = round2(subtotal + shippingAmount + taxAmount)

    if (total <= 0) {
      throw new StorefrontError('order total must be positive (check product prices)', 'INVALID_TOTAL')
    }

    // 3. Order + snapshot items.
    const order = await tx.shopOrder.create({
      data: {
        businessId,
        orderNumber: `ORD-${randomToken().toUpperCase()}`,
        customerId: input.customerId ?? null,
        email: shipping.email.trim().toLowerCase(),
        shippingAddress: (needsShipping ? shipping.address ?? null : null) as Prisma.InputJsonValue | null,
        subtotal,
        shippingAmount,
        taxAmount,
        total,
        currency: settings.currency,
        status: 'PENDING',
        idempotencyKey: input.idempotencyKey ?? null,
      },
    })
    const items: { id: string; productId: string; name: string; unitPrice: number; quantity: number; lineTotal: number }[] = []
    for (const v of verified) {
      const item = await tx.orderItem.create({
        data: {
          orderId: order.id,
          productId: v.productId,
          name: v.name,
          unitPrice: v.unitPrice,
          quantity: v.quantity,
          lineTotal: round2(v.unitPrice * v.quantity),
        },
      })
      items.push({ id: item.id, productId: v.productId, name: v.name, unitPrice: v.unitPrice, quantity: v.quantity, lineTotal: item.lineTotal })
    }
    return { ...order, items }
  })
}

async function orderNeedsShipping(businessId: string, lines: CartLine[]): Promise<boolean> {
  const digitalOnly = await prisma.product.findFirst({
    where: { businessId, id: { in: lines.map((l) => l.productId) }, productType: 'PHYSICAL' },
    select: { id: true },
  })
  return !!digitalOnly
}

// ─── Payment confirmation ─────────────────────────────────────────────────────

/**
 * Mark an order PAID when its payment settles (POS or Stripe webhook).
 * Idempotent: a second call for the same payment is a no-op. Cross-checks
 * that the payment belongs to the same business as the order.
 */
export async function markOrderPaidForPayment(paymentId: string): Promise<boolean> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment || payment.status !== 'SUCCEEDED') return false
  const orderId = (payment.metadata as Record<string, unknown> | null)?.orderId as string | undefined
  if (!orderId) return false
  const order = await prisma.shopOrder.findFirst({ where: { id: orderId, businessId: payment.businessId } })
  if (!order || order.status !== 'PENDING') return false

  await prisma.$transaction([
    prisma.shopOrder.update({ where: { id: order.id }, data: { status: 'PAID', paymentId } }),
  ])
  return true
}

/** Payment failure / provider cancellation: release reserved stock. */
export async function markOrderPaymentFailed(paymentId: string): Promise<boolean> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
  if (!payment) return false
  const orderId = (payment.metadata as Record<string, unknown> | null)?.orderId as string | undefined
  if (!orderId) return false
  const order = await prisma.shopOrder.findFirst({ where: { id: orderId, businessId: payment.businessId } })
  if (!order || order.status !== 'PENDING') return false
  await prisma.$transaction(async (tx) => {
    await tx.shopOrder.update({ where: { id: order.id }, data: { status: 'PAYMENT_FAILED' } })
    await restockItems(tx, order.id)
  })
  return true
}

// ─── Cancellation / refund ─────────────────────────────────────────────────────

/**
 * Cancel an unpaid/pending order and release reserved stock. Refunds of PAID
 * orders go through the existing Payment refund flow; the stock decision is
 * the owner's (restock argument).
 */
export async function cancelOrder(businessId: string, orderId: string, restock = true): Promise<ShopOrder> {
  const order = await prisma.shopOrder.findFirst({ where: { id: orderId, businessId } })
  if (!order) throw new StorefrontError('order not found', 'NOT_FOUND')
  if (order.status !== 'PENDING' && order.status !== 'PAYMENT_FAILED') {
    throw new StorefrontError(`cannot cancel an order in status ${order.status}`, 'BAD_STATE')
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.shopOrder.update({
      where: { id: order.id },
      data: { status: 'CANCELED' },
    })
    if (restock) await restockItems(tx, order.id)
    return updated
  })
}

async function restockItems(tx: Prisma.TransactionClient, orderId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId } })
  for (const item of items) {
    await tx.product.updateMany({
      where: { id: item.productId },
      data: { stock: { increment: item.quantity } },
    })
  }
}

/** Owner moves a PAID order through fulfillment. */
const FULFILLMENT_FLOW: Record<string, string[]> = {
  PAID: ['PROCESSING', 'SHIPPED', 'DELIVERED'],
  PROCESSING: ['SHIPPED', 'DELIVERED'],
  SHIPPED: ['DELIVERED'],
}

export async function advanceFulfillment(
  businessId: string,
  orderId: string,
  next: 'PROCESSING' | 'SHIPPED' | 'DELIVERED',
  trackingNumber?: string
): Promise<ShopOrder> {
  const order = await prisma.shopOrder.findFirst({ where: { id: orderId, businessId } })
  if (!order) throw new StorefrontError('order not found', 'NOT_FOUND')
  const allowed = FULFILLMENT_FLOW[order.status]
  if (!allowed || !allowed.includes(next)) {
    throw new StorefrontError(`cannot move ${order.status} order to ${next}`, 'BAD_TRANSITION')
  }
  return prisma.shopOrder.update({
    where: { id: order.id },
    data: { status: next, ...(trackingNumber ? { trackingNumber } : {}) },
  })
}

// ─── Views ────────────────────────────────────────────────────────────────────

export async function listOrders(businessId: string, opts: { status?: ShopOrder['status']; take?: number } = {}) {
  return prisma.shopOrder.findMany({
    where: { businessId, ...(opts.status ? { status: opts.status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: opts.take ?? 100,
    include: { items: true },
  })
}

export async function orderStats(businessId: string) {
  const byStatus = await prisma.shopOrder.groupBy({
    by: ['status'],
    where: { businessId },
    _count: { _all: true },
    _sum: { total: true },
  })
  return byStatus.map((g) => ({ status: g.status, count: g._count._all, revenue: g._sum.total ?? 0 }))
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function randomToken(len = 8): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

/** Metadata for the order's payment row (mirrors gift cards / memberships). */
export function orderPaymentMetadata(orderId: string): Prisma.InputJsonValue {
  return { orderId, shopOrder: true }
}

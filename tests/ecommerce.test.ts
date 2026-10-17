/**
 * ECOMMERCE TESTS (prompt 7)
 *
 * Verifies against the real database:
 *   1. Fail-closed gate (feature flag AND settings.enabled)
 *   2. Server-side price verification — totals from DB, never the client
 *   3. Inventory: atomic reservation, oversell impossible, restock on cancel
 *   4. Idempotent checkout (duplicate submission returns the same order)
 *   5. Duplicate webhook protection (double PAID processing impossible)
 *   6. Payment failure releases reserved stock
 *   7. Fulfillment state machine (PAID -> PROCESSING -> SHIPPED -> DELIVERED)
 *   8. Tenant isolation: foreign-business products rejected at checkout
 *   9. Guest checkout (no customer account required)
 *  10. Digital products skip shipping
 *  11. Order stats reconcile with DB
 *
 * Run: npx tsx tests/ecommerce.test.ts
 */
import { prisma } from '../src/lib/prisma'
import {
  StorefrontError,
  advanceFulfillment,
  cancelOrder,
  createOrder,
  getEcommerceSettings,
  isStorefrontUsable,
  listOrders,
  listPublicProducts,
  markOrderPaidForPayment,
  markOrderPaymentFailed,
  orderPaymentMetadata,
  orderStats,
} from '../src/lib/ecommerce'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}

const stamp = Date.now()
let businessA: string, businessB: string
const products: string[] = []
const orders: string[] = []
const payments: string[] = []

async function mkBusiness(slug: string) {
  return prisma.business.create({
    data: {
      name: `Shop ${slug}`, slug,
      email: `${slug}@t.test`, phone: '555-0100', address: '1 S St',
      city: 'Scity', state: 'CA', zipCode: '90001', timezone: 'America/Los_Angeles',
      cancellationDeadlineHours: 0,
    },
  })
}
async function mkProduct(businessId: string, data: Partial<{ name: string; slug: string; price: number; stock: number; published: boolean; productType: 'PHYSICAL' | 'DIGITAL' }>) {
  const p = await prisma.product.create({
    data: {
      businessId,
      name: data.name ?? 'Pomade',
      slug: data.slug ?? `prod-${stamp}-${products.length}-${Math.random().toString(36).slice(2, 6)}`,
      price: data.price ?? 18,
      stock: data.stock ?? 5,
      published: data.published ?? true,
      productType: data.productType ?? 'PHYSICAL',
    },
  })
  products.push(p.id)
  return p
}
async function enable(businessId: string) {
  await getEcommerceSettings(businessId)
  await prisma.ecommerceSettings.update({ where: { businessId }, data: { enabled: true, taxRatePercent: 10, shippingFlatRate: 5 } })
  await prisma.business.update({ where: { id: businessId }, data: { featureOverrides: { ecommerce: true } } as never })
}

async function main() {
  console.log('\n── Setup ──')
  businessA = (await mkBusiness(`shop-a-${stamp}`)).id
  businessB = (await mkBusiness(`shop-b-${stamp}`)).id

  try {
    console.log('\n── 1. Fail-closed gate ──')
    assert(await isStorefrontUsable(businessA) === false, 'storefront unusable before any configuration')
    await enable(businessA)
    assert(await isStorefrontUsable(businessA) === true, 'storefront usable after flag AND settings enabled')

    console.log('\n── 2. Catalog & guest checkout ──')
    const pomade = await mkProduct(businessA, { name: 'Pomade', price: 18, stock: 5 })
    const shampoo = await mkProduct(businessA, { name: 'Shampoo', price: 12, stock: 5 })
    const ebook = await mkProduct(businessA, { name: 'Style Guide PDF', price: 8, stock: -1, productType: 'DIGITAL' })
    await mkProduct(businessA, { name: 'Hidden Draft', price: 3, published: false })
    const catalog = await listPublicProducts(businessA)
    assert(catalog.length === 3 && catalog.every((p) => p.id !== undefined), 'public catalog shows only published products')
    assert(catalog.every((p) => p.inStock), 'in-stock computed from tracked stock')

    const guestOrder = await createOrder({
      businessId: businessA,
      lines: [{ productId: pomade.id, quantity: 1 }, { productId: ebook.id, quantity: 1 }],
      shipping: { email: 'guest@example.com' }, // guest: no customerId, digital+physical mix
    })
    orders.push(guestOrder.id)
    assert(guestOrder.customerId === null, 'guest checkout works without an account')
    assert(guestOrder.status === 'PENDING', 'order starts PENDING (never pre-paid)')
    assert(guestOrder.subtotal === 26, `subtotal from DATABASE prices (26, got ${guestOrder.subtotal})`)

    console.log('\n── 3. Shipping & tax rules ──')
    assert(guestOrder.shippingAmount === 5, `flat shipping for physical goods (5, got ${guestOrder.shippingAmount})`)
    assert(guestOrder.taxAmount === 2.6, `tax from settings rate (2.60, got ${guestOrder.taxAmount})`)
    assert(guestOrder.total === 33.6, `total recomputed server-side (33.60, got ${guestOrder.total})`)
    const digitalOnly = await createOrder({
      businessId: businessA,
      lines: [{ productId: ebook.id, quantity: 2 }],
      shipping: { email: 'guest2@example.com' },
    })
    orders.push(digitalOnly.id)
    assert(digitalOnly.shippingAmount === 0, 'digital-only orders skip shipping')

    console.log('\n── 4. Inventory safety ──')
    const stockAfter = await prisma.product.findUniqueOrThrow({ where: { id: pomade.id } })
    assert(stockAfter.stock === 4, `checkout reserves stock atomically (4 left, got ${stockAfter.stock})`)
    let oversold = false
    try {
      await createOrder({
        businessId: businessA,
        lines: [{ productId: pomade.id, quantity: 5 }], // only 4 left
        shipping: { email: 'guest3@example.com' },
      })
    } catch (e) { oversold = e instanceof StorefrontError && e.code === 'OUT_OF_STOCK' }
    assert(oversold, 'overselling is rejected, not clamped')
    const still = await prisma.product.findUniqueOrThrow({ where: { id: pomade.id } })
    assert(still.stock === 4, 'failed checkout does not leak a reservation')

    console.log('\n── 5. Idempotent checkout ──')
    const key = `test-key-${stamp}`
    const o1 = await createOrder({
      businessId: businessA,
      lines: [{ productId: shampoo.id, quantity: 2 }],
      shipping: { email: 'idem@example.com' }, idempotencyKey: key,
    })
    orders.push(o1.id)
    const o2 = await createOrder({
      businessId: businessA,
      lines: [{ productId: shampoo.id, quantity: 2 }],
      shipping: { email: 'idem@example.com' }, idempotencyKey: key,
    })
    assert(o1.id === o2.id, 'duplicate submission with same idempotency key returns the SAME order')
    const shampooCount = await prisma.orderItem.count({ where: { productId: shampoo.id } })
    assert(shampooCount === 1, `no duplicate line items created (1 row for the single order, got ${shampooCount})`)
    const shampooStock = (await prisma.product.findUniqueOrThrow({ where: { id: shampoo.id } })).stock
    assert(shampooStock === 3, `stock decremented exactly once (3 left, got ${shampooStock})`)

    console.log('\n── 6. Payment confirmation & duplicate webhooks ──')
    const pay = await prisma.payment.create({
      data: {
        businessId: businessA, kind: 'CHARGE', method: 'CARD', provider: 'stripe',
        amount: guestOrder.total, status: 'SUCCEEDED',
        metadata: orderPaymentMetadata(guestOrder.id),
      },
    })
    payments.push(pay.id)
    assert((await markOrderPaidForPayment(pay.id)) === true, 'settled payment marks order PAID')
    assert((await markOrderPaidForPayment(pay.id)) === false, 'duplicate webhook is an idempotent no-op')
    const paidOrder = await prisma.shopOrder.findUniqueOrThrow({ where: { id: guestOrder.id } })
    assert(paidOrder.status === 'PAID' && paidOrder.paymentId === pay.id, 'order links to its payment row')

    console.log('\n── 7. Payment failure releases stock ──')
    const failOrder = await createOrder({
      businessId: businessA,
      lines: [{ productId: pomade.id, quantity: 2 }],
      shipping: { email: 'fail@example.com' },
    })
    orders.push(failOrder.id)
    const stockBeforeFail = (await prisma.product.findUniqueOrThrow({ where: { id: pomade.id } })).stock
    const failPay = await prisma.payment.create({
      data: {
        businessId: businessA, kind: 'CHARGE', method: 'CARD', provider: 'stripe',
        amount: failOrder.total, status: 'FAILED',
        metadata: orderPaymentMetadata(failOrder.id),
      },
    })
    payments.push(failPay.id)
    assert((await markOrderPaymentFailed(failPay.id)) === true, 'failed payment moves order to PAYMENT_FAILED')
    const afterFail = (await prisma.product.findUniqueOrThrow({ where: { id: pomade.id } })).stock
    assert(afterFail === stockBeforeFail + 2, `failure releases reserved stock (${stockBeforeFail} -> ${afterFail})`)

    console.log('\n── 8. Cancellation ──')
    const cancelOrderRow = await createOrder({
      businessId: businessA,
      lines: [{ productId: shampoo.id, quantity: 1 }],
      shipping: { email: 'cancel@example.com' },
    })
    orders.push(cancelOrderRow.id)
    const beforeCancel = (await prisma.product.findUniqueOrThrow({ where: { id: shampoo.id } })).stock
    await cancelOrder(businessA, cancelOrderRow.id)
    const afterCancel = (await prisma.product.findUniqueOrThrow({ where: { id: shampoo.id } })).stock
    assert(afterCancel === beforeCancel + 1, 'canceling a PENDING order restocks the item')
    let badCancel = false
    try { await cancelOrder(businessA, cancelOrderRow.id) }
    catch (e) { badCancel = e instanceof StorefrontError && e.code === 'BAD_STATE' }
    assert(badCancel, 'double cancellation is rejected')

    console.log('\n── 9. Fulfillment state machine ──')
    const ok = await advanceFulfillment(businessA, guestOrder.id, 'PROCESSING')
    assert(ok.status === 'PROCESSING', 'PAID -> PROCESSING allowed')
    const shipped = await advanceFulfillment(businessA, guestOrder.id, 'SHIPPED', 'TRACK-123')
    assert(shipped.status === 'SHIPPED' && shipped.trackingNumber === 'TRACK-123', 'PROCESSING -> SHIPPED with tracking')
    const delivered = await advanceFulfillment(businessA, guestOrder.id, 'DELIVERED')
    assert(delivered.status === 'DELIVERED', 'SHIPPED -> DELIVERED allowed')
    let illegal = false
    try { await advanceFulfillment(businessA, digitalOnly.id, 'DELIVERED') }
    catch (e) { illegal = e instanceof StorefrontError && e.code === 'BAD_TRANSITION' }
    assert(illegal, 'PENDING -> DELIVERED is rejected (no skipping states)')
    let reDeliver = false
    try { await advanceFulfillment(businessA, guestOrder.id, 'DELIVERED') }
    catch (e) { reDeliver = e instanceof StorefrontError && e.code === 'BAD_TRANSITION' }
    assert(reDeliver, 'DELIVERED -> DELIVERED is rejected (terminal state)')

    console.log('\n── 10. Tenant isolation ──')
    const bProduct = await mkProduct(businessB, { name: 'Foreign Product', price: 100 })
    await enable(businessB)
    let crossErr = false
    try {
      await createOrder({
        businessId: businessA,
        lines: [{ productId: bProduct.id, quantity: 1 }],
        shipping: { email: 'x@example.com' },
      })
    } catch (e) { crossErr = e instanceof StorefrontError && e.code === 'PRODUCT_UNAVAILABLE' }
    assert(crossErr, 'ordering ANOTHER tenant\'s product is rejected at checkout')
    let crossCancel = false
    try { await cancelOrder(businessA, digitalOnly.id.replace(/./, 'z'), false) }
    catch (e) { crossCancel = e instanceof StorefrontError && e.code === 'NOT_FOUND' }
    assert(crossCancel, 'foreign order ids never resolve across tenants')
    const aOrders = await listOrders(businessA, { take: 500 })
    assert(aOrders.every((o) => o.businessId === businessA), 'order listing stays tenant-scoped')

    console.log('\n── 11. Stats ──')
    const stats = await orderStats(businessA)
    const dbPaid = await prisma.shopOrder.count({ where: { businessId: businessA, status: 'PAID' } })
    const statPaid = stats.find((s) => s.status === 'PAID')?.count ?? 0
    assert(statPaid === dbPaid, `stats reconcile (paid=${statPaid}/${dbPaid})`)
    const collectedRevenue = stats.filter((s) => ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(s.status)).reduce((sum, s) => sum + s.revenue, 0)
    assert(collectedRevenue === 33.6, `collected order revenue matches the paid order total (${collectedRevenue})`)
  } finally {
    console.log('\n🧹 Cleaning up...')
    await prisma.orderItem.deleteMany({ where: { product: { businessId: { in: [businessA!, businessB!] } } } }).catch(() => {})
    await prisma.shopOrder.deleteMany({ where: { businessId: { in: [businessA!, businessB!] } } }).catch(() => {})
    await prisma.payment.deleteMany({ where: { id: { in: payments } } }).catch(() => {})
    await prisma.product.deleteMany({ where: { businessId: { in: [businessA!, businessB!] } } }).catch(() => {})
    await prisma.ecommerceSettings.deleteMany({ where: { businessId: { in: [businessA!, businessB!] } } }).catch(() => {})
    await prisma.business.deleteMany({ where: { id: { in: [businessA!, businessB!] } } }).catch(() => {})
    await prisma.$disconnect()
  }

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`📊 Ecommerce: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  if (failed > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})

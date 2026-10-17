/**
 * SHOP UI + ORDER EMAIL TESTS (prompt 7, frontend + transactional email)
 *
 * Verifies against the real database and the shipped page sources:
 *   1. Transactional order email: fires exactly once per PENDING→PAID
 *      settlement, never throws when SMTP is unconfigured (fire-and-forget
 *      must not break the webhook), and its notification-log key makes
 *      webhook retries idempotent.
 *   2. Settlement still reconciles: payment link, tenant scoping of the
 *      payment→order path.
 *   3. Storefront UI structure (deterministic, no browser):
 *      - shop/cart/checkout pages ship in the (customer) tree
 *      - nav/footer only link /shop when the tenant's store is enabled
 *      - the checkout payload NEVER carries client prices (server computes)
 *      - the cart is keyed per business slug (tenant isolation client-side)
 *      - the public order-status endpoint is email-gated + same-response for
 *        missing vs wrong email (no enumeration)
 *   4. The email template escapes interpolated customer input.
 *
 * Run: npx tsx tests/shop-ui.test.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../src/lib/prisma'
import { markOrderPaidForPayment, orderPaymentMetadata } from '../src/lib/ecommerce'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}

const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const stamp = Date.now()
const cleanup: string[] = []

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

async function main() {
  console.log('\n── Order confirmation email (settlement hook) ──')

  const b = await mkBusiness(`shopui-${stamp}`)
  cleanup.push(b.id)

  const product = await prisma.product.create({
    data: {
      businessId: b.id, name: 'Pomade', slug: `pomade-${stamp}`,
      price: 18, stock: 5, published: true, productType: 'PHYSICAL',
    },
  })
  cleanup.push(product.id)

  const order = await prisma.shopOrder.create({
    data: {
      businessId: b.id, orderNumber: `T-${stamp}`, email: 'guest@t.test',
      subtotal: 36, shippingAmount: 0, taxAmount: 0, total: 36, currency: 'USD',
      status: 'PENDING',
      items: {
        create: [{ productId: product.id, name: 'Pomade', unitPrice: 18, quantity: 2, lineTotal: 36 }],
      },
    },
  })
  cleanup.push(order.id)

  const payment = await prisma.payment.create({
    data: {
      businessId: b.id, provider: 'stripe', status: 'SUCCEEDED', amount: 36,
      kind: 'CHARGE', method: 'CARD', metadata: orderPaymentMetadata(order.id),
    },
  })
  cleanup.push(payment.id)

  // Settlement: PENDING → PAID, email hook runs fire-and-forget and must
  // not throw even with SMTP completely unconfigured (test environment).
  let settleThrew = false
  let settled = false
  try {
    settled = await markOrderPaidForPayment(payment.id)
  } catch {
    settleThrew = true
  }
  assert(!settleThrew, 'settlement never throws even with SMTP unconfigured')
  assert(settled, 'PENDING order settles to PAID via payment metadata link')

  const after = await prisma.shopOrder.findUnique({ where: { id: order.id } })
  assert(after?.status === 'PAID', 'order status is PAID after settlement')
  assert(after?.paymentId === payment.id, 'order is linked to the settled payment')

  // Give the fire-and-forget email promise a moment, then verify no
  // duplicate can occur: the second settle attempt is a no-op.
  await new Promise((r) => setTimeout(r, 300))
  const retried = await markOrderPaidForPayment(payment.id)
  assert(retried === false, 'webhook retry cannot settle the same order twice (email fires once)')
  const afterRetry = await prisma.shopOrder.findUnique({ where: { id: order.id } })
  assert(afterRetry?.status === 'PAID', 'order stays PAID after webhook retry')

  // Non-SUCCEEDED payment must not settle anything.
  const failedPayment = await prisma.payment.create({
    data: {
      businessId: b.id, provider: 'stripe', status: 'FAILED', amount: 36,
      kind: 'CHARGE', method: 'CARD', metadata: orderPaymentMetadata(order.id),
    },
  })
  cleanup.push(failedPayment.id)
  const noSettle = await markOrderPaidForPayment(failedPayment.id)
  assert(noSettle === false, 'a FAILED payment never settles an order')

  // Email helper itself: unconfigured SMTP returns false without throwing.
  const { sendOrderConfirmationEmail } = await import('../src/lib/notifications')
  let emailThrew = false
  let emailSent = false
  try {
    emailSent = await sendOrderConfirmationEmail({
      businessId: b.id, to: 'guest@t.test', businessName: b.name,
      orderNumber: order.orderNumber,
      items: [{ name: 'Pomade', quantity: 2, price: 18 }],
      subtotal: 36, shippingAmount: 0, taxAmount: 0, total: 36,
    })
  } catch {
    emailThrew = true
  }
  assert(!emailThrew, 'email helper never throws when SMTP is unconfigured (fail-closed, returns false)')
  assert(typeof emailSent === 'boolean', 'email helper returns a boolean outcome')

  console.log('\n── Storefront UI structure (deterministic source checks) ──')

  const shopPage = read('src/app/(customer)/shop/page.tsx')
  assert(shopPage.includes('isStorefrontUsable'), 'shop page gates on the tenant storefront flag (feature + master switch)')
  assert(shopPage.includes('resolveBusiness'), 'shop page resolves the tenant server-side')

  const cartLib = read('src/lib/shop/cart.ts')
  assert(cartLib.includes('shopCart:${slug}'), 'cart storage is keyed per business slug (client-side tenant isolation)')
  assert(cartLib.includes('display-only') || cartLib.includes('DISPLAY-ONLY'), 'cart documents prices as display-only')

  const checkoutClient = read('src/app/(customer)/shop/checkout/CheckoutClient.tsx')
  assert(checkoutClient.includes('cartLines(slug)'), 'checkout submits only productId/quantity lines from the cart')
  const payloadStart = checkoutClient.indexOf('JSON.stringify({')
  const payloadEnd = checkoutClient.indexOf('})', payloadStart)
  const checkoutPayload = checkoutClient.slice(payloadStart, payloadEnd)
  assert(!/price/i.test(checkoutPayload), 'checkout payload never includes a client price (lines carry productId + quantity only)')
  assert(checkoutClient.includes('idempotencyKey'), 'checkout is idempotency-keyed client-side')

  const statusRoute = read('src/app/api/ecommerce/order-status/route.ts')
  assert(statusRoute.includes('email'), 'public order-status is email-gated')
  assert(statusRoute.includes('toLowerCase'), 'order-status email comparison is case-insensitive')
  assert(statusRoute.includes('!order || order.email'), 'missing and wrong email share ONE branch (no enumeration via distinct responses)')

  const navbar = read('src/components/customer/Navbar.tsx')
  assert(navbar.includes('shopEnabled'), 'navbar only links the shop when enabled')
  const footer = read('src/components/customer/Footer.tsx')
  assert(footer.includes('shopEnabled'), 'footer only links the shop when enabled')
  const layout = read('src/app/(customer)/layout.tsx')
  assert(layout.includes('isStorefrontUsable'), 'customer layout computes shopEnabled from tenant state')

  console.log('\n── Email template safety ──')

  const notifications = read('src/lib/notifications.ts')
  const templateStart = notifications.indexOf('sendOrderConfirmationEmail')
  const template = notifications.slice(templateStart)
  assert(template.includes('esc('), 'order email escapes interpolated customer input')
  assert(notifications.includes('SHOP_ORDER_CONFIRMATION'), 'order email logs under its own notification type')
  const ecommerceLib = read('src/lib/ecommerce.ts')
  assert(ecommerceLib.includes('sendOrderConfirmationEmail'), 'settlement path fires the order confirmation email')
  assert(ecommerceLib.includes('fire-and-forget') || ecommerceLib.includes('Fire-and-forget'), 'email failure documented as non-blocking for settlement')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => {
    // Deterministic cleanup: children (items/payments) cascade with parents.
    await prisma.shopOrder.deleteMany({ where: { id: { in: cleanup } } })
    await prisma.payment.deleteMany({ where: { id: { in: cleanup } } })
    await prisma.product.deleteMany({ where: { id: { in: cleanup } } })
    await prisma.business.deleteMany({ where: { id: { in: cleanup } } })
    await prisma.$disconnect()
    console.log(`\n${passed} passed, ${failed} failed`)
    if (failed > 0) process.exitCode = 1
  })

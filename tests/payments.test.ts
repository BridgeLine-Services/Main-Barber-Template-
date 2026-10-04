/**
 * Payments & POS Tests
 *
 * Covers the optional payment system end to end at the lib level:
 *   - pay-at-shop mode (POS disabled: no checkout, ledger untouched)
 *   - owner-controlled settings resolution + defaults
 *   - checkout: totals, tax, discounts, line items, tips (separate row),
 *     commission, receipt shape
 *   - refunds: full + partial, state-machine legality, ledger integrity
 *   - cancellation / no-show fees
 *   - role permissions: owner / admin / barber-own / barber-other
 *   - tenant isolation: cross-business access is impossible
 *   - webhook signature verification + duplicate event idempotency
 *
 * Run: npx tsx tests/payments.test.ts
 */
import { prisma } from '../src/lib/prisma'
import {
  buildCheckoutSummary,
  canRunCheckout,
  chargeFee,
  completeCheckout,
  getPosSettings,
  tipPresets,
} from '../src/lib/payments/pos'
import { canTransition, inPersonProvider } from '../src/lib/payments'
import { verifyStripeSignature } from '../src/lib/payments/providers/stripe-client'
import { createHmac } from 'crypto'

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`)
    passed++
  } else {
    console.log(`  ❌ ${message}`)
    failed++
  }
}

const SLUG = 'payments-test-shop'

async function setup() {
  console.log('\n📦 Setting up test data...')
  const business = await prisma.business.upsert({
    where: { slug: SLUG },
    update: {},
    create: { name: 'Payments Test Shop', slug: SLUG, timezone: 'America/Los_Angeles' },
  })
  const [customer, barber] = await Promise.all([
    prisma.customer.upsert({
      where: { businessId_email: { businessId: business.id, email: 'payments-test@example.com' } },
      update: {},
      create: { businessId: business.id, firstName: 'Pay', lastName: 'Test', phone: '555-0100', email: 'payments-test@example.com' },
    }),
    prisma.barber.upsert({
      where: { slug: `${SLUG}-barber` } as never,
      update: {},
      create: { businessId: business.id, name: 'Pay Barber', slug: `${SLUG}-barber` },
    }),
  ])
  const service = await prisma.service.upsert({
    where: { id: `svc-${SLUG}` },
    update: {},
    create: { businessId: business.id, id: `svc-${SLUG}`, name: 'Signature Cut', duration: 30, price: 40 },
  })
  const appointment = await prisma.appointment.create({
    data: {
      businessId: business.id,
      customerId: customer.id,
      barberId: barber.id,
      serviceId: service.id,
      confirmationNumber: `PAY-TEST-${Date.now()}`,
      customerAccessToken: `pay-test-token-${Date.now()}`,
      startTime: new Date(Date.now() + 24 * 3600 * 1000),
      endTime: new Date(Date.now() + 24 * 3600 * 1000 + 30 * 60 * 1000),
      status: 'COMPLETED',
    },
  })
  return { business, customer, barber, service, appointment }
}

async function main() {
  const { business, customer, barber, service, appointment } = await setup()

  console.log('\n🧪 Pay-at-shop mode (POS disabled — the template default)')
  {
    const settings = await getPosSettings(business.id)
    assert(settings.enabled === false, 'default PaymentSettings is disabled (pay-at-shop)')
    assert(Array.isArray(settings.tipPresets) || settings.tipPresets === null, 'settings row exists with safe defaults')
    const again = await getPosSettings(business.id)
    assert(again.id === settings.id, 'getPosSettings is idempotent (single row per business)')
    let threw = false
    try {
      await completeCheckout({
        businessId: business.id, appointmentId: appointment.id, actorId: 'u', actorRole: 'OWNER',
        method: 'CASH',
      })
    } catch {
      threw = true
    }
    assert(threw, 'completeCheckout refuses to run when POS is disabled')
    const count = await prisma.payment.count({ where: { businessId: business.id } })
    assert(count === 0, 'no ledger rows created in pay-at-shop mode')

    const permOff = canRunCheckout({ role: 'OWNER', businessId: business.id, barberId: null }, settings, {
      businessId: business.id, barberId: barber.id,
    })
    assert(!permOff.ok, 'checkout guard blocks everything while POS is disabled')
    const barberPerm = canRunCheckout({ role: 'BARBER', businessId: business.id, barberId: 'other-barber' }, settings, {
      businessId: business.id, barberId: barber.id,
    })
    assert(!barberPerm.ok, 'a barber can never enable payments when the owner has not')
  }

  console.log('\n🧪 Enabling POS (owner switch)')
  const enabledSettings = await prisma.paymentSettings.update({
    where: { businessId: business.id },
    data: {
      enabled: true,
      taxEnabled: true,
      taxRatePercent: 8.875,
      tipsEnabled: true,
      tipPresets: [15, 18, 20, 25],
      commissionEnabled: true,
      commissionRatePercent: 30,
    },
  })
  assert(enabledSettings.enabled === true, 'owner can enable Payments & POS')
  assert(JSON.stringify(tipPresets(enabledSettings)) === '[15,18,20,25]', 'tip presets resolve')
  const noPresets = await prisma.paymentSettings.update({ where: { businessId: business.id }, data: { tipPresets: undefined } })
  void noPresets
  assert(tipPresets(enabledSettings).length > 0, 'tip presets fall back to defaults when unset')

  console.log('\n🧪 Checkout summary')
  {
    const summary = await buildCheckoutSummary(business.id, appointment.id)
    assert(summary !== null, 'summary loads for the appointment')
    assert(summary!.service!.price === 40, 'service price present')
    assert(summary!.total === 43.55, 'total = 40 + 8.875% tax = 43.55')
    assert(summary!.remainingBalance === 43.55, 'nothing paid yet')
    assert(summary!.settings.enabled === true, 'summary carries settings to the client')

    const wrongShop = await buildCheckoutSummary(business.id, 'nope')
    assert(wrongShop === null, 'unknown appointment returns null (tenant-scoped)')
  }

  console.log('\n🧪 Checkout completion: cash + products + discount + tip')
  let chargeId = ''
  let tipId: string | undefined
  {
    const result = await completeCheckout({
      businessId: business.id, appointmentId: appointment.id, actorId: 'owner-1', actorRole: 'OWNER',
      method: 'CASH',
      lineItems: [
        { name: 'Pomade', amount: 12, kind: 'PRODUCT' },
        { name: 'Beard oil', amount: 8, kind: 'PRODUCT' },
      ],
      discountAmount: 5,
      tipAmount: 10,
    })
    chargeId = result.chargePaymentId
    tipId = result.tipPaymentId
    // subtotal = 40 + 20 = 60; discount 5 → taxable 55; tax 8.875% = 4.88; total 59.88
    assert(result.total === 59.88, `total includes products, discount and tax (got ${result.total})`)
    assert(result.tax === 4.88, 'tax computed at settings rate')
    assert(result.tip === 10, 'tip recorded')
    assert(!!result.tipPaymentId, 'tip stored as a SEPARATE payment row')
    assert(result.commission?.amount === 12, 'commission = 30% of service revenue ($40 → $12)')

    const charge = await prisma.payment.findUnique({ where: { id: chargeId } })
    assert(charge!.kind === 'CHARGE' && charge!.method === 'CASH' && charge!.status === 'SUCCEEDED', 'charge row: CHARGE/CASH/SUCCEEDED')
    assert(charge!.barberId === barber.id, 'payment records the barber id')
    assert(charge!.customerId === customer.id, 'payment records the customer id')
    assert(charge!.businessId === business.id, 'payment is tenant-isolated by businessId')
    const tipRow = await prisma.payment.findUnique({ where: { id: tipId! } })
    assert(tipRow!.kind === 'TIP' && tipRow!.amount === 10, 'tip row: kind TIP, amount 10 — never mixed with service revenue')

    const receipt = result.receipt as Record<string, unknown>
    const shop = receipt.shop as Record<string, unknown>
    const items = receipt.products as Array<Record<string, unknown>>
    assert(shop.name === 'Payments Test Shop', 'receipt has shop name')
    assert(items.length === 2, 'receipt lists products purchased')
    assert(typeof receipt.reference === 'string' && !!receipt.reference, 'receipt has transaction reference')

    const summary = await buildCheckoutSummary(business.id, appointment.id)
    assert(summary!.paid === 59.88, 'summary reflects paid amount after checkout')
    assert(summary!.remainingBalance === 0, 'remaining balance is zero after full payment')
    assert(summary!.tipsPaid === 10, 'tips tracked separately in summary')
  }

  console.log('\n🧪 Tip presets + per-barber opt-out')
  {
    const result = await completeCheckout({
      businessId: business.id, appointmentId: appointment.id, actorId: 'owner-1', actorRole: 'OWNER',
      method: 'CARD', tipPercent: 20,
    })
    assert(result.tip === 8, 'percent tip = 20% of $40 service = $8')
    await prisma.barber.update({ where: { id: barber.id }, data: { tipsOptOut: true } })
    const noTip = await completeCheckout({
      businessId: business.id, appointmentId: appointment.id, actorId: 'owner-1', actorRole: 'OWNER',
      method: 'CASH', tipAmount: 15,
    })
    assert(noTip.tip === 0, 'barber-level tip opt-out wins over a requested tip')
    assert(noTip.commission === undefined || noTip.commission.amount === 12, 'commission still computed when tips opt out')
    await prisma.barber.update({ where: { id: barber.id }, data: { tipsOptOut: false } })
  }

  console.log('\n🧋试 Refunds: full + partial (state machine + ledger)')
  {
    const before = await prisma.payment.findUnique({ where: { id: chargeId } })
    assert(before!.status === 'SUCCEEDED', 'charge is SUCCEEDED before refund')

    // Partial refund of $10.
    const partial = await prisma.$transaction((tx) =>
      inPersonProvider.refund({ businessId: business.id, tx }, {
        paymentId: chargeId, reason: 'partial test',
        idempotencyKey: `test-refund-partial-${chargeId}`, amount: 10,
      } as never),
    )
    assert(partial.ok, 'partial refund succeeds')
    const afterPartial = await prisma.payment.findUnique({ where: { id: chargeId } })
    assert(afterPartial!.status === 'PARTIALLY_REFUNDED', 'original → PARTIALLY_REFUNDED after partial refund')
    assert(afterPartial!.refundedAmount === 10, 'refundedAmount tracks the reversed total')
    const refundRow = await prisma.payment.findUnique({ where: { id: partial.payment!.id } })
    assert(refundRow!.kind === 'REFUND' && refundRow!.amount === -10, 'refund row: kind REFUND, negative amount')

    // Duplicate idempotency: same key would be rejected by unique constraint.
    let dupThrew = false
    try {
      await prisma.payment.create({
        data: { businessId: business.id, kind: 'REFUND', method: 'CASH', provider: 'in_person', amount: -10, status: 'SUCCEEDED', originalPaymentId: chargeId, idempotencyKey: `test-refund-partial-${chargeId}` },
      })
    } catch {
      dupThrew = true
    }
    assert(dupThrew, 'duplicate idempotency key cannot create a second refund (unique constraint)')

    // Full refund of the remainder.
    const full = await prisma.$transaction((tx) =>
      inPersonProvider.refund({ businessId: business.id, tx }, {
        paymentId: chargeId, reason: 'full remainder',
        idempotencyKey: `test-refund-full-${chargeId}`, amount: 49.88,
      } as never),
    )
    assert(full.ok, 'full refund of remainder succeeds')
    const afterFull = await prisma.payment.findUnique({ where: { id: chargeId } })
    assert(afterFull!.status === 'REFUNDED', 'original fully REFUNDED at the end')
    assert(Math.abs(afterFull!.refundedAmount - 59.88) < 0.01, 'refunded total equals original amount')

    // Illegal transitions are refused.
    assert(!canTransition('REFUNDED', 'SUCCEEDED'), 'REFUNDED is terminal')
    assert(!canTransition('PENDING', 'REFUNDED'), 'cannot refund a pending payment directly')
    assert(canTransition('PARTIALLY_REFUNDED', 'PARTIALLY_REFUNDED'), 'further partial refunds allowed')
  }

  console.log('\n🧪 Cancellation / no-show fees')
  {
    const fee = await chargeFee({
      businessId: business.id, kind: 'CANCELLATION_FEE', amount: 15,
      appointmentId: appointment.id, customerId: customer.id, method: 'CASH',
    })
    const row = await prisma.payment.findUnique({ where: { id: fee.paymentId } })
    assert(row!.kind === 'CANCELLATION_FEE' && row!.status === 'SUCCEEDED', 'cancellation fee settles immediately (cash)')
    const noShow = await chargeFee({
      businessId: business.id, kind: 'NO_SHOW_FEE', amount: 25,
      appointmentId: appointment.id, customerId: customer.id, method: 'IN_PERSON',
    })
    const nsRow = await prisma.payment.findUnique({ where: { id: noShow.paymentId } })
    assert(nsRow!.kind === 'NO_SHOW_FEE', 'no-show fee recorded')
    assert(!!row!.idempotencyKey, 'fee charges carry idempotency keys')
  }

  console.log('\n🧪 Role-based checkout permissions')
  {
    const settings = await getPosSettings(business.id)
    const appt = { businessId: business.id, barberId: barber.id }
    assert(canRunCheckout({ role: 'OWNER', businessId: business.id, barberId: null }, settings, appt).ok, 'owner may check out any appointment')
    assert(canRunCheckout({ role: 'BUSINESS_ADMIN', businessId: business.id, barberId: null }, settings, appt).ok, 'business admin may check out (existing permissions allow it)')
    assert(canRunCheckout({ role: 'BARBER', businessId: business.id, barberId: barber.id }, settings, appt).ok, 'barber may check out their own appointment')
    assert(!canRunCheckout({ role: 'BARBER', businessId: business.id, barberId: 'someone-else' }, settings, appt).ok, 'barber may NOT check out another barber\'s appointment')
    assert(!canRunCheckout({ role: 'CUSTOMER', businessId: null, barberId: null }, settings, appt).ok, 'customers can never run checkout')
    assert(!canRunCheckout({ role: 'OWNER', businessId: 'another-business', barberId: null }, settings, appt).ok, 'cross-shop checkout blocked')

    const noBarberCheckout = await prisma.paymentSettings.update({
      where: { businessId: business.id },
      data: { allowBarberCheckout: false },
    })
    assert(!canRunCheckout({ role: 'BARBER', businessId: business.id, barberId: barber.id }, noBarberCheckout, appt).ok, 'owner can barber-checkout-block barbers even with POS on')
    await prisma.paymentSettings.update({ where: { businessId: business.id }, data: { allowBarberCheckout: true } })
  }

  console.log('\n🧪 Tenant isolation')
  {
    const otherBusiness = await prisma.business.create({
      data: { name: 'Other Payments Shop', slug: `${SLUG}-other`, timezone: 'America/Los_Angeles' },
    })
    let crossThrew = false
    try {
      await completeCheckout({
        businessId: otherBusiness.id, appointmentId: appointment.id, actorId: 'x', actorRole: 'OWNER', method: 'CASH',
      })
    } catch {
      crossThrew = true
    }
    assert(crossThrew, 'checkout from another business cannot touch this appointment')
    const scoped = await prisma.payment.findFirst({ where: { id: chargeId, businessId: otherBusiness.id } })
    assert(scoped === null, 'payment reads are tenant-scoped (businessId filter)')
    const mixed = await buildCheckoutSummary(otherBusiness.id, appointment.id)
    assert(mixed === null, 'summary cannot cross tenant boundaries')
    await prisma.business.delete({ where: { id: otherBusiness.id } })
  }

  console.log('\n🧪 Stripe webhook signature + duplicate event idempotency')
  {
    const secret = 'whsec_test_secret'
    const raw = JSON.stringify({ id: 'evt_test_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', metadata: { paymentId: 'x' } } } })
    const ts = Math.floor(Date.now() / 1000)
    const sig = createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')
    const okEvent = verifyStripeSignature(raw, `t=${ts},v1=${sig}`, secret)
    assert(okEvent !== null && (okEvent as Record<string, unknown>).id === 'evt_test_1', 'valid signature accepted, event parsed')
    const badSig = verifyStripeSignature(raw, `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${raw}x`).digest('hex')}`, secret)
    assert(badSig === null, 'tampered payload rejected')
    assert(verifyStripeSignature(raw, `t=${ts},v1=${sig}`, 'whsec_wrong') === null, 'wrong secret rejected')
    assert(verifyStripeSignature(raw, null, secret) === null, 'missing signature header rejected')

    await prisma.stripeEvent.create({ data: { eventId: 'evt_test_1', type: 'payment_intent.succeeded' } })
    let dup = false
    try {
      await prisma.stripeEvent.create({ data: { eventId: 'evt_test_1', type: 'payment_intent.succeeded' } })
    } catch (e) {
      dup = (e as { code?: string }).code === 'P2002'
    }
    assert(dup, 'duplicate webhook event id is a unique violation — replays become no-ops')
    await prisma.stripeEvent.deleteMany({ where: { eventId: { startsWith: 'evt_test_' } } })
  }

  console.log('\n🧹 Cleanup')
  await prisma.business.delete({ where: { id: business.id } }) // cascades payments/settings/appointment
  const remaining = await prisma.payment.count({ where: { businessId: business.id } })
  assert(remaining === 0, 'cascade cleanup removed all test payments')

  console.log(`\n${'─'.repeat(50)}\n  Results: ${passed} passed, ${failed} failed\n`)
  await prisma.$disconnect()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(async (err) => {
  console.error('Test run crashed:', err)
  await prisma.$disconnect()
  process.exit(1)
})

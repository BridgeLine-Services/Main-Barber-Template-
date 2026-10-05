/**
 * Gift Card System Tests
 *
 * Covers the gift card feature at the lib + POS level against the real DB:
 *   - settings: safe defaults (OFF), lazy creation, owner-only authority,
 *     role-based sell permissions
 *   - master switch: OFF blocks purchase and redemption, history preserved
 *   - code security: server-generated, strict format, unique, normalized
 *   - purchase (POS): payment + card + PURCHASE ledger row in one
 *     transaction, validity months honored, amount bounds enforced
 *   - redemption in checkout: full cover (no secondary charge), partial
 *     (split tender: gift card + cash), multiple redemptions until depleted
 *   - invalid code, expired card, other-shop code (tenant isolation)
 *   - refunds: redemption refund restores balance (idempotent), purchase
 *     refund removes value
 *   - concurrent redemption: two simultaneous checkouts on one card can
 *     never overdraw it (atomic conditional decrement)
 *   - owner adjustments: audited, clamped, reason required
 *   - reporting: sold/redeemed/liability summary math
 *   - commissions: still created when a gift card covers the whole ticket
 *   - activation: PENDING card (online purchase) activates when its
 *     purchase payment settles
 *   - tenant isolation: lists, details, redemptions never cross shops
 *
 * Run: npx tsx tests/gift-cards.test.ts
 */
import { prisma } from '../src/lib/prisma'
import { completeCheckout } from '../src/lib/payments/pos'
import { inPersonProvider } from '../src/lib/payments/providers/in-person'
import {
  GiftCardError,
  getGiftCardSettings,
  canManageGiftCards,
  canSellGiftCards,
  generateGiftCardCode,
  normalizeGiftCardCode,
  sellGiftCard,
  redeemGiftCardInTx,
  adjustGiftCardForRefund,
  adjustGiftCardBalance,
  activateGiftCardForPayment,
  giftCardSummary,
  listGiftCards,
  getGiftCardDetail,
  giftCardDenominations,
} from '../src/lib/gift-cards'

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
const near = (a: number, b: number, msg: string, eps = 0.01) =>
  assert(Math.abs(a - b) < eps, `${msg} (got ${a.toFixed(3)}, want ${b})`)

const expectCode = async (fn: () => Promise<unknown>, code: GiftCardError['code'], msg: string) => {
  try {
    await fn()
    assert(false, `${msg} (no error thrown)`)
  } catch (e) {
    assert(e instanceof GiftCardError && e.code === code, msg)
  }
}

const CODE_RE = /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/

async function main() {
  console.log('\n📦 Setting up gift card test tenants...')
  const stamp = Date.now()
  // Remove leftovers from any earlier crashed run (businesses cascade to
  // their gift card rows).
  await prisma.business.deleteMany({ where: { slug: { startsWith: 'gift-shop-' } } })
  await prisma.business.deleteMany({ where: { slug: { startsWith: 'gift-other-' } } })
  const business = await prisma.business.create({
    data: { name: `Gift Shop ${stamp}`, slug: `gift-shop-${stamp}`, timezone: 'America/Los_Angeles' },
  })
  const otherBiz = await prisma.business.create({
    data: { name: `Gift Other ${stamp}`, slug: `gift-other-${stamp}`, timezone: 'America/Los_Angeles' },
  })
  const owner = await prisma.user.create({
    data: { email: `gift-owner-${stamp}@t.test`, passwordHash: 'x', name: 'Owner', role: 'OWNER', businessId: business.id },
  })
  const barber = await prisma.barber.create({ data: { businessId: business.id, name: 'Jake Peralta', isActive: true } })
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Cut + Wash', price: 70, duration: 45 } })
  const customer = await prisma.customer.create({
    data: { businessId: business.id, firstName: 'Gift', lastName: 'Tester', email: `gift-c-${stamp}@t.test`, phone: '555-0101' },
  })

  // POS must be on for checkout; gift cards must be ON via the owner switch.
  await prisma.paymentSettings.create({
    data: { businessId: business.id, enabled: true, taxEnabled: false, tipsEnabled: false },
  })

  let apptSeq = 0
  const makeAppointment = async (price?: number) => {
    const svc = price && price !== 70
      ? await prisma.service.create({ data: { businessId: business.id, name: `Svc ${apptSeq}`, price, duration: 30 } })
      : service
    apptSeq++
    const start = new Date(Date.now() + 24 * 3600 * 1000)
    return prisma.appointment.create({
      data: {
        businessId: business.id,
        customerId: customer.id,
        barberId: barber.id,
        serviceId: svc.id,
        confirmationNumber: `GIFT-${stamp}-${apptSeq}`,
        customerAccessToken: `gift-token-${stamp}-${apptSeq}`,
        startTime: start,
        endTime: new Date(start.getTime() + 30 * 60 * 1000),
        status: 'COMPLETED',
      },
    })
  }

  // Delete strictly child-first (FKs are RESTRICT, and parallel
  // Promise.all cleanup can race the ordering).
  const cleanup = async () => {
    for (const businessId of [business.id, otherBiz.id]) {
      await prisma.commissionEntry.deleteMany({ where: { businessId } })
      await prisma.commissionSettings.deleteMany({ where: { businessId } })
      await prisma.giftCardTransaction.deleteMany({ where: { businessId } })
      await prisma.giftCard.deleteMany({ where: { businessId } })
      await prisma.giftCardSettings.deleteMany({ where: { businessId } })
      await prisma.payment.deleteMany({ where: { businessId } })
      await prisma.appointment.deleteMany({ where: { businessId } })
      await prisma.barber.deleteMany({ where: { businessId } })
      await prisma.customer.deleteMany({ where: { businessId } })
      await prisma.service.deleteMany({ where: { businessId } })
      await prisma.paymentSettings.deleteMany({ where: { businessId } })
      await prisma.user.deleteMany({ where: { businessId } })
      await prisma.business.deleteMany({ where: { id: businessId } })
    }
  }

  // ─── 1. Settings & owner authority ──────────────────────────────
  console.log('\n⚙️  Settings: safe defaults, lazy creation, owner authority')
  {
    const settings = await getGiftCardSettings(business.id)
    assert(!settings.enabled, 'defaults to OFF (owner opt-in required)')
    assert(settings.defaultValidityMonths === 12, 'default validity is 12 months')
    assert(canManageGiftCards('OWNER') && canManageGiftCards('PLATFORM_OWNER'), 'owner manages gift card settings')
    assert(!canManageGiftCards('BUSINESS_ADMIN') && !canManageGiftCards('BARBER'), 'admin/barber cannot manage settings')
    assert(canSellGiftCards({ role: 'OWNER' }, { allowBarberCheckout: false }), 'owner can sell')
    assert(canSellGiftCards({ role: 'BARBER' }, { allowBarberCheckout: true }), 'barber can sell when owner enabled barber checkout')
    assert(!canSellGiftCards({ role: 'BARBER' }, { allowBarberCheckout: false }), 'barber cannot sell by default')
    assert(!canSellGiftCards({ role: 'CUSTOMER' }, { allowBarberCheckout: true }), 'customers cannot sell')
    const again = await prisma.giftCardSettings.findUnique({ where: { businessId: business.id } })
    assert(!!again, 'settings row lazily created on first read')
    assert(
      JSON.stringify(giftCardDenominations(settings)) === JSON.stringify([25, 50, 75, 100]),
      'default denominations are $25/$50/$75/$100',
    )
  }

  // ─── 2. Master switch OFF blocks everything ──────────────────────
  console.log('\n🔒 Master switch OFF blocks purchase + redemption')
  {
    await expectCode(
      () => sellGiftCard({ businessId: business.id, amount: 50, purchaserName: 'Amy', purchaseMethod: 'CASH' }),
      'GIFT_CARDS_DISABLED',
      'purchase blocked while OFF',
    )
    await prisma.$transaction(async (tx) => {
      // seed a card directly to prove redemption is blocked too
      const card = await tx.giftCard.create({
        data: {
          businessId: business.id, code: generateGiftCardCode(), type: 'PHYSICAL',
          initialValue: 50, remainingBalance: 50, status: 'ACTIVE', purchaserName: 'Seeded',
        },
      })
      await expectCode(
        () => redeemGiftCardInTx(tx, { businessId: business.id }, card.code, 10),
        'GIFT_CARDS_DISABLED',
        'redemption blocked while OFF',
      )
    })
  }

  // ─── 3. Enable + code security ───────────────────────────────────
  console.log('\n🔐 Code security: server-generated, unique, strict format')
  {
    await prisma.giftCardSettings.update({ where: { businessId: business.id }, data: { enabled: true } })
    const codes = new Set<string>()
    for (let i = 0; i < 500; i++) codes.add(generateGiftCardCode())
    assert(codes.size === 500, '500 generated codes are all unique')
    assert(Array.from(codes).every((c) => CODE_RE.test(c)), 'all codes match the strict format')
    assert(!Array.from(codes).some((c) => /[01OIL]/.test(c.replace(/-/g, ''))), 'no ambiguous characters (0/1/O/I/L)')
    assert(normalizeGiftCardCode('  abcd-efgh-ijkl-mnop ') === 'ABCD-EFGH-IJKL-MNOP', 'codes are normalized (trim + uppercase)')
  }

  // ─── 4. Purchase (POS sale) ──────────────────────────────────────
  console.log('\n🛒 Purchase: payment + card + ledger row in one transaction')
  let cardCode: string
  let cardId: string
  {
    const { giftCard, purchaseTransaction, paymentId } = await sellGiftCard({
      businessId: business.id, amount: 50, type: 'PHYSICAL', purchaserName: 'Amy Santiago',
      purchaserEmail: 'amy@t.test', recipientName: 'Terry', recipientEmail: 'terry@t.test',
      message: 'Happy birthday!', soldByUserId: owner.id, purchaseMethod: 'CASH',
    })
    cardCode = giftCard.code
    cardId = giftCard.id
    assert(CODE_RE.test(giftCard.code), 'card has a valid generated code')
    assert(giftCard.status === 'ACTIVE', 'POS sale creates an ACTIVE card')
    near(giftCard.initialValue, 50, 'initial value stored')
    near(giftCard.remainingBalance, 50, 'remaining balance starts at the initial value')
    assert(giftCard.type === 'PHYSICAL', 'physical type supported')
    assert(giftCard.expiresAt !== null, 'expiration date configured from validity months')
    assert(!!paymentId, 'purchase payment recorded')
    const payment = await prisma.payment.findUnique({ where: { id: paymentId! } })
    assert(payment?.status === 'SUCCEEDED' && payment.method === 'CASH', 'POS purchase payment is SUCCEEDED with the tender method')
    assert((payment?.metadata as Record<string, unknown>)?.giftCardPurchase === true, 'payment tagged as a gift card purchase')
    assert(purchaseTransaction.type === 'PURCHASE', 'PURCHASE ledger row created')
    near(purchaseTransaction.balanceAfter, 50, 'ledger row snapshots the balance after purchase')

    await expectCode(
      () => sellGiftCard({ businessId: business.id, amount: 0, purchaserName: 'X', purchaseMethod: 'CASH' }),
      'INVALID_AMOUNT',
      'amount below minimum rejected',
    )
    await expectCode(
      () => sellGiftCard({ businessId: business.id, amount: 5001, purchaserName: 'X', purchaseMethod: 'CASH' }),
      'INVALID_AMOUNT',
      'amount above maximum rejected',
    )
    await expectCode(
      () => sellGiftCard({ businessId: business.id, amount: 50, purchaserName: 'X' } as never),
      'INVALID_AMOUNT',
      'sale without a purchase payment rejected',
    )
  }

  // ─── 5. Full redemption in checkout ─────────────────────────────
  console.log('\n💳 Redemption: gift card covers the whole ticket')
  {
    const appt = await makeAppointment(50)
    const result = await completeCheckout({
      businessId: business.id, appointmentId: appt.id, actorId: owner.id, actorRole: 'OWNER',
      method: 'CASH', giftCardCode: cardCode,
    })
    near(result.giftCard!.applied, 50, 'gift card applied its full balance')
    near(result.giftCard!.balanceAfter, 0, 'card balance after redemption is 0')
    near(result.total, 50, 'checkout total is the service price')
    const giftPayment = await prisma.payment.findFirst({
      where: { appointmentId: appt.id, method: 'GIFT_CARD' },
    })
    assert(!!giftPayment && giftPayment.status === 'SUCCEEDED', 'GIFT_CARD payment row recorded')
    near(giftPayment!.amount, 50, 'gift card payment amount equals applied balance')
    const cashPayment = await prisma.payment.findFirst({
      where: { appointmentId: appt.id, method: 'CASH' },
    })
    assert(!cashPayment, 'no secondary charge when the card covers everything')
    const card = await prisma.giftCard.findUnique({ where: { id: cardId } })
    assert(card?.status === 'DEPLETED', 'fully used card is DEPLETED')
  }

  // ─── 6. Partial redemption (split tender) ───────────────────────
  console.log('\n💳 Partial redemption: $50 card against a $70 ticket')
  let partialCode: string
  let partialCardId: string
  {
    const { giftCard } = await sellGiftCard({
      businessId: business.id, amount: 50, purchaserName: 'Rosa', purchaseMethod: 'IN_PERSON',
    })
    partialCode = giftCard.code
    partialCardId = giftCard.id
    const appt = await makeAppointment() // $70 service
    const result = await completeCheckout({
      businessId: business.id, appointmentId: appt.id, actorId: owner.id, actorRole: 'OWNER',
      method: 'CASH', giftCardCode: partialCode,
    })
    near(result.giftCard!.applied, 50, 'gift card applied $50')
    near(result.total, 70, 'ticket total was $70')
    const cashPayment = await prisma.payment.findFirst({
      where: { appointmentId: appt.id, method: 'CASH' },
    })
    near(cashPayment!.amount, 20, 'remaining $20 charged to the other payment method')
    const card = await prisma.giftCard.findUnique({ where: { id: partialCardId } })
    assert(card?.status === 'DEPLETED', 'card depleted after partial redemption')
  }

  // ─── 7. Multiple redemptions until depleted ─────────────────────
  console.log('\n🔁 Multiple redemptions across several checkouts')
  {
    const { giftCard } = await sellGiftCard({
      businessId: business.id, amount: 100, purchaserName: 'Gina', purchaseMethod: 'CASH',
    })
    for (const price of [40, 40, 20]) {
      const appt = await makeAppointment(price)
      await completeCheckout({
        businessId: business.id, appointmentId: appt.id, actorId: owner.id, actorRole: 'OWNER',
        method: 'CASH', giftCardCode: giftCard.code,
      })
    }
    const card = await prisma.giftCard.findUnique({ where: { id: giftCard.id } })
    near(card!.remainingBalance, 0, 'three redemptions consumed the full balance')
    assert(card!.status === 'DEPLETED', 'card DEPLETED after multiple redemptions')
    const appt = await makeAppointment(30)
    await expectCode(
      () => completeCheckout({
        businessId: business.id, appointmentId: appt.id, actorId: owner.id, actorRole: 'OWNER',
        method: 'CASH', giftCardCode: giftCard.code,
      }),
      'INSUFFICIENT_BALANCE',
      'redeeming a depleted card is rejected',
    )
    const txns = await prisma.giftCardTransaction.count({ where: { giftCardId: giftCard.id, type: 'REDEMPTION' } })
    assert(txns === 3, 'three REDEMPTION ledger rows recorded')
  }

  // ─── 8. Invalid + expired codes ─────────────────────────────────
  console.log('\n🚫 Invalid code, expired card')
  {
    const appt = await makeAppointment(30)
    await expectCode(
      () => completeCheckout({
        businessId: business.id, appointmentId: appt.id, actorId: owner.id, actorRole: 'OWNER',
        method: 'CASH', giftCardCode: 'AAAA-BBBB-CCCC-DDDD',
      }),
      'INVALID_CODE',
      'unknown code rejected',
    )
    await expectCode(
      () => completeCheckout({
        businessId: business.id, appointmentId: appt.id, actorId: owner.id, actorRole: 'OWNER',
        method: 'CASH', giftCardCode: 'not-a-real-code!!',
      }),
      'INVALID_CODE',
      'malformed code rejected',
    )

    const { giftCard: expired } = await sellGiftCard({
      businessId: business.id, amount: 25, purchaserName: 'Boyle', purchaseMethod: 'CASH',
    })
    await prisma.giftCard.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 24 * 3600 * 1000) },
    })
    await expectCode(
      () => completeCheckout({
        businessId: business.id, appointmentId: appt.id, actorId: owner.id, actorRole: 'OWNER',
        method: 'CASH', giftCardCode: expired.code,
      }),
      'CARD_EXPIRED',
      'expired card rejected',
    )
    near((await prisma.giftCard.findUnique({ where: { id: expired.id } }))!.remainingBalance, 25, 'expired card balance untouched')
  }

  // ─── 9. Refunds ──────────────────────────────────────────────────
  console.log('\n↩️  Refunds: redemption restores balance; purchase removes value')
  {
    const { giftCard } = await sellGiftCard({ businessId: business.id, amount: 50, purchaserName: 'Hitchcock', purchaseMethod: 'CASH' })
    const appt = await makeAppointment(30)
    await completeCheckout({
      businessId: business.id, appointmentId: appt.id, actorId: owner.id, actorRole: 'OWNER',
      method: 'CASH', giftCardCode: giftCard.code,
    })
    const giftPayment = await prisma.payment.findFirst({ where: { appointmentId: appt.id, method: 'GIFT_CARD' } })

    // Refund the redemption via the real provider, then sync the card.
    await prisma.$transaction(async (tx) => {
      const res = await inPersonProvider.refund(
        { businessId: business.id, tx },
        { paymentId: giftPayment!.id, reason: 'test', idempotencyKey: `refund:${giftPayment!.id}:${Date.now()}` } as never,
      )
      assert(res.ok, 'provider refund succeeded')
      await adjustGiftCardForRefund(tx, business.id, giftPayment!.id)
    })
    let card = await prisma.giftCard.findUnique({ where: { id: giftCard.id } })
    near(card!.remainingBalance, 50, 'redemption refund restored the full balance')
    assert(card!.status === 'ACTIVE', 'card reactivated after refund')

    // Idempotent: a second sync for the same refund adds nothing.
    await prisma.$transaction((tx) => adjustGiftCardForRefund(tx, business.id, giftPayment!.id))
    card = await prisma.giftCard.findUnique({ where: { id: giftCard.id } })
    near(card!.remainingBalance, 50, 'refund sync is idempotent (no double restore)')

    // Refunding a PURCHASE payment removes value from the card.
    const purchasePaymentId = (await prisma.giftCard.findUnique({ where: { id: giftCard.id } }))!.purchasePaymentId!
    await prisma.$transaction(async (tx) => {
      await inPersonProvider.refund(
        { businessId: business.id, tx },
        { paymentId: purchasePaymentId, amount: 20, reason: 'partial purchase refund', idempotencyKey: `refund:${purchasePaymentId}:20:${Date.now()}` } as never,
      )
      await adjustGiftCardForRefund(tx, business.id, purchasePaymentId)
    })
    card = await prisma.giftCard.findUnique({ where: { id: giftCard.id } })
    near(card!.remainingBalance, 30, 'purchase refund removed $20 of value from the card')
  }

  // ─── 10. Concurrent redemption (race safety) ─────────────────────
  console.log('\n🏎️  Concurrent redemption can never overdraw a card')
  {
    const { giftCard } = await sellGiftCard({ businessId: business.id, amount: 50, purchaserName: 'Scully', purchaseMethod: 'CASH' })
    const apptA = await makeAppointment(30)
    const apptB = await makeAppointment(30)
    const checkout = (apptId: string) =>
      completeCheckout({
        businessId: business.id, appointmentId: apptId, actorId: owner.id, actorRole: 'OWNER',
        method: 'CASH', giftCardCode: giftCard.code,
      }).then(() => 'ok')
    const results = await Promise.allSettled([checkout(apptA.id), checkout(apptB.id)])
    const okCount = results.filter((r) => r.status === 'fulfilled').length
    assert(okCount === 1, `exactly one concurrent redemption wins (got ${okCount})`)
    const card = await prisma.giftCard.findUnique({ where: { id: giftCard.id } })
    near(card!.remainingBalance, 20, 'card balance after the race is exactly $20')
    assert((card!.remainingBalance ?? 0) >= 0, 'balance can never go negative')
    const redemptions = await prisma.giftCardTransaction.aggregate({
      where: { giftCardId: giftCard.id, type: 'REDEMPTION' }, _sum: { amount: true },
    })
    near(redemptions._sum.amount ?? 0, 30, 'total redeemed never exceeds the available balance')
    const payments = await prisma.payment.count({
      where: { businessId: business.id, method: 'GIFT_CARD', metadata: { path: ['giftCardId'], equals: giftCard.id } },
    })
    assert(payments === 1, 'only one GIFT_CARD payment committed (loser rolled back)')
  }

  // ─── 11. Owner manual adjustment ─────────────────────────────────
  console.log('\n📝 Owner adjustments are audited and clamped')
  {
    const { giftCard } = await sellGiftCard({ businessId: business.id, amount: 40, purchaserName: 'Diaz', purchaseMethod: 'CASH' })
    await adjustGiftCardBalance(business.id, giftCard.id, -10, 'misprint correction', owner.id)
    let card = await prisma.giftCard.findUnique({ where: { id: giftCard.id } })
    near(card!.remainingBalance, 30, 'negative adjustment reduces the balance')
    await expectCode(
      () => adjustGiftCardBalance(business.id, giftCard.id, -40, 'too much', owner.id),
      'INVALID_AMOUNT',
      'adjustment below zero rejected',
    )
    await expectCode(
      () => adjustGiftCardBalance(business.id, giftCard.id, 5, '', owner.id),
      'INVALID_AMOUNT',
      'adjustment without a reason rejected',
    )
    const adjTxns = await prisma.giftCardTransaction.findMany({
      where: { giftCardId: giftCard.id, type: 'ADJUSTMENT' },
    })
    assert(adjTxns.length === 1 && adjTxns[0].note!.includes('misprint correction'), 'ADJUSTMENT ledger row records the reason')
    await adjustGiftCardBalance(business.id, giftCard.id, 10, 'found the misprint', owner.id)
    card = await prisma.giftCard.findUnique({ where: { id: giftCard.id } })
    near(card!.remainingBalance, 40, 'positive adjustment restores the balance (clamped at initial value)')
  }

  // ─── 12. Online purchase activation ─────────────────────────────
  console.log('\n🌐 Online purchase: PENDING card activates on settlement')
  {
    const payment = await prisma.payment.create({
      data: {
        businessId: business.id, kind: 'CHARGE', method: 'CARD', provider: 'stripe',
        amount: 60, status: 'PROCESSING', metadata: { giftCardPurchase: true } as never,
      },
    })
    const { giftCard } = await sellGiftCard({
      businessId: business.id, amount: 60, purchaserName: 'Web Buyer',
      purchaserEmail: 'web@t.test', recipientName: 'Friend', purchasePaymentId: payment.id,
    })
    assert(giftCard.status === 'PENDING', 'online purchase creates a PENDING card')
    await prisma.$transaction(async (tx) => {
      await expectCode(
        () => redeemGiftCardInTx(tx, { businessId: business.id }, giftCard.code, 10),
        'CARD_NOT_ACTIVE',
        'PENDING card cannot be redeemed',
      )
    })
    // Webhook path: payment settles → card activates.
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED' } })
    await activateGiftCardForPayment(payment.id)
    const card = await prisma.giftCard.findUnique({ where: { id: giftCard.id } })
    assert(card?.status === 'ACTIVE', 'card activated when its purchase payment settled')
    await activateGiftCardForPayment(payment.id) // idempotent
    assert((await prisma.giftCard.findUnique({ where: { id: giftCard.id } }))!.status === 'ACTIVE', 'activation is idempotent')
  }

  // ─── 13. Commissions still paid on gift-card tickets ─────────────
  console.log('\n💸 Commissions: gift card checkout still commissions the barber')
  {
    await prisma.commissionSettings.upsert({
      where: { businessId: business.id },
      create: {
        businessId: business.id, enabled: true, defaultRateType: 'PERCENT', defaultRatePercent: 40,
        defaultRateFixed: 0, productCommissionEnabled: false,
      },
      update: { enabled: true, defaultRateType: 'PERCENT', defaultRatePercent: 40, productCommissionEnabled: false },
    })
    const { giftCard } = await sellGiftCard({ businessId: business.id, amount: 70, purchaserName: 'Pimento', purchaseMethod: 'CASH' })
    const appt = await makeAppointment()
    const result = await completeCheckout({
      businessId: business.id, appointmentId: appt.id, actorId: owner.id, actorRole: 'OWNER',
      method: 'CASH', giftCardCode: giftCard.code,
    })
    near(result.commission!.amount, 28, 'commission computed on the full service revenue ($70 × 40%)')
    const entries = await prisma.commissionEntry.count({ where: { businessId: business.id, appointmentId: appt.id } })
    assert(entries > 0, 'commission ledger entries created for the gift-card-paid checkout')
  }

  // ─── 14. Reporting ────────────────────────────────────────────────
  console.log('\n📊 Owner reporting summary')
  {
    const summary = await giftCardSummary(business.id)
    assert(summary.soldCount >= 9 && summary.soldAmount > 0, 'sold cards and amounts reported')
    assert(summary.redeemedCount >= 5 && summary.redeemedAmount > 0, 'redemptions reported')
    assert(summary.refundAmount > 0, 'refunds reported')
    const activeCards = await prisma.giftCard.findMany({
      where: { businessId: business.id, status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    })
    const expectedLiability = Math.round(activeCards.reduce((s, c) => s + c.remainingBalance, 0) * 100) / 100
    near(summary.outstandingLiability, expectedLiability, 'outstanding liability equals active card balances')
    assert(summary.activeCount === activeCards.length, 'active card count matches')
    assert(summary.expiredCount === 1, 'expired cards counted separately')
  }

  // ─── 15. Tenant isolation ─────────────────────────────────────────
  console.log('\n🧱 Tenant isolation: cards never cross shops')
  {
    // Other shop enables gift cards independently.
    await prisma.giftCardSettings.create({ data: { businessId: otherBiz.id, enabled: true } })
    const mine = await listGiftCards(business.id)
    const theirs = await listGiftCards(otherBiz.id)
    assert(mine.every((c) => c.id !== undefined) && theirs.length === 0, 'other shop sees none of our cards')
    const myCodes = new Set(mine.map((c) => c.code))
    assert(theirs.every((c) => !myCodes.has(c.code)), 'listings are disjoint')
    assert((await getGiftCardDetail(business.id, mine[0].id)) !== null, 'own shop reads its card detail')
    assert((await getGiftCardDetail(otherBiz.id, mine[0].id)) === null, "other shop cannot read our card's detail")
    // Redeeming our code at the other shop fails — codes are tenant-scoped.
    await prisma.$transaction(async (tx) => {
      await expectCode(
        () => redeemGiftCardInTx(tx, { businessId: otherBiz.id }, mine[0].code, 5),
        'INVALID_CODE',
        "other shop's checkout rejects our gift card code",
      )
    })
    await expectCode(
      () => adjustGiftCardBalance(otherBiz.id, mine[0].id, 5, 'theft attempt', owner.id),
      'NOT_FOUND',
      'other shop cannot adjust our card',
    )
  }

  // ─── cleanup ─────────────────────────────────────────────────────
  console.log('\n🧹 Cleaning up test tenants...')
  await cleanup()
  console.log('\n' + '─'.repeat(50))
  console.log(`📊 Gift card tests: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  if (failed > 0) process.exit(1)
  process.exit(0)
}

main().catch(async (err) => {
  console.error('💥 Gift card test crash:', err)
  process.exit(1)
})

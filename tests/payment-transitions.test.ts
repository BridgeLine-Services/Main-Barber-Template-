/**
 * Payment state-transition and tenant-safety tests (Requirement 23).
 *
 * Covers:
 *   1. The status machine allows only legal transitions
 *   2. In-person provider flow: create → confirm → refund
 *   3. Illegal operations are refused (confirm non-pending, refund
 *      non-succeeded, refund a refund)
 *   4. Idempotency keys deduplicate charges
 *   5. Tenant isolation: business B cannot confirm or refund business
 *      A's payment (getPayment is businessId-scoped)
 *   6. resolvePaymentProvider fails closed on misconfiguration
 *
 * Run: npx tsx tests/payment-transitions.test.ts
 */
import { prisma } from '../src/lib/prisma'
import { canTransition } from '../src/lib/payments/state-machine'
import { inPersonProvider, resolvePaymentProvider } from '../src/lib/payments'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  PASS ${msg}`); passed++ }
  else { console.error(`  FAIL ${msg}`); failed++ }
}

async function main() {
  console.log('\n── 1. Status machine ──')
  const legal: Array<[string, string[]]> = [
    ['PENDING',    ['PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED']],
    ['PROCESSING', ['SUCCEEDED', 'FAILED', 'CANCELED']],
    ['SUCCEEDED',  ['REFUNDED']],
    ['FAILED',     ['PENDING']],
    ['CANCELED',   []],
    ['REFUNDED',   []],
  ]
  const all = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED']
  for (const [from, allowed] of legal) {
    for (const to of all) {
      const want = allowed.includes(to)
      assert(canTransition(from as never, to as never) === want,
        `${from} -> ${to} is ${want ? 'allowed' : 'blocked'}`)
    }
  }

  const stamp = Date.now()
  const business = await prisma.business.create({ data: {
    name: `Pay Shop ${stamp}`, slug: `pay-${stamp}`, email: `pay-${stamp}@test.com`,
    phone: '555-0401', address: '5 Pay Way', city: 'PayCity', state: 'CA',
    zipCode: '90005', timezone: 'America/Los_Angeles' } })
  const businessB = await prisma.business.create({ data: {
    name: `Pay Other ${stamp}`, slug: `payother-${stamp}`, email: `po-${stamp}@test.com`,
    phone: '555-0402', address: '6 Pay Way', city: 'PayCity', state: 'CA',
    zipCode: '90006', timezone: 'America/Los_Angeles' } })
  const customer = await prisma.customer.create({ data: {
    firstName: 'Pay', lastName: 'Cust', email: `payc-${stamp}@test.com`,
    phone: '555-0501', businessId: business.id } })

  try {
    const ctxA = { businessId: business.id }
    const ctxB = { businessId: businessB.id }

    console.log('\n── 2. In-person flow: create → confirm → refund ──')
    const charge = await prisma.$transaction(async (tx) => {
      const r = await inPersonProvider.createCharge({ ...ctxA, tx }, {
        amount: 25, kind: 'CHARGE', customerId: customer.id,
        idempotencyKey: `pay-${stamp}` })
      assert(r.ok && r.payment.status === 'PENDING', 'createCharge records PENDING in-person charge')
      return r.payment
    })
    const confirmed = await prisma.$transaction(async (tx) =>
      inPersonProvider.confirm({ ...ctxA, tx }, charge.id))
    assert(confirmed.ok && confirmed.payment.status === 'SUCCEEDED', 'confirm settles PENDING → SUCCEEDED')
    const refunded = await prisma.$transaction(async (tx) =>
      inPersonProvider.refund({ ...ctxA, tx }, { paymentId: charge.id, reason: 'test' }))
    assert(refunded.ok, 'refund succeeds on SUCCEEDED payment')
    const orig = await prisma.payment.findUniqueOrThrow({ where: { id: charge.id } })
    const refundRow = await prisma.payment.findFirstOrThrow({ where: { originalPaymentId: charge.id } })
    assert(orig.status === 'REFUNDED', 'original payment marked REFUNDED')
    assert(refundRow.kind === 'REFUND' && refundRow.amount === -25 && refundRow.status === 'SUCCEEDED',
      'refund ledger row created (negative amount, SUCCEEDED)')

    console.log('\n── 3. Refund retry and remaining-balance safety ──')
    const partialCharge = await prisma.$transaction(async (tx) =>
      inPersonProvider.createCharge({ ...ctxA, tx }, { amount: 40, kind: 'CHARGE' }))
    const partialSettled = await prisma.$transaction(async (tx) =>
      inPersonProvider.confirm({ ...ctxA, tx }, partialCharge.payment.id))
    assert(partialSettled.ok, 'partial-refund test charge is settled')
    const refundKey = `refund-retry-${stamp}`
    const partialFirst = await prisma.$transaction(async (tx) =>
      inPersonProvider.refund({ ...ctxA, tx }, { paymentId: partialCharge.payment.id, amount: 10, idempotencyKey: refundKey }))
    const partialReplay = await prisma.$transaction(async (tx) =>
      inPersonProvider.refund({ ...ctxA, tx }, { paymentId: partialCharge.payment.id, amount: 10, idempotencyKey: refundKey }))
    assert(partialFirst.ok && partialReplay.ok, 'a retry of the same partial refund succeeds')
    assert(partialFirst.payment.id === partialReplay.payment.id, 'a refund retry returns the original ledger row')
    const partialState = await prisma.payment.findUniqueOrThrow({ where: { id: partialCharge.payment.id } })
    assert(partialState.refundedAmount === 10, 'a retry does not double the refunded balance')
    const mismatchedReplay = await prisma.$transaction(async (tx) =>
      inPersonProvider.refund({ ...ctxA, tx }, { paymentId: partialCharge.payment.id, amount: 15, idempotencyKey: refundKey }))
    assert(!mismatchedReplay.ok, 'reusing the key for a different amount is rejected')

    const concurrentCharge = await prisma.$transaction(async (tx) =>
      inPersonProvider.createCharge({ ...ctxA, tx }, { amount: 40, kind: 'CHARGE' }))
    const concurrentSettled = await prisma.$transaction(async (tx) =>
      inPersonProvider.confirm({ ...ctxA, tx }, concurrentCharge.payment.id))
    assert(concurrentSettled.ok, 'concurrency test charge is settled')
    const concurrentRefunds = await Promise.all([
      prisma.$transaction(async (tx) => inPersonProvider.refund(
        { ...ctxA, tx }, { paymentId: concurrentCharge.payment.id, amount: 30, idempotencyKey: `concurrent-a-${stamp}` },
      )),
      prisma.$transaction(async (tx) => inPersonProvider.refund(
        { ...ctxA, tx }, { paymentId: concurrentCharge.payment.id, amount: 30, idempotencyKey: `concurrent-b-${stamp}` },
      )),
    ])
    assert(concurrentRefunds.filter((refund) => refund.ok).length === 1,
      'concurrent distinct refunds cannot overrun the remaining balance')
    const concurrentState = await prisma.payment.findUniqueOrThrow({ where: { id: concurrentCharge.payment.id } })
    const concurrentLedgerCount = await prisma.payment.count({
      where: { originalPaymentId: concurrentCharge.payment.id, kind: 'REFUND' },
    })
    assert(concurrentState.refundedAmount === 30 && concurrentLedgerCount === 1,
      'concurrent refund attempts leave one correctly balanced ledger entry')

    console.log('\n── 4. Illegal operations refused ──')
    const canceled = await prisma.$transaction(async (tx) => {
      const r = await inPersonProvider.createCharge({ ...ctxA, tx }, { amount: 10, kind: 'TIP' })
      await tx.payment.update({ where: { id: r.payment.id }, data: { status: 'CANCELED' } })
      return r.payment
    })
    const confirmCanceled = await prisma.$transaction(async (tx) =>
      inPersonProvider.confirm({ ...ctxA, tx }, canceled.id))
    assert(!confirmCanceled.ok, 'confirm refused on CANCELED payment (terminal)')
    const refundCanceled = await prisma.$transaction(async (tx) =>
      inPersonProvider.refund({ ...ctxA, tx }, { paymentId: canceled.id }))
    assert(!refundCanceled.ok, 'refund refused on CANCELED payment')
    const refundRefund = await prisma.$transaction(async (tx) =>
      inPersonProvider.refund({ ...ctxA, tx }, { paymentId: refundRow.id }))
    assert(!refundRefund.ok, 'refund refused on a refund row')
    const badAmount = await prisma.$transaction(async (tx) =>
      inPersonProvider.createCharge({ ...ctxA, tx }, { amount: -5, kind: 'CHARGE' }))
    assert(!badAmount.ok, 'negative amount refused')

    console.log('\n── 5. Charge idempotency ──')
    let dupRejected = false
    try {
      await prisma.payment.create({ data: {
        businessId: business.id, kind: 'CHARGE', method: 'IN_PERSON',
        provider: 'in_person', amount: 5, idempotencyKey: `pay-${stamp}` } })
    } catch { dupRejected = true }
    assert(dupRejected, 'duplicate idempotencyKey rejected by unique constraint')

    console.log('\n── 6. Tenant isolation ──')
    const bCharge = await prisma.$transaction(async (tx) => {
      const r = await inPersonProvider.createCharge({ ...ctxA, tx }, { amount: 30, kind: 'CHARGE' })
      return r.payment
    })
    const crossConfirm = await prisma.$transaction(async (tx) =>
      inPersonProvider.confirm({ ...ctxB, tx }, bCharge.id))
    assert(!crossConfirm.ok, 'business B cannot confirm business A payment')
    const crossRefund = await prisma.$transaction(async (tx) =>
      inPersonProvider.refund({ ...ctxB, tx }, { paymentId: bCharge.id }))
    assert(!crossRefund.ok, 'business B cannot refund business A payment')
    const scopedCount = await prisma.payment.count({ where: { businessId: businessB.id } })
    assert(scopedCount === 0, 'business B ledger sees zero of business A payments')

    console.log('\n── 7. Provider resolution fails closed ──')
    let threw = false
    try { resolvePaymentProvider({ paymentInPerson: false }) } catch { threw = true }
    assert(threw, 'online payments without a registered provider throws (fail closed)')
    assert(resolvePaymentProvider({ paymentInPerson: true }).id === 'in_person',
      'pay-at-shop business resolves in_person provider')
  } finally {
    await prisma.payment.deleteMany({ where: { businessId: { in: [business.id, businessB.id] } } })
    await prisma.customer.deleteMany({ where: { businessId: { in: [business.id, businessB.id] } } })
    await prisma.business.deleteMany({ where: { id: { in: [business.id, businessB.id] } } })
  }

  console.log(`\nPayment transition tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error('Test crashed:', e); await prisma.$disconnect(); process.exit(1) })

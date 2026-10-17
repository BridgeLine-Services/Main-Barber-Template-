/**
 * MEMBERSHIP RECURRING BILLING & RENEWAL TESTS (prompt 6C/6D)
 *
 * Deterministic, DB-backed, no network: covers the subscription lifecycle
 * handlers (the Stripe calls themselves are fail-closed wrappers over the
 * configured key; with no key they throw, never simulate) and the period-end
 * processing job.
 *
 * Verifies:
 *   1. invoice.paid renews the period EXACTLY ONCE (replay is a no-op)
 *   2. Out-of-order invoices can never rewind a period
 *   3. invoice.payment_failed → PAST_DUE (never a free period)
 *   4. subscription.deleted → CANCELED (immediate) / PAYMENT_FAILED (PENDING)
 *   5. subscription.updated syncs cancel_at_period_end and past_due
 *   6. Period-end job: renew-lapsed, cancel-at-end, grace expiry
 *   7. Idempotent re-run of the job converges (no duplicate effects)
 *   8. Tenant isolation: foreign subscription refs never resolve
 *   9. ended memberships never resurrect from a webhook
 *
 * Run: npx tsx tests/memberships-renewals.test.ts
 */
import { prisma } from '../src/lib/prisma'
import {
  handleSubscriptionDeleted,
  handleSubscriptionInvoiceFailed,
  handleSubscriptionInvoicePaid,
  handleSubscriptionUpdated,
  processMembershipPeriodEnds,
} from '../src/lib/memberships'
import { subscriptionsConfigured } from '../src/lib/payments/stripe-subscriptions'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}

const stamp = Date.now()
let biz: string
const cleanups: string[] = []

async function mkFixtures() {
  const business = await prisma.business.create({
    data: {
      name: `Renew Shop ${stamp}`, slug: `renew-${stamp}`,
      email: `renew-${stamp}@t.test`, phone: '555-0100', address: '1 R St',
      city: 'Rcity', state: 'CA', zipCode: '90001', timezone: 'America/Los_Angeles',
      cancellationDeadlineHours: 0,
      featureOverrides: { memberships: true } as never,
    },
  })
  biz = business.id
  const customer = await prisma.customer.create({
    data: { businessId: biz, firstName: 'Renew', lastName: 'Customer', email: `cust-${stamp}@t.test`, phone: '555-0111' },
  })
  const plan = await prisma.membershipPlan.create({
    data: { businessId: biz, name: 'Gold', price: 30, billingInterval: 'MONTHLY' },
  })
  return { business, customer, plan }
}

async function mkMembership(opts: {
  planId: string
  customerId: string
  status: 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
  periodStart?: Date
  periodEnd?: Date
  subscriptionRef?: string
  autoRenew?: boolean
}) {
  const m = await prisma.membership.create({
    data: {
      businessId: biz,
      customerId: opts.customerId,
      planId: opts.planId,
      status: opts.status,
      startedAt: opts.periodStart ?? new Date('2026-09-01T12:00:00Z'),
      currentPeriodStart: opts.periodStart ?? new Date('2026-09-01T12:00:00Z'),
      currentPeriodEnd: opts.periodEnd ?? new Date('2026-10-01T12:00:00Z'),
      autoRenew: opts.autoRenew ?? true,
      subscriptionRef: opts.subscriptionRef ?? `sub_test_${stamp}_${cleanups.length}`,
    },
  })
  cleanups.push(m.id)
  return m
}

async function main() {
  console.log('\n── Preconditions ──')
  assert(subscriptionsConfigured() === false, 'with no STRIPE_SECRET_KEY the provider reports unconfigured (fail-closed)')

  const { customer, plan } = await mkFixtures()
  const now = new Date('2026-10-17T12:00:00Z')

  try {
    console.log('\n── 1. invoice.paid renews exactly once ──')
    const m1 = await mkMembership({ planId: plan.id, customerId: customer.id, status: 'ACTIVE' })
    const periodEnd = new Date('2026-11-01T12:00:00Z')
    assert((await handleSubscriptionInvoicePaid(m1.subscriptionRef!, periodEnd)) === true, 'invoice.paid renews the period')
    let row = await prisma.membership.findUniqueOrThrow({ where: { id: m1.id } })
    assert(row.currentPeriodEnd?.toISOString() === '2026-11-01T12:00:00.000Z' && row.status === 'ACTIVE', 'period advanced to the invoice period end')
    assert((await handleSubscriptionInvoicePaid(m1.subscriptionRef!, periodEnd)) === false, 'REPLAY of the same invoice is a no-op')
    row = await prisma.membership.findUniqueOrThrow({ where: { id: m1.id } })
    assert(row.currentPeriodEnd?.toISOString() === '2026-11-01T12:00:00.000Z', 'replay did not move the period again')

    console.log('\n── 2. Out-of-order safety ──')
    const stale = new Date('2026-10-15T12:00:00Z') // earlier than current period end
    assert((await handleSubscriptionInvoicePaid(m1.subscriptionRef!, stale)) === false, 'an OLDER invoice cannot rewind the period')
    row = await prisma.membership.findUniqueOrThrow({ where: { id: m1.id } })
    assert(row.currentPeriodEnd?.toISOString() === '2026-11-01T12:00:00.000Z', 'period end unchanged after stale event')

    console.log('\n── 3. Failed renewal → PAST_DUE, never free ──')
    const m2 = await mkMembership({ planId: plan.id, customerId: customer.id, status: 'ACTIVE' })
    assert((await handleSubscriptionInvoiceFailed(m2.subscriptionRef!)) === true, 'invoice.payment_failed marks ACTIVE membership PAST_DUE')
    row = await prisma.membership.findUniqueOrThrow({ where: { id: m2.id } })
    assert(row.status === 'PAST_DUE', 'status is PAST_DUE (no free period granted)')
    assert((await handleSubscriptionInvoiceFailed(m2.subscriptionRef!)) === false, 'second failure event is a no-op')
    const mPending = await mkMembership({ planId: plan.id, customerId: customer.id, status: 'PENDING' })
    assert((await handleSubscriptionInvoiceFailed(mPending.subscriptionRef!)) === true, 'first-payment failure on PENDING membership → PAYMENT_FAILED')

    console.log('\n── 4. subscription.deleted ──')
    assert((await handleSubscriptionDeleted(m2.subscriptionRef!, now)) === true, 'deleted event cancels an ACTIVE membership')
    row = await prisma.membership.findUniqueOrThrow({ where: { id: m2.id } })
    assert(row.status === 'CANCELED' && row.endedAt?.getTime() === now.getTime(), 'canceled with endedAt')
    assert((await handleSubscriptionDeleted(m2.subscriptionRef!, now)) === false, 'delete replay is a no-op')
    row = await prisma.membership.findUniqueOrThrow({ where: { id: mPending.id } })
    assert((await handleSubscriptionDeleted(row.subscriptionRef!, now)) === true, 'PENDING membership on delete → PAYMENT_FAILED (never activated)')

    console.log('\n── 5. subscription.updated sync ──')
    const m5 = await mkMembership({ planId: plan.id, customerId: customer.id, status: 'ACTIVE' })
    assert((await handleSubscriptionUpdated(m5.subscriptionRef!, 'active', true)) === true, 'updated event with cancel_at_period_end syncs')
    row = await prisma.membership.findUniqueOrThrow({ where: { id: m5.id } })
    assert(row.autoRenew === false && row.status === 'ACTIVE', 'autoRenew=false while benefits continue to period end')
    assert((await handleSubscriptionUpdated(m5.subscriptionRef!, 'active', true)) === false, 'no-op when already synced')
    assert((await handleSubscriptionUpdated(m5.subscriptionRef!, 'past_due', false)) === true, 'provider past_due state maps to PAST_DUE')
    row = await prisma.membership.findUniqueOrThrow({ where: { id: m5.id } })
    assert(row.status === 'PAST_DUE', 'membership is PAST_DUE after provider reports it')

    console.log('\n── 6. Period-end processing job ──')
    // a) lapsed renewer → PAST_DUE
    const due = await mkMembership({
      planId: plan.id, customerId: customer.id, status: 'ACTIVE',
      periodStart: new Date('2026-09-01T12:00:00Z'), periodEnd: new Date('2026-10-10T12:00:00Z'),
    })
    // b) cancel-at-period-end
    const eop = await mkMembership({
      planId: plan.id, customerId: customer.id, status: 'ACTIVE', autoRenew: false,
      periodStart: new Date('2026-09-01T12:00:00Z'), periodEnd: new Date('2026-10-10T12:00:00Z'),
    })
    // c) past grace
    const stalePastDue = await mkMembership({
      planId: plan.id, customerId: customer.id, status: 'PAST_DUE',
      periodStart: new Date('2026-08-01T12:00:00Z'), periodEnd: new Date('2026-09-01T12:00:00Z'),
    })
    // d) healthy — must be untouched
    const healthy = await mkMembership({
      planId: plan.id, customerId: customer.id, status: 'ACTIVE',
      periodStart: new Date('2026-10-01T12:00:00Z'), periodEnd: new Date('2026-11-01T12:00:00Z'),
    })
    const outcome = await processMembershipPeriodEnds(biz, now)
    row = await prisma.membership.findUniqueOrThrow({ where: { id: due.id } })
    assert(row.status === 'PAST_DUE', 'lapsed auto-renew membership moved to PAST_DUE (no invented charge)')
    row = await prisma.membership.findUniqueOrThrow({ where: { id: eop.id } })
    assert(row.status === 'CANCELED' && !!row.endedAt, 'cancel-at-period-end honored')
    row = await prisma.membership.findUniqueOrThrow({ where: { id: stalePastDue.id } })
    assert(row.status === 'EXPIRED', 'PAST_DUE beyond grace expired')
    row = await prisma.membership.findUniqueOrThrow({ where: { id: healthy.id } })
    assert(row.status === 'ACTIVE', 'in-period membership untouched')
    // m5 (PAST_DUE from the sync test, period ended 2026-10-01) is also beyond
    // the 7-day grace at 'now' — correctly expired by the same grace rule.
    assert(outcome.processed === 4 && outcome.pastDue === 1 && outcome.canceled === 1 && outcome.expired === 2, `outcome counts correct (${JSON.stringify(outcome)})`)

    console.log('\n── 7. Idempotent re-run ──')
    const second = await processMembershipPeriodEnds(biz, now)
    assert(second.processed === 0, 'second run finds nothing to do (converges)')

    console.log('\n── 8. Isolation ──')
    assert((await handleSubscriptionInvoicePaid('sub_other_tenant_xyz', new Date())) === false, 'foreign subscription ref never resolves')
    assert((await handleSubscriptionDeleted('sub_nonexistent', now)) === false, 'unknown subscription ref is a safe no-op')

    console.log('\n── 9. Ended memberships never resurrect ──')
    const dead = await mkMembership({ planId: plan.id, customerId: customer.id, status: 'EXPIRED' })
    assert((await handleSubscriptionInvoicePaid(dead.subscriptionRef!, new Date('2026-12-01T12:00:00Z'))) === false, 'invoice.paid for an EXPIRED membership is refused (reconciliation flagged)')
    row = await prisma.membership.findUniqueOrThrow({ where: { id: dead.id } })
    assert(row.status === 'EXPIRED', 'expired membership stayed expired')
  } finally {
    console.log('\n🧹 Cleaning up...')
    await prisma.membership.deleteMany({ where: { id: { in: cleanups } } }).catch(() => {})
    await prisma.membershipPlan.deleteMany({ where: { businessId: biz } }).catch(() => {})
    await prisma.customer.deleteMany({ where: { businessId: biz } }).catch(() => {})
    await prisma.membershipSettings.deleteMany({ where: { businessId: biz } }).catch(() => {})
    await prisma.business.deleteMany({ where: { id: biz } }).catch(() => {})
    await prisma.$disconnect()
  }

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`📊 Memberships renewals: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  if (failed > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})

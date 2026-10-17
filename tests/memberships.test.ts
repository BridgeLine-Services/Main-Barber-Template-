/**
 * MEMBERSHIPS TESTS (prompt 6)
 *
 * Verifies the membership invariants directly against the database:
 *   1. Fail-closed gate: feature flag AND owner master switch required
 *   2. Enrollment -> PENDING only; activation ONLY on verified payment
 *   3. Duplicate/preventive enrollment rules (active, pending, inactive plan)
 *   4. Benefits: discount quotes, included visits, rolling window counts
 *   5. Duplicate redemption impossible (DB unique constraint)
 *   6. Tenant isolation: cross-business plan/enrollment/membership reads fail
 *   7. Cancellation semantics (pending = immediate, active = at period end)
 *   8. Period-end processing: past-due, grace expiry, non-renew cancel
 *   9. Webhook activation idempotency (membership never double-activated)
 *
 * Run: npx tsx tests/memberships.test.ts
 */
import { prisma } from '../src/lib/prisma'
import {
  MembershipError,
  MEMBERSHIP_ERRORS,
  activateMembershipForPayment,
  applyBenefitForAppointment,
  cancelMembership,
  enrollCustomer,
  getMembershipSettings,
  isMembershipSystemUsable,
  listCustomerMemberships,
  listPlans,
  membershipPaymentMetadata,
  membershipStats,
  processMembershipPeriodEnds,
  quoteBenefit,
  validatePlanInput,
} from '../src/lib/memberships'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}

let businessA: string, businessB: string
const planIds: string[] = []
const createdMemberships: string[] = []
const createdCustomers: string[] = []
const createdPayments: string[] = []

async function mkBusiness(slug: string) {
  return prisma.business.create({
    data: {
      name: `MShip ${slug}`, slug,
      email: `${slug}@t.test`, phone: '555-0100', address: '1 M St',
      city: 'Mcity', state: 'CA', zipCode: '90001', timezone: 'America/Los_Angeles',
      cancellationDeadlineHours: 0,
    },
  })
}
async function mkCustomer(businessId: string, tag: string) {
  const c = await prisma.customer.create({
    data: {
      businessId, firstName: 'Cust', lastName: tag, phone: '555-0199',
      email: `mship-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.test`,
    },
  })
  createdCustomers.push(c.id)
  return c
}
async function mkPlan(businessId: string, data: Partial<Parameters<typeof prisma.membershipPlan.create>[0]['data']> & { name: string }) {
  const p = await prisma.membershipPlan.create({
    data: { businessId, price: 25, ...data } as never,
  })
  planIds.push(p.id)
  return p
}

async function main() {
  const stamp = Date.now()
  console.log('\n── Setup: two tenants ──')
  businessA = (await mkBusiness(`mship-a-${stamp}`)).id
  businessB = (await mkBusiness(`mship-b-${stamp}`)).id

  try {
    console.log('\n── 1. Fail-closed gate ──')
    assert(await isMembershipSystemUsable(businessA) === false, 'usable = false with no settings and flag off (fail-closed)')
    const s = await getMembershipSettings(businessA)
    assert(s.enabled === false, 'master switch defaults to off')

    console.log('\n── 2. Enrollment requires the gate ──')
    const custA = await mkCustomer(businessA, 'a1')
    const planBasic = await mkPlan(businessA, { name: 'Basic' })
    await prisma.membershipSettings.update({ where: { businessId: businessA }, data: { enabled: true } })
    await prisma.business.update({ where: { id: businessA }, data: { featureOverrides: { memberships: true } } as never })
    assert(await isMembershipSystemUsable(businessA) === true, 'usable = true once flag AND switch are on')

    const { membership: pending } = await enrollCustomer({ businessId: businessA, customerId: custA.id, planId: planBasic.id })
    createdMemberships.push(pending.id)
    assert(pending.status === 'PENDING', 'enrollment creates PENDING, never ACTIVE')
    let dupErr: unknown = null
    try { await enrollCustomer({ businessId: businessA, customerId: custA.id, planId: planBasic.id }) }
    catch (e) { dupErr = e }
    assert(dupErr instanceof MembershipError && dupErr.code === 'ALREADY_ENROLLED', 'second enrollment while PENDING is rejected')

    console.log('\n── 3. Activation only on verified payment ──')
    // payment NOT succeeded must not activate
    const failPay = await prisma.payment.create({
      data: {
        businessId: businessA, customerId: custA.id, kind: 'CHARGE', method: 'CARD',
        provider: 'stripe', amount: 25, status: 'FAILED',
        metadata: membershipPaymentMetadata(pending.id),
      },
    })
    createdPayments.push(failPay.id)
    assert((await activateMembershipForPayment(failPay.id)) === false, 'non-succeeded payment does NOT activate')
    let still = await prisma.membership.findUnique({ where: { id: pending.id } })
    assert(still?.status === 'PENDING', 'membership stays PENDING after failed payment')

    const okPay = await prisma.payment.create({
      data: {
        businessId: businessA, customerId: custA.id, kind: 'CHARGE', method: 'CARD',
        provider: 'stripe', amount: 25, status: 'SUCCEEDED',
        metadata: membershipPaymentMetadata(pending.id),
      },
    })
    createdPayments.push(okPay.id)
    assert((await activateMembershipForPayment(okPay.id)) === true, 'verified payment activates the membership')
    still = await prisma.membership.findUnique({ where: { id: pending.id } })
    assert(still?.status === 'ACTIVE', 'membership is ACTIVE after settlement')
    assert(!!still?.currentPeriodEnd && still.currentPeriodEnd.getTime() > Date.now(), 'activation sets a period end')
    assert((await activateMembershipForPayment(okPay.id)) === false, 're-activation is an idempotent no-op')

    console.log('\n── 4. Benefits ──')
    const discPlan = await mkPlan(businessA, {
      name: 'Club 20', price: 40, serviceDiscountPercent: 20, includedVisitsPerPeriod: 2, visitWindowDays: 30,
    })
    const custB = await mkCustomer(businessA, 'a2')
    const { membership: club } = await enrollCustomer({ businessId: businessA, customerId: custB.id, planId: discPlan.id })
    createdMemberships.push(club.id)
    const clubPay = await prisma.payment.create({
      data: {
        businessId: businessA, customerId: custB.id, kind: 'CHARGE', method: 'CARD',
        provider: 'in_person', amount: 40, status: 'SUCCEEDED',
        metadata: membershipPaymentMetadata(club.id),
      },
    })
    createdPayments.push(clubPay.id)
    await activateMembershipForPayment(clubPay.id)

    const q = await quoteBenefit(businessA, custB.id, 30)
    assert(q !== null && q.visitCovered === true && q.dueAmount === 0, 'first visit is covered by included-visit benefit')

    // apply to appointment 1 and 2 (covered), 3 must fall back to discount
    const appts: string[] = []
    for (let i = 0; i < 3; i++) {
      const appt = await prisma.appointment.create({
        data: {
          businessId: businessA, customerId: custB.id,
          serviceId: (await prisma.service.create({ data: { businessId: businessA, name: `svc-${stamp}-${i}`, duration: 30, price: 30 } })).id,
          barberId: (await prisma.barber.create({ data: { businessId: businessA, name: `barber-${stamp}-${i}` } })).id,
          startTime: new Date(), endTime: new Date(Date.now() + 30 * 60000),
          status: 'COMPLETED',
          confirmationNumber: `MBR-${stamp}-${i}-${Math.random().toString(36).slice(2, 8)}`,
          customerAccessToken: Math.random().toString(36).slice(2) + Date.now(),
        },
      })
      appts.push(appt.id)
    }
    const b1 = await applyBenefitForAppointment({ businessId: businessA, customerId: custB.id, appointmentId: appts[0], servicePrice: 30 })
    assert(b1?.visitCovered === true, 'appointment 1 redeems an included visit')
    const b1dup = await applyBenefitForAppointment({ businessId: businessA, customerId: custB.id, appointmentId: appts[0], servicePrice: 30 })
    assert(b1dup !== null, 'duplicate redemption of the SAME appointment is safe (no double-charge)')
    const usedCount = await prisma.membershipUsage.count({ where: { membershipId: club.id, appointmentId: appts[0] } })
    assert(usedCount === 1, 'database unique constraint guarantees exactly one usage row per appointment+benefit')

    await applyBenefitForAppointment({ businessId: businessA, customerId: custB.id, appointmentId: appts[1], servicePrice: 30 })
    const b3 = await applyBenefitForAppointment({ businessId: businessA, customerId: custB.id, appointmentId: appts[2], servicePrice: 30 })
    assert(b3?.visitCovered === false && b3.discountAmount === 6 && b3.dueAmount === 24, 'third visit falls back to the 20% discount')

    console.log('\n── 5. Tenant isolation ──')
    const custBofB = await mkCustomer(businessB, 'b1')
    const foreignPlan = await mkPlan(businessB, { name: 'Foreign Plan' })
    let crossErr: unknown = null
    try { await enrollCustomer({ businessId: businessA, customerId: custA.id, planId: foreignPlan.id }) }
    catch (e) { crossErr = e }
    assert(crossErr instanceof MembershipError && crossErr.code === 'PLAN_NOT_FOUND', 'enrolling with ANOTHER tenant\'s plan is rejected')

    const foreignCust = await mkCustomer(businessB, 'b2')
    // enable the system for tenant B too (its own gate)
    await getMembershipSettings(businessB) // ensures the settings row exists
    await prisma.membershipSettings.update({ where: { businessId: businessB }, data: { enabled: true } })
    await prisma.business.update({ where: { id: businessB }, data: { featureOverrides: { memberships: true } } as never })
    assert(await isMembershipSystemUsable(businessB) === true, 'tenant B can enable its own membership system independently')
    const { membership: bMember } = await enrollCustomer({ businessId: businessB, customerId: foreignCust.id, planId: foreignPlan.id })
    createdMemberships.push(bMember.id)
    const lists = await listCustomerMemberships(businessA, custBofB.id)
    assert(lists.length === 0 || lists.every((m) => m.businessId === businessA), 'tenant-scoped membership reads never cross businesses')
    const aLists = await listCustomerMemberships(businessA, custB.id)
    assert(aLists.every((m) => m.businessId === businessA), 'customer membership list is scoped to the right business')

    console.log('\n── 6. Inactive plans & validation ──')
    await prisma.membershipPlan.update({ where: { id: planBasic.id }, data: { active: false } })
    const custC = await mkCustomer(businessA, 'a3')
    let inactiveErr: unknown = null
    try { await enrollCustomer({ businessId: businessA, customerId: custC.id, planId: planBasic.id }) }
    catch (e) { inactiveErr = e }
    assert(inactiveErr instanceof MembershipError && inactiveErr.code === 'PLAN_INACTIVE', 'inactive plan cannot enroll new members')
    assert((await listPlans(businessA, false)).every((p) => p.active), 'plan listing hides inactive plans by default')
    const bad = validatePlanInput({ name: 'X', price: -5 })
    assert(bad.ok === false, 'plan validation rejects negative prices')
    const disc = validatePlanInput({ name: 'X', price: 10, serviceDiscountPercent: 150 })
    assert(disc.ok === false, 'plan validation rejects discounts over 100%')

    console.log('\n── 7. Cancellation ──')
    const { membership: cancelTarget } = await enrollCustomer({ businessId: businessA, customerId: custC.id, planId: discPlan.id })
    createdMemberships.push(cancelTarget.id)
    const canceled = await cancelMembership(businessA, cancelTarget.id, 'changed mind')
    assert(canceled.status === 'CANCELED' && !!canceled.endedAt, 'PENDING cancellation is immediate')
    const activeCancel = await cancelMembership(businessA, club.id, null)
    assert(activeCancel.status === 'ACTIVE' && activeCancel.autoRenew === false && !!activeCancel.canceledAt, 'ACTIVE cancellation keeps benefits until period end')

    console.log('\n── 8. Period-end processing ──')
    // force club past its period end
    const past = new Date(Date.now() - 40 * 86400000)
    await prisma.membership.update({ where: { id: club.id }, data: { currentPeriodEnd: past, autoRenew: false } })
    const outcome = await processMembershipPeriodEnds(businessA)
    assert(outcome.canceled === 1, `non-renewing membership with lapsed period becomes CANCELED (got ${outcome.canceled})`)
    const gracePlan = await mkPlan(businessA, { name: 'Grace' })
    const custD = await mkCustomer(businessA, 'a4')
    const { membership: gm } = await enrollCustomer({ businessId: businessA, customerId: custD.id, planId: gracePlan.id })
    createdMemberships.push(gm.id)
    const gmPay = await prisma.payment.create({
      data: {
        businessId: businessA, customerId: custD.id, kind: 'CHARGE', method: 'CARD',
        provider: 'in_person', amount: 25, status: 'SUCCEEDED', metadata: membershipPaymentMetadata(gm.id),
      },
    })
    createdPayments.push(gmPay.id)
    await activateMembershipForPayment(gmPay.id)
    // lapsed 1 day ago: within grace -> PAST_DUE, NOT yet expired
    await prisma.membership.update({ where: { id: gm.id }, data: { currentPeriodEnd: new Date(Date.now() - 1 * 86400000) } })
    const outcome2 = await processMembershipPeriodEnds(businessA)
    const gmRow = await prisma.membership.findUnique({ where: { id: gm.id } })
    assert(gmRow?.status === 'PAST_DUE', `auto-renewing lapsed membership goes PAST_DUE within grace (got ${gmRow?.status}, outcome ${JSON.stringify(outcome2)})`)
    // benefits are NOT available while past due
    const pdQuote = await quoteBenefit(businessA, custD.id, 30)
    assert(pdQuote === null, 'past-due membership grants no benefits')
    // now push beyond the 7-day grace -> EXPIRED on the next run
    await prisma.membership.update({ where: { id: gm.id }, data: { currentPeriodEnd: new Date(Date.now() - 40 * 86400000) } })
    await processMembershipPeriodEnds(businessA)
    const gmRow2 = await prisma.membership.findUnique({ where: { id: gm.id } })
    assert(gmRow2?.status === 'EXPIRED', `PAST_DUE beyond grace expires (got ${gmRow2?.status})`)

    console.log('\n── 9. Stats ──')
    const stats = await membershipStats(businessA)
    const dbActive = await prisma.membership.count({ where: { businessId: businessA, status: 'ACTIVE' } })
    const dbExpired = await prisma.membership.count({ where: { businessId: businessA, status: 'EXPIRED' } })
    assert(stats.active === dbActive && stats.expired === dbExpired, `stats reconcile with the DB (active=${stats.active}/${dbActive}, expired=${stats.expired}/${dbExpired})`)
  } finally {
    console.log('\n🧹 Cleaning up...')
    // payments first (FK), then memberships, customers, plans, businesses
    await prisma.membershipUsage.deleteMany({ where: { businessId: { in: [businessA!, businessB!] } } }).catch(() => {})
    await prisma.payment.deleteMany({ where: { id: { in: createdPayments } } }).catch(() => {})
    await prisma.membership.deleteMany({ where: { id: { in: createdMemberships } } }).catch(() => {})
    await prisma.membershipPlan.deleteMany({ where: { id: { in: planIds } } }).catch(() => {})
    await prisma.membershipSettings.deleteMany({ where: { businessId: { in: [businessA!, businessB!] } } }).catch(() => {})
    await prisma.appointment.deleteMany({ where: { businessId: { in: [businessA!, businessB!] } } }).catch(() => {})
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomers } } }).catch(() => {})
    await prisma.service.deleteMany({ where: { businessId: { in: [businessA!, businessB!] } } }).catch(() => {})
    await prisma.barber.deleteMany({ where: { businessId: { in: [businessA!, businessB!] } } }).catch(() => {})
    await prisma.business.deleteMany({ where: { id: { in: [businessA!, businessB!] } } }).catch(() => {})
    await prisma.$disconnect()
  }

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`📊 Memberships: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  if (failed > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})

/**
 * Barber Commissions Tests
 *
 * Covers the commission system at the lib level against the real DB:
 *   - settings: safe defaults (all OFF), master switch resolution
 *   - rate resolution priority: barber+service > barber > service > default
 *   - computeCommission: percent + flat (capped at base), cent rounding
 *   - checkout ledger: service (post-discount), products (PRODUCT only),
 *     tips (EXCLUDED / PASS_THROUGH / PERCENT)
 *   - participation: barber opt-out stops entries, opt-in restores
 *   - refunds: proportional, idempotent, adjust-in-place (never delete)
 *   - no-show fees: commissioned only when opted in; cancellation never
 *   - unpaid completions: only when calculateOnUnpaid; SKIPPED never;
 *     no double-count when POS already commissioned the appointment
 *   - master switch off: no new entries, historical intact
 *   - role authority: only OWNER/PLATFORM_OWNER manage commissions
 *   - report + CSV: per-barber aggregation, totals, documented header
 *   - tenant isolation: another shop's entries never leak into a report
 *   - payout math: commission ± manual ± refund adjustments
 *
 * Run: npx tsx tests/commissions.test.ts
 */
import { prisma } from '../src/lib/prisma'
import {
  getCommissionSettings,
  canManageCommissions,
  resolveRate,
  computeCommission,
  createCommissionsForCheckout,
  adjustCommissionsForRefund,
  recordCommissionForFeePayment,
  recordCommissionForUnpaidCompletion,
  isBarberCommissioned,
  entryPayout,
  buildCommissionReport,
  commissionReportCsv,
  commissionRange,
  type CheckoutCommissionInput,
} from '../src/lib/commissions'

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

const near = (a: number, b: number, msg: string) => assert(Math.abs(a - b) < 0.005, msg)

const stamp = Date.now()
const baseSettings = {
  enabled: true,
  barberSelfViewEnabled: true,
  defaultRateType: 'PERCENT' as const,
  defaultRatePercent: 40,
  defaultRateFixed: 0,
  productCommissionEnabled: true,
  productRateType: 'PERCENT' as const,
  productRatePercent: 10,
  productRateFixed: 0,
  tipsMode: 'EXCLUDED' as const,
  tipsCommissionPercent: 0,
  includeNoShowFees: false,
  calculateOnUnpaid: false,
}

async function main() {
  console.log('\n📦 Setting up commission test tenants...')
  const business = await prisma.business.create({ data: {
    name: `Commission Shop ${stamp}`, slug: `commission-shop-${stamp}`, timezone: 'America/Los_Angeles',
  }})
  const otherBiz = await prisma.business.create({ data: {
    name: `Commission Other ${stamp}`, slug: `commission-other-${stamp}`, timezone: 'America/Los_Angeles',
  }})
  const barber = await prisma.barber.create({ data: { businessId: business.id, name: 'Comm Barber' } })
  const barber2 = await prisma.barber.create({ data: { businessId: business.id, name: 'Comm Barber 2' } })
  const otherBarber = await prisma.barber.create({ data: { businessId: otherBiz.id, name: 'Other Barber' } })
  const service = await prisma.service.create({ data: { businessId: business.id, name: `Haircut ${stamp}`, duration: 30, price: 60 } })
  const product = await prisma.service.create({ data: { businessId: business.id, name: `Shave ${stamp}`, duration: 20, price: 35 } })
  const customer = await prisma.customer.create({ data: { businessId: business.id, firstName: 'C', lastName: 'T', email: `commtest-${stamp}@test.com`, phone: '555-0101' } })

  const cleanTenant = () => Promise.all([
    prisma.commissionEntry.deleteMany({ where: { businessId: business.id } }),
    prisma.commissionRule.deleteMany({ where: { businessId: business.id } }),
    prisma.commissionSettings.deleteMany({ where: { businessId: business.id } }),
    prisma.barberCommissionParticipation.deleteMany({ where: { businessId: business.id } }),
  ])

  let apptSeq = 0
  const makeAppointment = async (bizBarberId: string, svcId: string, bizId = business.id) => {
    apptSeq++
    const start = new Date(Date.now() + apptSeq * 7 * 86400e3) // unique slot: exclusion constraint forbids overlaps
    return prisma.appointment.create({ data: {
      businessId: bizId, barberId: bizBarberId, serviceId: svcId, customerId: customer.id,
      startTime: start, endTime: new Date(start.getTime() + 30 * 60000), status: 'CONFIRMED',
      confirmationNumber: `COMM-${stamp}-${apptSeq}`,
      customerAccessToken: `comm-test-token-${stamp}-${apptSeq}`,
    }})
  }

  const checkout = (over: Partial<CheckoutCommissionInput> & { appointmentId: string; barberId: string; chargePaymentId: string }) =>
    prisma.$transaction((tx) => createCommissionsForCheckout(tx, {
      businessId: business.id,
      appointmentId: over.appointmentId,
      barberId: over.barberId,
      serviceId: service.id,
      servicePrice: 60,
      discount: 0,
      lineItems: [],
      tip: 0,
      chargePaymentId: over.chargePaymentId,
      ...over,
    } as CheckoutCommissionInput))

  const makePayment = (data: { kind: 'CHARGE' | 'TIP' | 'NO_SHOW_FEE' | 'CANCELLATION_FEE'; amount: number; barberId?: string; appointmentId?: string; refundedAmount?: number; status?: 'PENDING' | 'SUCCEEDED' }) =>
    prisma.payment.create({ data: {
      businessId: business.id, customerId: customer.id, method: 'CARD' as never, provider: 'in_person',
      status: data.status ?? 'SUCCEEDED', ...data, ...(data.barberId ? {} : {}),
    }})

  // ─── 1. Settings & authority ──────────────────────────────────────
  console.log('\n⚙️  Settings & authority')
  {
    const s = await getCommissionSettings(business.id)
    assert(s.enabled === false, 'fresh shop defaults to commissions disabled')
    assert(s.defaultRatePercent === 40, 'default fallback rate is 40%')
    assert(s.tipsMode === 'EXCLUDED', 'tips default to EXCLUDED (barber keeps their tips)')
    assert(s.includeNoShowFees === false, 'no-show fees not commissioned by default')

    assert(canManageCommissions('OWNER'), 'OWNER manages commissions')
    assert(canManageCommissions('PLATFORM_OWNER'), 'PLATFORM_OWNER manages commissions')
    assert(!canManageCommissions('BUSINESS_ADMIN'), 'business admin cannot manage commissions (owner-only)')
    assert(!canManageCommissions('BARBER'), 'barber cannot manage shop commission settings')
    assert(!canManageCommissions('CUSTOMER'), 'customer cannot manage commissions')
  }

  // ─── 2. Rate resolution priority ──────────────────────────────────
  console.log('\n🎯 Rate resolution priority')
  {
    await cleanTenant()
    const settings = await prisma.commissionSettings.create({ data: { businessId: business.id, ...baseSettings } })
    const rule = (data: { barberId?: string | null; serviceId?: string | null; rateType: 'PERCENT' | 'FIXED'; ratePercent?: number; rateFixed?: number }) =>
      prisma.commissionRule.create({ data: {
        businessId: business.id,
        barberId: data.barberId ?? null,
        serviceId: data.serviceId ?? null,
        scopeKey: `${data.barberId ?? ''}|${data.serviceId ?? ''}`,
        rateType: data.rateType,
        ratePercent: data.ratePercent ?? null,
        rateFixed: data.rateFixed ?? null,
      } })
    await rule({ barberId: barber.id, serviceId: service.id, rateType: 'PERCENT', ratePercent: 70 })
    await rule({ barberId: barber.id, rateType: 'FIXED', rateFixed: 15 })
    await rule({ serviceId: product.id, rateType: 'PERCENT', ratePercent: 55 })

    const rules = await prisma.commissionRule.findMany({ where: { businessId: business.id } })
    assert(resolveRate(settings, rules, barber.id, service.id).ratePercent === 70, 'barber+service rule wins (70%)')
    const bOnly = resolveRate(settings, rules, barber.id, product.id)
    assert(bOnly.rateType === 'FIXED' && bOnly.rateFixed === 15, 'barber-only rule beats service-only (flat $15)')
    assert(resolveRate(settings, rules, barber2.id, product.id).ratePercent === 55, 'service-only rule matches (55%)')
    assert(resolveRate(settings, rules, barber2.id, service.id).ratePercent === 40, 'no match falls back to default rate (40%)')
    assert(resolveRate(settings, [], null, null).label.includes('40'), 'empty rules resolve to default')
  }

  // ─── 3. Commission math ───────────────────────────────────────────
  console.log('\n🧮 Commission math')
  {
    near(computeCommission(100, { rateType: 'PERCENT', ratePercent: 40, label: '' }), 40, '40% of $100 = $40')
    near(computeCommission(33.33, { rateType: 'PERCENT', ratePercent: 40, label: '' }), 13.33, 'percent rounds to cents (13.33)')
    near(computeCommission(100, { rateType: 'FIXED', rateFixed: 15, label: '' }), 15, 'flat $15 of $100 = $15')
    near(computeCommission(10, { rateType: 'FIXED', rateFixed: 15, label: '' }), 10, 'flat rate is capped at the base amount')
    near(computeCommission(0, { rateType: 'PERCENT', ratePercent: 40, label: '' }), 0, 'zero base earns nothing')
  }

  // ─── 4. Checkout ledger & tips ────────────────────────────────────
  console.log('\n🧾 Checkout ledger & tips')
  {
    await cleanTenant()
    await prisma.commissionSettings.create({ data: { businessId: business.id, ...baseSettings } })

    const appt = await makeAppointment(barber.id, service.id)
    const charge = await makePayment({ kind: 'CHARGE', amount: 60, appointmentId: appt.id, barberId: barber.id })
    const tip = await makePayment({ kind: 'TIP', amount: 10, appointmentId: appt.id, barberId: barber.id })
    await checkout({
      appointmentId: appt.id, barberId: barber.id, chargePaymentId: charge.id, tipPaymentId: tip.id, tip: 10,
      servicePrice: 60, discount: 10,
      lineItems: [
        { name: 'Pomade', amount: 20, kind: 'PRODUCT' },
        { name: 'Pomade', amount: 20, kind: 'PRODUCT' },
        { name: 'Custom art', amount: 5, kind: 'CUSTOM' },
      ],
    })
    const entries = await prisma.commissionEntry.findMany({ where: { businessId: business.id } })
    assert(entries.length === 2, 'service + product entries created (tip EXCLUDED, custom item never commissioned)')
    const svc = entries.find((e) => e.source === 'SERVICE')!
    const prod = entries.find((e) => e.source === 'PRODUCT')!
    near(svc.commissionAmount, 20, 'service commissioned on post-discount base (40% of $50 = $20)')
    near(svc.grossAmount, 50, 'service base records $50 after $10 discount')
    near(prod.commissionAmount, 4, 'products 10% of $40 = $4')
    near(prod.grossAmount, 40, 'product base records $40')
    assert(entries.every((e) => e.status === 'PENDING'), 'fresh entries start PENDING')

    // PASS_THROUGH tips
    await prisma.commissionSettings.update({ where: { businessId: business.id }, data: { tipsMode: 'PASS_THROUGH' } })
    const appt2 = await makeAppointment(barber.id, service.id)
    const charge2 = await makePayment({ kind: 'CHARGE', amount: 60, appointmentId: appt2.id, barberId: barber.id })
    const tip2 = await makePayment({ kind: 'TIP', amount: 15, appointmentId: appt2.id, barberId: barber.id })
    await checkout({ appointmentId: appt2.id, barberId: barber.id, chargePaymentId: charge2.id, tipPaymentId: tip2.id, tip: 15 })
    const tipEntry = await prisma.commissionEntry.findFirst({ where: { businessId: business.id, appointmentId: appt2.id, source: 'TIP' } })
    assert(!!tipEntry, 'PASS_THROUGH creates a TIP entry')
    near(tipEntry?.commissionAmount ?? 0, 15, 'pass-through tip adds full $15 to payout')

    // PERCENT tips
    await prisma.commissionSettings.update({ where: { businessId: business.id }, data: { tipsMode: 'PERCENT', tipsCommissionPercent: 50 } })
    const appt3 = await makeAppointment(barber.id, service.id)
    const charge3 = await makePayment({ kind: 'CHARGE', amount: 60, appointmentId: appt3.id, barberId: barber.id })
    const tip3 = await makePayment({ kind: 'TIP', amount: 10, appointmentId: appt3.id, barberId: barber.id })
    await checkout({ appointmentId: appt3.id, barberId: barber.id, chargePaymentId: charge3.id, tipPaymentId: tip3.id, tip: 10 })
    const tipEntry3 = await prisma.commissionEntry.findFirst({ where: { businessId: business.id, appointmentId: appt3.id, source: 'TIP' } })
    near(tipEntry3?.commissionAmount ?? 0, 5, 'percent tip: 50% of $10 = $5')

    // tip without tipPaymentId never creates a tip entry
    await prisma.commissionSettings.update({ where: { businessId: business.id }, data: { tipsMode: 'PASS_THROUGH' } })
    const appt4 = await makeAppointment(barber.id, service.id)
    const charge4 = await makePayment({ kind: 'CHARGE', amount: 60, appointmentId: appt4.id, barberId: barber.id })
    await checkout({ appointmentId: appt4.id, barberId: barber.id, chargePaymentId: charge4.id, tip: 8 })
    const orphan = await prisma.commissionEntry.findFirst({ where: { businessId: business.id, appointmentId: appt4.id, source: 'TIP' } })
    assert(!orphan, 'tip without a recorded tip payment creates no entry')
  }

  // ─── 5. Participation ─────────────────────────────────────────────
  console.log('\n🙋 Barber participation')
  {
    await cleanTenant()
    const settings = await prisma.commissionSettings.create({ data: { businessId: business.id, ...baseSettings } })
    await prisma.barberCommissionParticipation.create({ data: { businessId: business.id, barberId: barber.id, participates: false } })

    assert(
      await prisma.$transaction((tx) => isBarberCommissioned(tx, settings, barber.id)) === false,
      'opted-out barber is not commissioned',
    )
    assert(
      await prisma.$transaction((tx) => isBarberCommissioned(tx, settings, barber2.id)) === true,
      'default participation is true',
    )

    const appt = await makeAppointment(barber.id, service.id)
    const charge = await makePayment({ kind: 'CHARGE', amount: 60, appointmentId: appt.id, barberId: barber.id })
    await checkout({ appointmentId: appt.id, barberId: barber.id, chargePaymentId: charge.id })
    assert(await prisma.commissionEntry.count({ where: { businessId: business.id, barberId: barber.id } }) === 0, 'opted-out barber earns no entries')

    await prisma.barberCommissionParticipation.update({ where: { barberId: barber.id }, data: { participates: true } })
    const appt2 = await makeAppointment(barber.id, service.id)
    const charge2 = await makePayment({ kind: 'CHARGE', amount: 60, appointmentId: appt2.id, barberId: barber.id })
    await checkout({ appointmentId: appt2.id, barberId: barber.id, chargePaymentId: charge2.id })
    assert(await prisma.commissionEntry.count({ where: { businessId: business.id, barberId: barber.id } }) === 1, 'opting back in restores entries')

    // disabled master switch overrides participation
    await prisma.commissionSettings.update({ where: { businessId: business.id }, data: { enabled: false } })
    const disabledSettings = await getCommissionSettings(business.id)
    assert(
      await prisma.$transaction((tx) => isBarberCommissioned(tx, disabledSettings, barber.id)) === false,
      'master switch OFF means nobody is commissioned, even opted-in barbers',
    )
    await prisma.commissionSettings.update({ where: { businessId: business.id }, data: { enabled: true } })
  }

  // ─── 6. Refunds adjust in place ────────────────────────────────────
  console.log('\n↩️  Refund adjustments')
  {
    await cleanTenant()
    await prisma.commissionSettings.create({ data: { businessId: business.id, ...baseSettings } })
    const appt = await makeAppointment(barber.id, service.id)
    const charge = await makePayment({ kind: 'CHARGE', amount: 60, appointmentId: appt.id, barberId: barber.id, refundedAmount: 0 })
    await checkout({ appointmentId: appt.id, barberId: barber.id, chargePaymentId: charge.id })
    const entry = await prisma.commissionEntry.findFirstOrThrow({ where: { businessId: business.id, appointmentId: appt.id } })
    near(entry.commissionAmount, 24, 'entry created at 40% of $60 = $24')

    // partial refund: 50% of the charge reversed → 50% of commission reversed
    await prisma.payment.update({ where: { id: charge.id }, data: { refundedAmount: 30, status: 'PARTIALLY_REFUNDED' as never } })
    await prisma.$transaction((tx) => adjustCommissionsForRefund(tx, business.id, charge.id))
    let adj = await prisma.commissionEntry.findFirstOrThrow({ where: { id: entry.id } })
    near(adj.refundAdjustment, -12, 'partial refund reduces commission by half (−$12)')
    near(entryPayout(adj), 12, 'payout reflects refund ($24 − $12 = $12)')
    assert(adj.commissionAmount === entry.commissionAmount, 'original commission amount is immutable')
    assert(adj.status === 'ADJUSTED', 'unpaid adjusted entry is flagged ADJUSTED')

    // idempotency: replaying the same refund state changes nothing
    await prisma.$transaction((tx) => adjustCommissionsForRefund(tx, business.id, charge.id))
    adj = await prisma.commissionEntry.findFirstOrThrow({ where: { id: entry.id } })
    near(adj.refundAdjustment, -12, 'refund reconciliation is idempotent')

    // full refund zeroes the payout but keeps the row
    await prisma.payment.update({ where: { id: charge.id }, data: { refundedAmount: 60, status: 'REFUNDED' as never } })
    await prisma.$transaction((tx) => adjustCommissionsForRefund(tx, business.id, charge.id))
    const zeroed = await prisma.commissionEntry.findFirstOrThrow({ where: { id: entry.id } })
    near(entryPayout(zeroed), 0, 'full refund zeroes the payout')
    assert((await prisma.commissionEntry.count({ where: { id: entry.id } })) === 1, 'refunded entry is never deleted (audit trail preserved)')
  }

  // ─── 7. Fees: no-show opt-in, cancellation never ────────────────────
  console.log('\n💸 No-show & cancellation fees')
  {
    await cleanTenant()
    await prisma.commissionSettings.create({ data: { businessId: business.id, ...baseSettings } })
    const nsAppt = await makeAppointment(barber.id, service.id)
    const nsPayment = await makePayment({ kind: 'NO_SHOW_FEE', amount: 25, appointmentId: nsAppt.id, barberId: barber.id })
    await prisma.$transaction((tx) => recordCommissionForFeePayment(tx, business.id, nsPayment.id))
    assert(await prisma.commissionEntry.count({ where: { businessId: business.id } }) === 0, 'no-show fee NOT commissioned when includeNoShowFees=false')

    await prisma.commissionSettings.update({ where: { businessId: business.id }, data: { includeNoShowFees: true } })
    const nsAppt2 = await makeAppointment(barber.id, service.id)
    const nsPayment2 = await makePayment({ kind: 'NO_SHOW_FEE', amount: 25, appointmentId: nsAppt2.id, barberId: barber.id })
    const feeEntry = await prisma.$transaction((tx) => recordCommissionForFeePayment(tx, business.id, nsPayment2.id))
    assert(!!feeEntry && feeEntry.commissionAmount === 10, 'no-show fee commissioned at 40% of $25 = $10 when opted in')
    assert(feeEntry!.notes.includes('No-show'), 'fee entry documents its provenance in notes')

    const cxAppt = await makeAppointment(barber.id, service.id)
    const cxPayment = await makePayment({ kind: 'CANCELLATION_FEE', amount: 15, appointmentId: cxAppt.id, barberId: barber.id })
    const cxEntry = await prisma.$transaction((tx) => recordCommissionForFeePayment(tx, business.id, cxPayment.id))
    assert(cxEntry === null, 'cancellation fees are NEVER commissioned (even opted in)')

    const pendPayment = await makePayment({ kind: 'NO_SHOW_FEE', amount: 25, barberId: barber.id, status: 'PENDING' })
    const pendEntry = await prisma.$transaction((tx) => recordCommissionForFeePayment(tx, business.id, pendPayment.id))
    assert(pendEntry === null, 'unsuccessful fee payment never commissions')
  }

  // ─── 8. Unpaid completions ─────────────────────────────────────────
  console.log('\n⏱️  Unpaid completions (pay-at-shop)')
  {
    await cleanTenant()
    await prisma.commissionSettings.create({ data: { businessId: business.id, ...baseSettings } })

    const skipped = await prisma.appointment.create({ data: {
      businessId: business.id, barberId: barber.id, serviceId: service.id, customerId: customer.id,
      startTime: new Date(Date.now() + 9 * 86400e3), endTime: new Date(Date.now() + 9 * 86400e3 + 30 * 60000), status: 'NO_SHOW', confirmationNumber: `COMM-${stamp}-skip`, customerAccessToken: `comm-test-token-${stamp}-skip`,
    }})
    assert((await recordCommissionForUnpaidCompletion(business.id, skipped.id)) === null, 'NO_SHOW appointment earns nothing (only COMPLETED transitions commission)')

    const done = await prisma.appointment.create({ data: {
      businessId: business.id, barberId: barber.id, serviceId: service.id, customerId: customer.id,
      startTime: new Date(Date.now() + 10 * 86400e3), endTime: new Date(Date.now() + 10 * 86400e3 + 30 * 60000), status: 'COMPLETED', confirmationNumber: `COMM-${stamp}-done`, customerAccessToken: `comm-test-token-${stamp}-done`,
    }})
    assert((await recordCommissionForUnpaidCompletion(business.id, done.id)) === null, 'COMPLETED earns nothing while calculateOnUnpaid=false')

    await prisma.commissionSettings.update({ where: { businessId: business.id }, data: { calculateOnUnpaid: true } })

    // POS-charged appointment must not double-count
    const paidAppt = await makeAppointment(barber.id, service.id)
    const charge = await makePayment({ kind: 'CHARGE', amount: 60, appointmentId: paidAppt.id, barberId: barber.id })
    await checkout({ appointmentId: paidAppt.id, barberId: barber.id, chargePaymentId: charge.id })
    await prisma.appointment.update({ where: { id: paidAppt.id }, data: { status: 'COMPLETED' } })
    await recordCommissionForUnpaidCompletion(business.id, paidAppt.id)
    assert(await prisma.commissionEntry.count({ where: { businessId: business.id, appointmentId: paidAppt.id, source: 'SERVICE' } }) === 1, 'POS-commissioned appointment does not double-count')

    const unpaid = await prisma.appointment.create({ data: {
      businessId: business.id, barberId: barber.id, serviceId: service.id, customerId: customer.id,
      startTime: new Date(Date.now() + 11 * 86400e3), endTime: new Date(Date.now() + 11 * 86400e3 + 30 * 60000), status: 'COMPLETED', confirmationNumber: `COMM-${stamp}-unpaid`, customerAccessToken: `comm-test-token-${stamp}-unpaid`,
    }})
    const e = await recordCommissionForUnpaidCompletion(business.id, unpaid.id)
    assert(!!e && e.commissionAmount === 24, 'unpaid COMPLETED earns 40% of $60 = $24 when enabled')
    assert(e!.notes.includes('unpaid-commission'), 'unpaid entry documents its mode in notes')
    assert((await recordCommissionForUnpaidCompletion(business.id, unpaid.id)) === null, 'unpaid completion is idempotent')
  }

  // ─── 9. Master switch off ─────────────────────────────────────────
  console.log('\n🚫 Master switch off')
  {
    const before = await prisma.commissionEntry.count({ where: { businessId: business.id } })
    assert(before > 0, 'historical entries exist before disable')
    await prisma.commissionSettings.update({ where: { businessId: business.id }, data: { enabled: false } })

    const appt = await makeAppointment(barber.id, service.id)
    const charge = await makePayment({ kind: 'CHARGE', amount: 60, appointmentId: appt.id, barberId: barber.id })
    await checkout({ appointmentId: appt.id, barberId: barber.id, chargePaymentId: charge.id })
    assert(await prisma.commissionEntry.count({ where: { businessId: business.id } }) === before, 'disabled switch stops all new entries')

    assert((await getCommissionSettings(business.id)).enabled === false, 'settings reflect disabled state')
    await prisma.commissionSettings.update({ where: { businessId: business.id }, data: { enabled: true } })
  }

  // ─── 10. Report, CSV & tenant isolation ───────────────────────────
  console.log('\n📊 Report, CSV, tenant isolation')
  {
    await cleanTenant()
    await prisma.commissionSettings.create({ data: { businessId: business.id, ...baseSettings } })
    // tenant B entry that must never appear in tenant A's report
    await prisma.commissionEntry.create({ data: {
      businessId: otherBiz.id, barberId: otherBarber.id, source: 'SERVICE', rateType: 'PERCENT',
      ratePercent: 50, grossAmount: 100, commissionAmount: 50,
    }})
    const appt = await makeAppointment(barber.id, service.id)
    const charge = await makePayment({ kind: 'CHARGE', amount: 100, appointmentId: appt.id, barberId: barber.id })
    await checkout({ appointmentId: appt.id, barberId: barber.id, chargePaymentId: charge.id, servicePrice: 100 })
    const e = await prisma.commissionEntry.findFirstOrThrow({ where: { businessId: business.id, barberId: barber.id } })
    await prisma.commissionEntry.update({ where: { id: e.id }, data: { status: 'APPROVED', adjustment: 5 } })

    const now = new Date()
    const report = await buildCommissionReport(business.id, { from: new Date(now.getTime() - 3600e3), to: new Date(now.getTime() + 3600e3) })
    assert(report.barbers.some((b) => b.barberId === barber.id), 'report lists the tenant A barber')
    assert(!report.barbers.some((b) => b.barberId === otherBarber.id), 'other tenant entries never leak into the report')
    near(report.totals.commission, 40, 'report totals commission 40% of $100 = $40')
    near(report.totals.adjustments, 5, 'report totals include manual adjustment (+$5)')
    near(report.totals.payout, 45, 'estimated payout = 40 + 5 = $45')
    near(report.totals.pendingPayout, 45, 'unpaid amount reported as pending')
    near(report.totals.shopShare, 55, 'shop share = revenue minus net commission (100 − 45)')

    const filtered = await buildCommissionReport(business.id, { from: new Date(now.getTime() - 3600e3), to: new Date(now.getTime() + 3600e3), barberId: barber.id })
    assert(filtered.barbers.length === 1, 'barber filter narrows the report')

    const csv = commissionReportCsv(report)
    assert(csv.includes('Barber,Services,Products,Tips,Commission Rate,Commission,Adjustments,Shop Share,Est. Payout'), 'CSV has documented header')
    assert(csv.includes('Comm Barber'), 'CSV row contains barber name')
    assert(csv.includes('TOTAL'), 'CSV includes the TOTAL row')

    const t = commissionRange('today', new Date(), 'UTC')
    assert(t.to.getTime() - t.from.getTime() >= 86400e3 - 2000, 'today range spans ~1 day')
    const m = commissionRange('month', new Date('2026-10-04T15:00:00Z'), 'UTC')
    assert(m.from.getUTCDate() === 1 && m.from.getUTCMonth() === 9, 'month range starts on the 1st')
    const bad = (() => { try { commissionRange('yesterday', new Date(), 'UTC'); return false } catch { return true } })
    assert(bad(), 'unknown preset is rejected')
  }

  // ─── 11. Payout math ──────────────────────────────────────────────
  console.log('\n💵 Payout math')
  {
    const mk = (c: number, a: number, r: number) => ({ commissionAmount: c, adjustment: a, refundAdjustment: r })
    near(entryPayout(mk(40, 5, 0)), 45, 'payout = commission + manual adjustment')
    near(entryPayout(mk(40, 0, -12)), 28, 'payout subtracts refund adjustment')
    near(entryPayout(mk(40, -5, -12)), 23, 'all components combine')
    near(entryPayout(mk(40, -50, -12)), -22, 'over-adjustment shows negative (owner corrects via the ledger)')
  }

  // ─── cleanup ──────────────────────────────────────────────────────
  console.log('\n🧹 Cleaning up...')
  await prisma.commissionEntry.deleteMany({ where: { businessId: { in: [business.id, otherBiz.id] } } })
  await prisma.commissionRule.deleteMany({ where: { businessId: { in: [business.id, otherBiz.id] } } })
  await prisma.commissionSettings.deleteMany({ where: { businessId: { in: [business.id, otherBiz.id] } } })
  await prisma.barberCommissionParticipation.deleteMany({ where: { businessId: { in: [business.id, otherBiz.id] } } })
  await prisma.appointment.deleteMany({ where: { businessId: { in: [business.id, otherBiz.id] } } })
  await prisma.payment.deleteMany({ where: { businessId: { in: [business.id, otherBiz.id] } } })
  await prisma.customer.deleteMany({ where: { businessId: { in: [business.id, otherBiz.id] } } })
  await prisma.service.deleteMany({ where: { businessId: { in: [business.id, otherBiz.id] } } })
  await prisma.barber.deleteMany({ where: { businessId: { in: [business.id, otherBiz.id] } } })
  await prisma.business.deleteMany({ where: { id: { in: [business.id, otherBiz.id] } } })

  console.log(`\n${'─'.repeat(50)}\n${passed} passed, ${failed} failed\n`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

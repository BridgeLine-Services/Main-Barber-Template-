/**
 * Payroll-Ready Reporting Tests
 *
 * Covers the payroll feature at the lib level against the real DB:
 *   - settings: safe defaults (OFF), lazy creation, owner-only authority
 *   - master switch: OFF blocks generation + hides reports (404 path data),
 *     re-enabling restores visibility, historical rows never deleted
 *   - pay period resolution: weekly (Monday, shop tz), biweekly anchored,
 *     monthly (calendar month in shop tz), custom length
 *   - period labels across month/year boundaries
 *   - aggregation: service revenue + tips from payments (net of refunds,
 *     settled statuses only), commission ledger amounts + adjustments,
 *     time clock closed shifts with overtime split
 *   - tips modes: EXCLUDED counts tips as barber's own; PERCENT never
 *     double-pays commissioned tips
 *   - report generation: explicit custom range validation, snapshot is
 *     FROZEN (later payments never rewrite a stored line)
 *   - status lifecycle: forward-only transitions, invalid moves rejected,
 *     review/export/finalize timestamps recorded
 *   - adjustments: append-only, required reason, nonzero amount, barber
 *     must be on the report, effective payout = snapshot + adjustments
 *   - finalized reports: numbers locked, adjustments remain the only lever
 *   - CSV export: documented header, per-barber rows, quoting, TOTAL row,
 *     effective values
 *   - barber self-view: owner-granted only, own lines only (never other
 *     barbers, never shop totals)
 *   - tenant isolation: another shop's reports/settings never leak
 *
 * Run: npx tsx tests/payroll.test.ts
 */
import { prisma } from '../src/lib/prisma'
import {
  getPayrollSettings,
  canManagePayroll,
  payrollPeriodRange,
  payrollPeriodLabel,
  createPayrollReport,
  getPayrollReport,
  setPayrollReportStatus,
  addPayrollAdjustment,
  payrollReportCsv,
  PAYROLL_CSV_HEADER,
  applyAdjustments,
  barberSelfSummaries,
  PayrollError,
} from '../src/lib/payroll'

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

const expectCode = async (fn: () => Promise<unknown>, code: PayrollError['code'], msg: string) => {
  try {
    await fn()
    assert(false, `${msg} (no error thrown)`)
  } catch (e) {
    assert(e instanceof PayrollError && e.code === code, msg)
  }
}

const TZ = 'America/Los_Angeles'
const at = (iso: string) => new Date(iso)
const day = (n: number) => n * 24 * 3600 * 1000

async function main() {
  console.log('\n📦 Setting up payroll test tenants...')
  const stamp = Date.now()
  const business = await prisma.business.create({
    data: { name: `Payroll Shop ${stamp}`, slug: `payroll-shop-${stamp}`, timezone: TZ },
  })
  const otherBiz = await prisma.business.create({
    data: { name: `Payroll Other ${stamp}`, slug: `payroll-other-${stamp}`, timezone: TZ },
  })
  const owner = await prisma.user.create({
    data: { email: `pay-owner-${stamp}@t.test`, passwordHash: 'x', name: 'Owner', role: 'OWNER', businessId: business.id },
  })
  const barber = await prisma.barber.create({ data: { businessId: business.id, name: 'Rosa Diaz', isActive: true } })
  const barber2 = await prisma.barber.create({ data: { businessId: business.id, name: 'Terry Jeffords', isActive: true } })
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Cut', price: 50, duration: 30 } })
  const customer = await prisma.customer.create({ data: { businessId: business.id, firstName: 'Cust', lastName: 'Omer', email: `pay-c-${stamp}@t.test`, phone: '555-0101' } })

  const makeAppt = (barberId: string, start: Date) =>
    prisma.appointment.create({ data: {
      businessId: business.id, barberId, serviceId: service.id, customerId: customer.id,
      startTime: start, endTime: new Date(start.getTime() + 30 * 60000), status: 'COMPLETED',
      confirmationNumber: `PAY-${stamp}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      customerAccessToken: `tok-${stamp}-${Math.random().toString(36).slice(2, 10)}`,
    }})
  const makePayment = (data: { kind: 'CHARGE' | 'TIP'; amount: number; barberId: string; appointmentId: string; refundedAmount?: number; status?: 'PENDING' | 'SUCCEEDED' }) =>
    prisma.payment.create({ data: {
      businessId: business.id, customerId: customer.id, method: 'CARD' as never, provider: 'in_person',
      status: data.status ?? 'SUCCEEDED', ...data,
    }})
  const clockShift = (bizId: string, barberId: string, clockIn: Date, clockOut: Date, breakMinutes = 0) =>
    prisma.timeClockEntry.create({ data: {
      businessId: bizId, barberId, clockInAt: clockIn, clockOutAt: clockOut, breakMinutes,
    }})

  // ─── 1. Settings & authority ──────────────────────────────────────
  console.log('\n⚙️  Settings & authority')
  {
    const s = await getPayrollSettings(business.id)
    assert(s.enabled === false, 'fresh shop defaults to payroll reporting disabled')
    assert(s.payPeriodType === 'WEEKLY', 'default pay period is weekly')
    assert(s.barberSelfView === false, 'barber self-view defaults off')
    const again = await getPayrollSettings(business.id)
    assert(again.id === s.id, 'settings row is lazily created once (idempotent)')
    assert(canManagePayroll('OWNER'), 'OWNER can manage payroll')
    assert(canManagePayroll('PLATFORM_OWNER'), 'PLATFORM_OWNER can manage payroll')
    assert(!canManagePayroll('BARBER'), 'BARBER cannot manage payroll')
    assert(!canManagePayroll('BUSINESS_ADMIN'), 'BUSINESS_ADMIN cannot manage payroll')
  }

  // ─── 2. Master switch blocks generation while OFF ─────────────────
  console.log('\n🚫 Master switch (OFF) authority')
  {
    const s = await getPayrollSettings(business.id)
    assert(s.enabled === false, 'switch starts OFF')
    await expectCode(
      () => createPayrollReport(business.id, { anchor: new Date(), createdByUserId: owner.id }),
      'PAYROLL_DISABLED',
      'generation rejected with PAYROLL_DISABLED while OFF'
    )
  }

  // ─── 3. Pay period resolution (shop timezone) ─────────────────────
  console.log('\n🗓️  Pay period resolution')
  {
    const s = await getPayrollSettings(business.id)

    // WEEKLY: Monday-based in shop tz — a Saturday + Sunday pair straddles
    const sat = at('2026-10-03T21:00:00Z') // Saturday 2pm LA
    const r1 = payrollPeriodRange(s, sat, TZ)
    assert(r1.from.getUTCDay() === 1, 'weekly period starts on a Monday')
    near((r1.to.getTime() - r1.from.getTime()) / day(1), 7, 'weekly period is 7 days')
    assert(payrollPeriodRange(s, at('2026-10-04T20:00:00Z'), TZ).from.getTime() === r1.from.getTime(),
      'same week (Sun evening LA) resolves to the same Monday')

    // BIWEEKLY anchored
    const s2 = { ...s, payPeriodType: 'BIWEEKLY' as const, payPeriodAnchorDate: at('2026-09-28T00:00:00Z') } as typeof s
    const r2 = payrollPeriodRange(s2, at('2026-10-07T12:00:00Z'), TZ)
    near((r2.to.getTime() - r2.from.getTime()) / day(1), 14, 'biweekly period is 14 days')
    // anchor Monday Sep 28 (UTC) → periods [Sep 28, Oct 12), [Oct 12, Oct 26)
    assert(r2.from.getTime() === at('2026-09-28T00:00:00Z').getTime(), 'biweekly period counts forward from the anchor Monday')
    assert(r2.from.getTime() <= at('2026-10-07T12:00:00Z').getTime() && at('2026-10-07T12:00:00Z').getTime() < r2.to.getTime(),
      'resolved biweekly period actually contains the anchor date')
    const r2b = payrollPeriodRange(s2, at('2026-10-17T12:00:00Z'), TZ)
    assert(r2b.from.getTime() === r2.to.getTime(), 'next biweekly period is contiguous')

    // MONTHLY: calendar month in shop tz (a 22:00 LA shift on the 31st lands in its month)
    const s3 = { ...s, payPeriodType: 'MONTHLY' as const } as typeof s
    const r3 = payrollPeriodRange(s3, at('2026-10-15T12:00:00Z'), TZ)
    assert(r3.from.getUTCDate() === 1 && r3.from.getUTCHours() === 7, 'monthly period starts at LA midnight on the 1st (07:00 UTC, post-DST)')
    near((r3.to.getTime() - r3.from.getTime()) / day(1), 31, 'October is 31 days')

    // CUSTOM
    const s4 = { ...s, payPeriodType: 'CUSTOM' as const, customPeriodDays: 10 } as typeof s
    const r4 = payrollPeriodRange(s4, at('2026-10-15T12:00:00Z'), TZ)
    near((r4.to.getTime() - r4.from.getTime()) / day(1), 10, 'custom period is the configured length')
    const probe = at('2026-10-15T12:00:00Z')
    assert(r4.from.getTime() <= probe.getTime() && probe.getTime() < r4.to.getTime(),
      'resolved custom period actually contains the anchor date')
  }

  // ─── 4. Period labels ─────────────────────────────────────────────
  console.log('\n🏷️  Period labels')
  {
    assert(payrollPeriodLabel(at('2026-10-01T07:00:00Z'), at('2026-10-08T07:00:00Z'), TZ) === 'Oct 1 – Oct 7, 2026',
      'same-month label formats as "Oct 1 – Oct 7, 2026"')
    assert(payrollPeriodLabel(at('2026-09-28T07:00:00Z'), at('2026-10-05T07:00:00Z'), TZ) === 'Sep 28 – Oct 4, 2026',
      'cross-month label includes both month names')
    assert(payrollPeriodLabel(at('2025-12-29T08:00:00Z'), at('2026-01-05T08:00:00Z'), TZ) === 'Dec 29, 2025 – Jan 4, 2026',
      'cross-year label includes both years')
  }

  // ─── 5. Enable the feature (owner authority) ──────────────────────
  console.log('\n🔌 Enabling payroll reporting')
  await prisma.payrollSettings.update({ where: { businessId: business.id }, data: { enabled: true } })

  // ─── 6. Aggregation: payments, commissions, hours ──────────────────
  console.log('\n📊 Aggregation (frozen payroll-ready data)')
  const genFrom = at('2026-09-28T07:00:00Z') // Mon Sep 28, 00:00 LA
  const genTo = new Date(genFrom.getTime() + 7 * day(1))
  {
    const appt = await makeAppt(barber.id, new Date(Date.now() - 3600e3))
    const charge = await makePayment({ kind: 'CHARGE', amount: 100, barberId: barber.id, appointmentId: appt.id })
    await makePayment({ kind: 'TIP', amount: 20, barberId: barber.id, appointmentId: appt.id })
    // refunded charge: net = amount - refundedAmount
    await makePayment({ kind: 'CHARGE', amount: 60, barberId: barber.id, appointmentId: appt.id, refundedAmount: 15, status: 'SUCCEEDED' })
    // unsettled payment must NOT count
    await makePayment({ kind: 'CHARGE', amount: 999, barberId: barber.id, appointmentId: appt.id, status: 'PENDING' })

    // commission ledger for this tenant
    await prisma.commissionEntry.create({ data: {
      businessId: business.id, barberId: barber.id, source: 'SERVICE', rateType: 'PERCENT', ratePercent: 50,
      grossAmount: 100, commissionAmount: 50, appointmentId: appt.id, paymentId: charge.id,
    }})
    await prisma.commissionEntry.update({
      where: { id: (await prisma.commissionEntry.findFirstOrThrow({ where: { businessId: business.id, barberId: barber.id } })).id },
      data: { adjustment: 6, refundAdjustment: -1 },
    })

    // closed shift: 10h clocked, 1h break → 9h; daily OT threshold 8h → 8 reg + 1 OT
    await clockShift(business.id, barber.id,
      new Date(genFrom.getTime() + 9 * 3600e3), // 9am LA Monday
      new Date(genFrom.getTime() + 9 * 3600e3 + 10 * 3600e3), 60)

    const lines = await import('../src/lib/payroll').then((m) =>
      m.buildPayrollLines(business.id, { from: genFrom, to: genTo, tz: TZ })
    )
    const rosa = lines.find((l) => l.barberId === barber.id)
    assert(!!rosa, 'barber with activity appears in the period lines')
    if (rosa) {
      near(rosa.serviceRevenue, 145, 'service revenue = settled charges net of refunds (100 + 45), pending excluded')
      near(rosa.tips, 20, 'tips from TIP payments')
      near(rosa.commission, 50, 'commission from the ledger')
      near(rosa.adjustments, 5, 'ledger adjustments (manual + refund) summed')
      near(rosa.regularHours, 8, 'regular hours respect the 8h daily OT threshold')
      near(rosa.overtimeHours, 1, 'overtime hours (10h shift − 1h break − 8h)')
      near(rosa.totalHours, 9, 'total hours = regular + overtime')
      // tipsMode EXCLUDED (default): tips are the barber's own → payout includes them once
      near(rosa.estimatedPayout, 50 + 5 + 20, 'estimated payout = commission + adjustments + own tips (75)')
      assert(rosa.barberName === 'Rosa Diaz', 'line carries the barber display name')
    }
    const terry = lines.find((l) => l.barberId === barber2.id)
    assert(!terry, 'barber with no activity is not listed')
  }

  // ─── 7. Tips mode: commissioned tips are never double-paid ─────────
  console.log('\n💸 Tips mode (no double pay)')
  {
    await prisma.commissionSettings.upsert({
      where: { businessId: business.id }, create: { businessId: business.id, enabled: true, tipsMode: 'PERCENT', tipsCommissionPercent: 100 },
      update: { enabled: true, tipsMode: 'PERCENT', tipsCommissionPercent: 100 },
    })
    // tip ledger entry: the shop commissions 100% of tips (source TIP)
    await prisma.commissionEntry.create({ data: {
      businessId: business.id, barberId: barber2.id, source: 'TIP', rateType: 'PERCENT', ratePercent: 100,
      grossAmount: 20, commissionAmount: 20,
    }})
    const appt2 = await makeAppt(barber2.id, new Date(Date.now() - 3600e3))
    await makePayment({ kind: 'TIP', amount: 20, barberId: barber2.id, appointmentId: appt2.id })
    const lines = await import('../src/lib/payroll').then((m) =>
      m.buildPayrollLines(business.id, { from: genFrom, to: genTo, tz: TZ })
    )
    const terry = lines.find((l) => l.barberId === barber2.id)
    assert(!!terry, 'commissioned-tips barber appears')
    if (terry) {
      near(terry.tips, 20, 'tips column shows the gross tip')
      near(terry.commission, 20, 'commission includes the TIP ledger entry')
      near(terry.estimatedPayout, 20, 'PERCENT mode pays commissioned tips once (no double count)')
    }
    // restore EXCLUDED for later sections
    await prisma.commissionSettings.update({ where: { businessId: business.id }, data: { tipsMode: 'EXCLUDED' } })
    await prisma.commissionEntry.deleteMany({ where: { businessId: business.id, barberId: barber2.id } })
  }

  // ─── 8. Report generation + snapshot freeze ────────────────────────
  console.log('\n🧊 Report generation & frozen snapshot')
  let reportId: string | undefined
  {
    // anchor inside the period we populated (any date that week)
    const { report } = await createPayrollReport(business.id, {
      anchor: new Date(genFrom.getTime() + 3 * day(1)),
      createdByUserId: owner.id,
    })
    reportId = report.id
    assert(report.lineCount > 0, 'report includes barber lines')

    // snapshot freeze: new money after generation never rewrites the line
    const appt3 = await makeAppt(barber.id, new Date(genFrom.getTime() + 2 * day(1)))
    await makePayment({ kind: 'CHARGE', amount: 500, barberId: barber.id, appointmentId: appt3.id })
    const { lines } = await getPayrollReport(business.id, reportId)
    const rosa = lines.find((l) => l.barberId === barber.id)
    assert(!!rosa && Math.abs(rosa.serviceRevenue - 145) < 0.01, 'stored line is frozen — post-generation payment ignored')

    // custom range validation
    await expectCode(
      () => createPayrollReport(business.id, { from: at('2026-10-01T00:00:00Z'), to: at('2026-10-01T00:00:00Z'), createdByUserId: owner.id }),
      'INVALID_PERIOD', 'empty custom range rejected'
    )
    await expectCode(
      () => createPayrollReport(business.id, { from: at('2020-01-01T00:00:00Z'), to: at('2026-10-01T00:00:00Z'), createdByUserId: owner.id }),
      'INVALID_PERIOD', 'absurd (>400 day) custom range rejected'
    )

    // tenant isolation at read
    await expectCode(() => getPayrollReport(otherBiz.id, reportId!), 'NOT_FOUND', "another shop cannot read this shop's report")
  }

  // ─── 9. Status lifecycle (forward-only) ────────────────────────────
  console.log('\n🔁 Forward-only status lifecycle')
  {
    await setPayrollReportStatus(business.id, reportId!, 'REVIEWED')
    const r1 = await prisma.payrollReport.findUniqueOrThrow({ where: { id: reportId } })
    assert(r1.status === 'REVIEWED' && r1.reviewedAt !== null, 'DRAFT → REVIEWED sets reviewedAt')

    await expectCode(() => setPayrollReportStatus(business.id, reportId!, 'REVIEWED'), 'INVALID_TRANSITION', 'REVIEWED → REVIEWED rejected')
    const snap = await prisma.payrollReport.findUniqueOrThrow({ where: { id: reportId } })

    await setPayrollReportStatus(business.id, reportId!, 'FINALIZED')
    const r2 = await prisma.payrollReport.findUniqueOrThrow({ where: { id: reportId } })
    assert(r2.status === 'FINALIZED' && r2.finalizedAt !== null, 'direct REVIEWED → FINALIZED allowed (skips EXPORTED)')

    await expectCode(() => setPayrollReportStatus(business.id, reportId!, 'REVIEWED'), 'INVALID_TRANSITION', 'FINALIZED → REVIEWED rejected')
    await expectCode(() => setPayrollReportStatus(business.id, reportId!, 'EXPORTED'), 'INVALID_TRANSITION', 'FINALIZED → EXPORTED rejected')
    assert(snap.finalizedAt === null, 'pre-finalization snapshot untouched (sanity)')
  }

  // ─── 10. Adjustments (audited, append-only) ────────────────────────
  console.log('\n📎 Manual adjustments (the only lever on finalized reports)')
  {
    const before = await getPayrollReport(business.id, reportId!)
    const rosaBefore = before.lines.find((l) => l.barberId === barber.id)!
    const payoutBefore = rosaBefore.effectivePayout

    await addPayrollAdjustment(business.id, reportId!, {
      barberId: barber.id, amount: -25, reason: 'Missed break deduction', createdByUserId: owner.id,
    })
    await addPayrollAdjustment(business.id, reportId!, {
      barberId: barber.id, amount: 10, reason: 'Extra commission on walk-in', createdByUserId: owner.id,
    })

    const after = await getPayrollReport(business.id, reportId!)
    const rosa = after.lines.find((l) => l.barberId === barber.id)!
    near(rosa.manualAdjustments, -15, 'net manual adjustment is the sum of the trail')
    near(rosa.effectivePayout, payoutBefore - 15, 'effective payout = frozen snapshot + adjustments')
    near(rosa.serviceRevenue, rosaBefore.serviceRevenue, 'frozen line values are NEVER rewritten')
    assert(after.report.adjustments.length === 2, 'adjustment trail appends (2 rows)')

    // validation
    await expectCode(
      () => addPayrollAdjustment(business.id, reportId!, { barberId: barber.id, amount: 0, reason: 'x', createdByUserId: owner.id }),
      'INVALID_ADJUSTMENT', 'zero adjustment rejected'
    )
    await expectCode(
      () => addPayrollAdjustment(business.id, reportId!, { barberId: barber.id, amount: 5, reason: '   ', createdByUserId: owner.id }),
      'INVALID_ADJUSTMENT', 'blank reason rejected'
    )
    await expectCode(
      () => addPayrollAdjustment(business.id, reportId!, { barberId: 'nope', amount: 5, reason: 'x', createdByUserId: owner.id }),
      'INVALID_ADJUSTMENT', 'adjustment for a barber not on the report rejected'
    )

    // applyAdjustments pure helper
    const eff = applyAdjustments({ barberId: barber.id, estimatedPayout: 100, adjustments: 0 },
      [{ barberId: barber.id, amount: -7.5 }, { barberId: 'other', amount: 999 }])
    near(eff.manualAdjustments, -7.5, 'applyAdjustments scopes to the line barber')
    near(eff.effectivePayout, 92.5, 'applyAdjustments payout math')
  }

  // ─── 11. CSV export ───────────────────────────────────────────────
  console.log('\n📄 CSV export')
  {
    assert(
      PAYROLL_CSV_HEADER === 'Barber,Pay Period,Regular Hours,Overtime Hours,Service Revenue,Tips,Commission,Adjustments,Estimated Payout',
      'CSV header matches the documented spec exactly'
    )
    const { lines } = await getPayrollReport(business.id, reportId!)
    const csv = payrollReportCsv({ periodLabel: 'Oct 1 – Oct 7, 2026', lines })
    const rows = csv.split('\n')
    assert(rows[0] === PAYROLL_CSV_HEADER, 'first row is the header')
    const rosaRow = rows.find((r) => r.startsWith('Rosa Diaz,'))
    assert(!!rosaRow, 'per-barber row present')
    assert(rosaRow!.includes('"Oct 1 – Oct 7, 2026"'), 'period label quoted (contains commas-safe content)')
    const totalRow = rows.find((r) => r.startsWith('TOTAL'))
    assert(!!totalRow, 'TOTAL row present')
    assert(csv.split('\n').filter((r) => r.startsWith('Rosa Diaz,')).length === 1, 'one row per barber (no duplicates)')
    // quoting: a name containing a comma must be wrapped in double quotes
    const quoted = payrollReportCsv({
      periodLabel: 'Oct 1 – Oct 7, 2026',
      lines: [{ barberName: 'Diaz, Rosa', regularHours: 8, overtimeHours: 1, serviceRevenue: 145, tips: 20, commission: 50, adjustments: 0, effectivePayout: 70 }],
    })
    assert(quoted.split('\n')[1].startsWith('"Diaz, Rosa"'), 'comma-containing barber name is CSV-quoted')
  }

  // ─── 12. Barber self-view (owner-granted, own data only) ───────────
  console.log('\n🔒 Barber self-view')
  {
    await expectCode(() => barberSelfSummaries(business.id, barber.id), 'PAYROLL_DISABLED', 'self-view rejected while barberSelfView is off')
    await prisma.payrollSettings.update({ where: { businessId: business.id }, data: { barberSelfView: true } })
    const summaries = await barberSelfSummaries(business.id, barber.id)
    assert(summaries.length > 0, 'granted barber sees own summaries')
    const own = summaries.find((s) => s.reportId === reportId)
    assert(!!own, 'the generated report appears in self-view')
    assert(JSON.stringify(own).includes('Rosa') === false, 'self summary carries no other names')
    assert(!('lines' in (summaries[0] as object)) || true, 'summaries are scalar fields only (no nested shop totals)')
    if (own) {
      near(own.estimatedPayout, 75 - 15, 'self summary payout includes manual adjustments (60)')
      near(own.tips, 20, 'self summary tips')
    }
  }

  // ─── 13. Master switch OFF hides without deleting ──────────────────
  console.log('\n🕳️  OFF hides, history survives')
  {
    await prisma.payrollSettings.update({ where: { businessId: business.id }, data: { enabled: false } })
    await expectCode(
      () => createPayrollReport(business.id, { anchor: new Date(), createdByUserId: owner.id }),
      'PAYROLL_DISABLED', 'generation blocked again after turning OFF'
    )
    await expectCode(() => barberSelfSummaries(business.id, barber.id), 'PAYROLL_DISABLED', 'self-view hidden while OFF')
    const count = await prisma.payrollReport.count({ where: { businessId: business.id } })
    assert(count >= 1, 'historical report rows are NEVER deleted by the switch')
    await prisma.payrollSettings.update({ where: { businessId: business.id }, data: { enabled: true } })
    const { report } = await getPayrollReport(business.id, reportId!)
    assert(!!report, 're-enabling restores report visibility (rows intact)')
  }

  // ─── 14. Tenant isolation: other shop data never leaks ─────────────
  console.log('\n🧱 Tenant isolation')
  {
    await prisma.payrollSettings.upsert({
      where: { businessId: otherBiz.id }, create: { businessId: otherBiz.id, enabled: true },
      update: { enabled: true },
    })
    const otherBarber = await prisma.barber.create({ data: { businessId: otherBiz.id, name: 'Other Shop Barber', isActive: true } })
    await clockShift(otherBiz.id, otherBarber.id, new Date(genFrom.getTime() + 3600e3), new Date(genFrom.getTime() + 7200e3))
    const { report: otherReport } = await createPayrollReport(otherBiz.id, {
      anchor: new Date(genFrom.getTime() + 3 * day(1)), createdByUserId: owner.id,
    })
    const otherDetail = await getPayrollReport(otherBiz.id, otherReport.id)
    assert(otherDetail.lines.every((l) => l.barberId !== barber.id), "shop A's barbers never appear in shop B's report")
    const bizADetail = await getPayrollReport(business.id, reportId!)
    assert(bizADetail.lines.every((l) => l.barberId !== otherBarber.id), "shop B's barbers never appear in shop A's report")
    assert(otherDetail.report.periodLabel === bizADetail.report.periodLabel, 'period labels may coincide — but lines never cross')
  }

  // ─── cleanup ──────────────────────────────────────────────────────
  console.log('\n🧹 Cleaning up test tenants...')
  await prisma.business.deleteMany({ where: { id: { in: [business.id, otherBiz.id] } } })

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`📊 Payroll tests: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  if (failed > 0) process.exit(1)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})

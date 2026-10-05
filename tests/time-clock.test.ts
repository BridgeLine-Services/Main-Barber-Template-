/**
 * Barber Time Clock Tests
 *
 * Covers the time clock at the lib level against the real DB:
 *   - settings: safe defaults (OFF), master-switch authority
 *   - clock in / clock out / break start / break end
 *   - duplicate clock-in, clock-out-while-out, second simultaneous
 *     break, ending-no-break — all rejected
 *   - missing clock-out: open shift keeps accruing, excluded from CSV
 *     until closed
 *   - owner correction: immutable revision trail (original value, new
 *     value, who, when, reason), consistency validation
 *   - overtime: daily + weekly thresholds, both, either disabled (0),
 *     no double counting of daily OT into weekly OT
 *   - pay periods: weekly + biweekly anchored ranges
 *   - report aggregation per barber + totals
 *   - CSV export: documented header, closed shifts only, break columns,
 *     hours math, quoting
 *   - permissions: owner-only management, barber team-view default OFF,
 *     explicit team authorization
 *   - tenant isolation: another shop's settings/entries never leak
 *
 * Run: npx tsx tests/time-clock.test.ts
 */
import { prisma } from '../src/lib/prisma'
import {
  getTimeClockSettings,
  getBarberAccess,
  canManageTimeClock,
  timeClockRange,
  payPeriodRange,
  entryHours,
  dailyOvertimeSplit,
  overtimeTotals,
  buildHoursReport,
  timeClockCsv,
  TIME_CLOCK_CSV_HEADER,
  clockIn,
  clockOut,
  startBreak,
  endBreak,
  correctTimeEntry,
  TimeClockError,
  buildStatusBoard,
} from '../src/lib/time-clock'

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

const expectCode = async (fn: () => Promise<unknown>, code: TimeClockError['code'], msg: string) => {
  try {
    await fn()
    assert(false, `${msg} (no error thrown)`)
  } catch (e) {
    assert(e instanceof TimeClockError && e.code === code, msg)
  }
}

const TZ = 'America/Los_Angeles'
const at = (iso: string) => new Date(iso)

async function main() {
  console.log('\n📦 Setting up time clock test tenants...')
  const stamp = Date.now()
  const business = await prisma.business.create({
    data: { name: `Clock Shop ${stamp}`, slug: `clock-shop-${stamp}`, timezone: TZ },
  })
  const otherBiz = await prisma.business.create({
    data: { name: `Clock Other ${stamp}`, slug: `clock-other-${stamp}`, timezone: TZ },
  })
  const barber = await prisma.barber.create({ data: { businessId: business.id, name: 'Clock Barber' } })
  const barber2 = await prisma.barber.create({ data: { businessId: business.id, name: 'Clock Barber Two' } })
  const otherBarber = await prisma.barber.create({ data: { businessId: otherBiz.id, name: 'Other Shop Barber' } })
  const ownerUser = await prisma.user.create({
    data: { email: `clock-owner-${stamp}@t.com`, name: 'Clock Owner', role: 'OWNER', businessId: business.id, passwordHash: 'x' },
  })
  const barberUser = await prisma.user.create({
    data: { email: `clock-barber-${stamp}@t.com`, name: 'Clock Barber', role: 'BARBER', businessId: business.id, barberId: barber.id, passwordHash: 'x' },
  })

  const cleanup: { ids: string[] } = { ids: [] }
  const teardown = async () => {
    await prisma.business.delete({ where: { id: business.id } }).catch(() => {})
    await prisma.business.delete({ where: { id: otherBiz.id } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: [ownerUser.id, barberUser.id] } } })
    void cleanup
  }

  try {
    // ─── Settings & master switch ─────────────────────────────────────
    console.log('\n⚙️ Settings & master switch')
    let settings = await getTimeClockSettings(business.id)
    assert(settings.enabled === false, 'defaults: feature OFF out of the box')
    assert(settings.dailyOvertimeThresholdHours === 8, 'defaults: daily OT threshold 8h (configurable data)')
    assert(settings.weeklyOvertimeThresholdHours === 40, 'defaults: weekly OT threshold 40h')

    await expectCode(
      () => clockIn(business.id, barber.id, at('2026-10-04T15:00:00Z')),
      'TIME_CLOCK_DISABLED',
      'master switch OFF: clock-in rejected'
    )

    // Enable: owner authority only (role check)
    assert(canManageTimeClock('OWNER') && canManageTimeClock('PLATFORM_OWNER'), 'owners manage time clock')
    assert(!canManageTimeClock('BARBER') && !canManageTimeClock('BUSINESS_ADMIN'), 'barbers/admins cannot manage')

    settings = await prisma.timeClockSettings.update({ where: { businessId: business.id }, data: { enabled: true } })
    assert(settings.enabled === true, 'owner enables the feature')

    // ─── Clock in / out / breaks ──────────────────────────────────────
    console.log('\n🕐 Clock in / out / breaks')
    const t0 = at('2026-10-04T15:00:00Z')
    const entry = await clockIn(business.id, barber.id, t0)
    assert(!!entry.id, 'clock in creates an entry')

    await expectCode(() => clockIn(business.id, barber.id, at('2026-10-04T15:05:00Z')), 'ALREADY_CLOCKED_IN', 'duplicate clock-in rejected')
    await expectCode(() => clockOut(business.id, barber2.id, at('2026-10-04T15:10:00Z')), 'NOT_CLOCKED_IN', 'clock-out while clocked out rejected')
    await expectCode(() => endBreak(business.id, barber.id, at('2026-10-04T15:10:00Z')), 'NO_ACTIVE_BREAK', 'ending a nonexistent break rejected')

    const bStart = at('2026-10-04T16:00:00Z')
    await startBreak(business.id, barber.id, bStart)
    await expectCode(() => startBreak(business.id, barber.id, at('2026-10-04T16:01:00Z')), 'BREAK_ALREADY_ACTIVE', 'second simultaneous break rejected')

    await endBreak(business.id, barber.id, at('2026-10-04T16:30:00Z'))
    const refreshed = await prisma.timeClockEntry.findUnique({ where: { id: entry.id } })
    assert(refreshed!.breakMinutes === 30, 'closed break folds 30 unpaid minutes into the shift')

    const t1 = at('2026-10-04T19:00:00Z') // 4h span - 0.5h break = 3.5h
    await clockOut(business.id, barber.id, t1)
    const closed = await prisma.timeClockEntry.findUnique({ where: { id: entry.id } })
    assert(!!closed!.clockOutAt, 'clock out closes the shift')
    near(entryHours(closed!, t1), 3.5, 'worked hours = span minus break minutes')

    await expectCode(() => clockOut(business.id, barber.id, at('2026-10-04T20:00:00Z')), 'NOT_CLOCKED_IN', 'double clock-out rejected')

    // ─── Missing clock-out handling ───────────────────────────────────
    console.log('\n⏳ Missing clock-out handling')
    const openEntry = await clockIn(business.id, barber.id, at('2026-10-05T15:00:00Z'))
    const later = at('2026-10-05T18:00:00Z')
    near(entryHours(openEntry, later), 3, 'open shift keeps accruing hours up to now')
    const csvWithOpen = timeClockCsv(
      [{ ...openEntry, barberName: 'Clock Barber', breaks: [] }],
      settings
    )
    assert(csvWithOpen === TIME_CLOCK_CSV_HEADER, 'open shift is excluded from payroll CSV until closed')
    await clockOut(business.id, barber.id, at('2026-10-05T18:00:00Z'))

    // ─── Owner correction (audit trail) ────────────────────────────────
    console.log('\n✏️ Owner correction & audit trail')
    await expectCode(
      () => correctTimeEntry({ entryId: entry.id, businessId: business.id, changedBy: { userId: ownerUser.id, name: 'Clock Owner', email: 'o@t.com' }, reason: '' }),
      'INVALID_TIME',
      'correction without a reason rejected'
    )
    const corrected = await correctTimeEntry({
      entryId: entry.id,
      businessId: business.id,
      changedBy: { userId: ownerUser.id, name: 'Clock Owner', email: 'o@t.com' },
      reason: 'forgot to clock out — register log shows 19:30',
      clockOutAt: at('2026-10-04T19:30:00Z'),
    })
    assert(corrected.revisions.length === 1, 'each changed field writes exactly one revision')
    const rev = corrected.revisions[0]
    assert(rev.field === 'clockOutAt', 'revision records the field')
    assert(rev.originalValue === t1.toISOString() && rev.newValue === at('2026-10-04T19:30:00Z').toISOString(), 'revision records original → new value')
    assert(rev.changedByUserId === ownerUser.id && rev.changedByName === 'Clock Owner', 'revision records who changed it')
    assert(rev.createdAt instanceof Date, 'revision records when')
    assert(rev.reason.includes('register log'), 'revision records the reason')

    await expectCode(
      () => correctTimeEntry({ entryId: entry.id, businessId: business.id, changedBy: { userId: ownerUser.id, name: 'O', email: 'o@t.com' }, reason: 'x', clockInAt: at('2026-10-04T20:00:00Z') }),
      'INVALID_TIME',
      'correction making clock-in after clock-out rejected'
    )

    // ─── Overtime math (pure) ─────────────────────────────────────────
    console.log('\n⏱️ Overtime rules (configurable, not hard-coded)')
    const ds = dailyOvertimeSplit(10, 8)
    near(ds.regular, 8, 'daily split: 8 regular')
    near(ds.overtime, 2, 'daily split: 2 OT beyond threshold')
    near(dailyOvertimeSplit(10, 0).overtime, 0, 'daily OT disabled at threshold 0 (configurable)')

    let ot = overtimeTotals([10, 10], 8, 40)
    near(ot.regular, 16, 'two 10h days: 16 regular')
    near(ot.dailyOvertime, 4, 'two 10h days: 4 daily OT')
    near(ot.overtime, 4, 'no weekly OT under a 40h threshold')

    ot = overtimeTotals(Array(6).fill(8), 0, 40)
    near(ot.regular, 40, '48h week, daily OT disabled: 40 regular')
    near(ot.weeklyOvertime, 8, '48h week, daily OT disabled: 8 weekly OT')

    ot = overtimeTotals(Array(6).fill(9), 8, 40)
    near(ot.dailyOvertime, 6, '54h week with daily OT: 6 daily OT')
    near(ot.weeklyOvertime, 8, '54h week: weekly OT counts only hours beyond 40 not already daily OT (no double counting)')
    near(ot.overtime, 14, 'total OT = daily + weekly extras')

    // ─── Pay periods ──────────────────────────────────────────────────
    console.log('\n📅 Pay periods')
    const now = at('2026-10-04T22:00:00Z') // Sunday
    let range = timeClockRange('today', settings, now, TZ)
    near(range.from.getTime(), at('2026-10-04T07:00:00Z').getTime(), 'today range starts at shop-tz midnight', 1)
    range = timeClockRange('week', settings, now, TZ)
    near(range.from.getTime(), at('2026-09-28T07:00:00Z').getTime(), 'week range starts Monday shop-tz', 1)
    const weekly = payPeriodRange({ ...settings, payPeriodType: 'WEEKLY' }, now, TZ)
    near((weekly.to.getTime() - weekly.from.getTime()) / 86400000, 7, 'weekly pay period spans 7 days')
    const biweekly = payPeriodRange(
      { ...settings, payPeriodType: 'BIWEEKLY', payPeriodAnchorDate: at('2026-01-05T00:00:00Z') },
      now,
      TZ
    )
    near((biweekly.to.getTime() - biweekly.from.getTime()) / 86400000, 14, 'biweekly pay period spans 14 days')

    // ─── Report aggregation ───────────────────────────────────────────
    console.log('\n📊 Report aggregation')
    const dayA = at('2026-10-06T15:00:00Z')
    const dayB = at('2026-10-07T15:00:00Z')
    await prisma.timeClockEntry.create({
      data: { businessId: business.id, barberId: barber.id, clockInAt: dayA, clockOutAt: at('2026-10-07T01:00:00Z'), breakMinutes: 30 },
    })
    await prisma.timeClockEntry.create({
      data: { businessId: business.id, barberId: barber.id, clockInAt: dayB, clockOutAt: at('2026-10-07T23:00:00Z') },
    })
    await prisma.timeClockEntry.create({
      data: { businessId: business.id, barberId: barber2.id, clockInAt: dayB, clockOutAt: at('2026-10-07T17:00:00Z') },
    })
    // shop-local days: entry1 covers Tue 10/6 (8h), entry2 covers Wed 10/7 (8h)
    const report = buildHoursReport(
      [
        { id: 'a', barberId: barber.id, barberName: 'Clock Barber', clockInAt: dayA, clockOutAt: at('2026-10-07T01:00:00Z'), breakMinutes: 30 },
        { id: 'b', barberId: barber.id, barberName: 'Clock Barber', clockInAt: dayB, clockOutAt: at('2026-10-07T23:00:00Z'), breakMinutes: 0 },
        { id: 'c', barberId: barber2.id, barberName: 'Clock Barber Two', clockInAt: dayB, clockOutAt: at('2026-10-07T17:00:00Z'), breakMinutes: 0 },
      ],
      settings,
      TZ,
      dayA,
      at('2026-10-08T07:00:00Z'),
      now
    )
    assert(report.length === 2, 'report aggregates per barber')
    const me = report.find((r) => r.barberId === barber.id)!
    near(me.totalHours, 17.5, 'report sums both days (9.5h + 8h)')
    const me2 = report.find((r) => r.barberId === barber2.id)!
    near(me2.totalHours, 2, 'report: barber2 2h shift')

    // 22:00–02:00 crossing shift stays on its clock-in day for daily OT
    const cross = buildHoursReport(
      [{ id: 'x', barberId: barber.id, barberName: 'CB', clockInAt: at('2026-10-08T05:00:00Z'), clockOutAt: at('2026-10-08T10:00:00Z'), breakMinutes: 0 }],
      { ...settings, dailyOvertimeThresholdHours: 4, weeklyOvertimeThresholdHours: 0 },
      TZ,
      at('2026-10-08T07:00:00Z'),
      at('2026-10-09T07:00:00Z'),
      now
    )
    near(cross[0].dailyOvertimeHours, 1, 'overnight shift keeps one shop-tz day for daily OT')

    // ─── CSV export ──────────────────────────────────────────────────
    console.log('\n📤 CSV export (payroll-ready data)')
    const csv = timeClockCsv(
      [
        {
          id: 'a',
          barberId: barber.id,
          barberName: 'Doe, Jane',
          clockInAt: at('2026-10-06T15:00:00Z'),
          clockOutAt: at('2026-10-07T01:00:00Z'),
          breakMinutes: 45, // = the two closed break rows (30 + 15 min)
          breaks: [
            { startedAt: at('2026-10-06T17:00:00Z'), endedAt: at('2026-10-06T17:30:00Z') },
            { startedAt: at('2026-10-06T21:00:00Z'), endedAt: at('2026-10-06T21:15:00Z') },
          ],
        },
      ],
      settings
    )
    const lines = csv.split('\n')
    const parseCsvRow = (line: string) => {
      const cells: string[] = []
      let cur = ''
      let quoted = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
          else if (ch === '"') quoted = false
          else cur += ch
        } else if (ch === '"') quoted = true
        else if (ch === ',') { cells.push(cur); cur = '' }
        else cur += ch
      }
      cells.push(cur)
      return cells
    }
    assert(lines[0] === TIME_CLOCK_CSV_HEADER, 'CSV uses the documented header')
    assert(lines[0] === 'Barber,Date,Clock In,Break Start,Break End,Clock Out,Regular Hours,Overtime Hours,Total Hours', 'CSV header matches the spec exactly')
    const row = parseCsvRow(lines[1])
    assert(row[0] === 'Doe, Jane', 'CSV quotes names with commas')
    assert(row[3].includes('17:00') && row[4].includes('21:15'), 'multi-break shift exports first start / last end')
    assert(row[5] === at('2026-10-07T01:00:00Z').toISOString(), 'CSV includes clock out')
    near(Number(row[6]), 8, 'CSV regular hours (span 10h - 0.75h breaks - thresholds: daily 8)')
    near(Number(row[7]), 1.25, 'CSV overtime hours (9.25 - 8)')
    near(Number(row[8]), 9.25, 'CSV total hours')

    // ─── Permissions ──────────────────────────────────────────────────
    console.log('\n🔒 Permissions')
    const access = await getBarberAccess(business.id, barber.id)
    assert(access.eligible === true && access.canViewTeamRecords === false, 'barber default: eligible, NO team view')
    await prisma.barberTimeClockAccess.upsert({
      where: { barberId: barber.id },
      update: { eligible: false },
      create: { businessId: business.id, barberId: barber.id, eligible: false },
    })
    await expectCode(() => clockIn(business.id, barber.id, at('2026-10-08T15:00:00Z')), 'BARBER_NOT_ELIGIBLE', 'owner-excluded barber cannot clock in (cannot override the owner)')
    await prisma.barberTimeClockAccess.update({ where: { barberId: barber.id }, data: { eligible: true, canViewTeamRecords: true } })
    const authorized = await getBarberAccess(business.id, barber.id)
    assert(authorized.canViewTeamRecords === true, 'owner can explicitly authorize team view')

    // ─── Tenant isolation ────────────────────────────────────────────
    console.log('\n🧱 Tenant isolation')
    const otherSettings = await getTimeClockSettings(otherBiz.id)
    assert(otherSettings.id !== settings.id, 'each shop has its own settings row')
    await prisma.timeClockEntry.create({
      data: { businessId: otherBiz.id, barberId: otherBarber.id, clockInAt: dayA, clockOutAt: at('2026-10-07T01:00:00Z') },
    })
    const board = await buildStatusBoard(business.id, TZ, now)
    assert(board.every((b) => b.barberId !== otherBarber.id), 'status board never shows another shop\'s barber')
    const bizEntries = await prisma.timeClockEntry.count({ where: { businessId: business.id } })
    const otherEntries = await prisma.timeClockEntry.count({ where: { businessId: otherBiz.id } })
    assert(bizEntries === 5 && otherEntries === 1, 'entries stay scoped to their tenant')
    const otherEntry = await prisma.timeClockEntry.findFirst({ where: { businessId: otherBiz.id } })
    await expectCode(
      () =>
        correctTimeEntry({
          entryId: otherEntry!.id,
          businessId: business.id,
          changedBy: { userId: ownerUser.id, name: 'O', email: 'o@t.com' },
          reason: 'cross-tenant',
        }),
      'INVALID_TIME',
      "owner cannot correct another shop's entry (cross-tenant id rejected)"
    )
    const isolatedReport = buildHoursReport(
      [{ id: 'o', barberId: otherBarber.id, barberName: 'Other Shop Barber', clockInAt: dayA, clockOutAt: at('2026-10-07T01:00:00Z'), breakMinutes: 0 }],
      settings,
      TZ,
      dayA,
      at('2026-10-08T07:00:00Z'),
      now
    )
    assert(isolatedReport.length === 1 && isolatedReport[0].barberId === otherBarber.id, 'report only contains the entries the caller passes (routes scope by businessId)')

    // unused barberUser is the session identity these routes will use
    void barberUser
  } finally {
    await teardown()
  }

  console.log(`\n${'─'.repeat(60)}\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

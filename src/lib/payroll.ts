/**
 * Payroll-Ready Reporting — core domain library.
 *
 * This is NOT a payroll processor: it never pays anyone, never withholds
 * taxes, and never becomes a payroll provider. It aggregates payroll-ready
 * information (time clock hours, completed-service revenue, tips,
 * commissions, adjustments) into per-barber period reports the OWNER can
 * review and export as CSV for their actual payroll provider.
 *
 * OWNER CONTROL (PayrollSettings.enabled is the final authority):
 *   - OFF: reports are hidden (generation blocked server-side, list empty,
 *     barber self-view off). Historical report rows are NEVER deleted or
 *     modified, and appointments, payments, commissions, and the time
 *     clock continue working independently.
 *   - ON: the owner can generate payroll-ready reports.
 *
 * OWNER ONLY by default: shop-wide payroll reports (other barbers' wages
 * and hours, shop payroll totals, commission and payout information) are
 * owner-only. A separate owner-controlled grant (barberSelfView) may let
 * an individual barber see THEIR OWN summary only — never other barbers'
 * data and never shop totals.
 *
 * Report lifecycle: DRAFT → REVIEWED → EXPORTED → FINALIZED (forward-only,
 * with direct finalization allowed from any non-finalized state). Reports
 * are immutable snapshots; corrections after finalization append
 * PayrollReportAdjustment rows (amount + reason + author) instead of
 * rewriting finalized data.
 *
 * All queries are businessId-scoped (tenant isolation is also enforced by
 * Postgres RLS; this keeps application reads scoped too).
 */
import { prisma } from '@/lib/prisma'
import {
  startOfWeekUtc,
  buildHoursReport,
  getTimeClockSettings,
  type BarberHoursSummary,
} from '@/lib/time-clock'
import { getCommissionSettings } from '@/lib/commissions'
import type { Business, PayrollSettings } from '@prisma/client'

// ─── Errors ─────────────────────────────────────────────────────────────────

export type PayrollErrorCode =
  | 'PAYROLL_DISABLED'
  | 'NOT_FOUND'
  | 'INVALID_PERIOD'
  | 'INVALID_TRANSITION'
  | 'INVALID_ADJUSTMENT'
  | 'FINALIZED'

export class PayrollError extends Error {
  code: PayrollErrorCode
  constructor(code: PayrollErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

// ─── Settings ───────────────────────────────────────────────────────────────

/** Shop-level settings, lazily created with the safe defaults (OFF). */
export async function getPayrollSettings(businessId: string): Promise<PayrollSettings> {
  const existing = await prisma.payrollSettings.findUnique({ where: { businessId } })
  if (existing) return existing
  return prisma.payrollSettings.create({ data: { businessId } })
}

/** Shop-wide payroll reporting is OWNER authority. */
export function canManagePayroll(role: string): boolean {
  return role === 'OWNER' || role === 'PLATFORM_OWNER'
}

// ─── Pay period resolution (shop timezone) ──────────────────────────────────

/** Local (shop-tz) midnight, in UTC. Same DST-safe approach as time-clock. */
const startOfDayInTz = (d: Date, tz: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  const offset = wall - d.getTime() // ms the shop is ahead of UTC
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')) - offset)
}

const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 24 * 3600 * 1000)
const addMonths = (d: Date, months: number) => {
  const r = new Date(d)
  r.setUTCMonth(r.getUTCMonth() + months)
  return r
}

/**
 * Resolve the pay period CONTAINING `anchor` under the owner's configured
 * period type. `to` is exclusive. All boundaries are computed in the shop
 * timezone so a 22:00–02:00 shift lands in the right period.
 *
 * - WEEKLY: Monday-based week
 * - BIWEEKLY: two-week periods counting forward from the anchor Monday
 * - MONTHLY: calendar month in the shop timezone
 * - CUSTOM: owner-defined length in days from the anchor date
 */
export function payrollPeriodRange(
  settings: PayrollSettings,
  anchor: Date,
  tz: string
): { from: Date; to: Date } {
  const dayMs = 24 * 3600 * 1000
  switch (settings.payPeriodType) {
    case 'WEEKLY': {
      const from = startOfWeekUtc(anchor, tz)
      return { from, to: addDays(from, 7) }
    }
    case 'BIWEEKLY': {
      const weekStart = startOfWeekUtc(anchor, tz)
      const base = new Date(settings.payPeriodAnchorDate)
      // normalize the configured anchor to its Monday (UTC)
      const anchorDow = base.getUTCDay()
      const anchorMonday = new Date(base.getTime() - ((anchorDow + 6) % 7) * dayMs)
      const weeks = Math.floor((weekStart.getTime() - anchorMonday.getTime()) / (7 * dayMs))
      const from = new Date(anchorMonday.getTime() + (weeks - (weeks % 2)) * 7 * dayMs)
      return { from, to: addDays(from, 14) }
    }
    case 'MONTHLY': {
      // local start of the anchor's month, then one month forward
      const monthStartLocal = startOfDayInTz(anchor, tz)
      monthStartLocal.setUTCDate(1)
      const from = startOfDayInTz(monthStartLocal, tz) // re-derive (DST-safe)
      return { from, to: addMonths(from, 1) }
    }
    case 'CUSTOM': {
      const days = settings.customPeriodDays > 0 ? settings.customPeriodDays : 14
      const base = new Date(settings.payPeriodAnchorDate)
      const elapsed = Math.floor((anchor.getTime() - base.getTime()) / (days * dayMs))
      const from = new Date(base.getTime() + elapsed * days * dayMs)
      return { from, to: addDays(from, days) }
    }
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Human period label in the shop timezone, e.g. "Oct 1 – Oct 7, 2026". */
export function payrollPeriodLabel(from: Date, to: Date, tz: string): string {
  const fmt = (d: Date) => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
    const get = (t: string) => Number(p.find((x) => x.type === t)!.value)
    return { month: MONTHS[get('month') - 1], day: get('day'), year: get('year') }
  }
  const a = fmt(from)
  const b = fmt(new Date(to.getTime() - 1)) // `to` is exclusive
  if (a.year === b.year) return `${a.month} ${a.day} – ${b.month} ${b.day}, ${a.year}`
  if (a.year === b.year) return `${a.month} ${a.day} – ${b.month} ${b.day}, ${a.year}`
  return `${a.month} ${a.day}, ${a.year} – ${b.month} ${b.day}, ${b.year}`
}

// ─── Aggregation (payroll-ready data only — never payments) ─────────────────

const round2 = (n: number) => Math.round(n * 100) / 100

export interface PayrollLineDraft {
  barberId: string
  barberName: string
  serviceRevenue: number // completed-service charges, net of refunds
  tips: number // gross tips received, net of tip refunds
  commission: number // commission ledger amounts (all sources)
  adjustments: number // ledger adjustments (manual + refund) at generation
  regularHours: number
  overtimeHours: number
  totalHours: number
  estimatedPayout: number
}

export interface PayrollLine extends PayrollLineDraft {
  /** net manual payroll adjustments applied after generation */
  manualAdjustments: number
  /** effective payout = snapshot payout + manual adjustments */
  effectivePayout: number
}

/**
 * Effective view of a stored line: manual adjustments apply on top of the
 * frozen snapshot — finalized data itself is never rewritten.
 */
export function applyAdjustments(
  line: Pick<
    PayrollLineDraft,
    'estimatedPayout' | 'adjustments' | 'barberId'
  >,
  adjustments: { barberId: string; amount: number }[]
): { manualAdjustments: number; effectivePayout: number; adjustments: number } {
  const manual = round2(
    adjustments.filter((a) => a.barberId === line.barberId).reduce((s, a) => s + a.amount, 0)
  )
  return {
    manualAdjustments: manual,
    adjustments: round2(line.adjustments + manual),
    effectivePayout: round2(line.estimatedPayout + manual),
  }
}

/**
 * Aggregate one pay period per barber: payments (service revenue + tips,
 * net of refunds), the commission ledger, and closed time-clock shifts with
 * the shop's overtime rules. Tenant-scoped by businessId; callers must
 * have verified OWNER authority first.
 *
 * estimatedPayout = commission + adjustments + tips, EXCEPT tips already
 * commissioned by the shop's tips mode (PASS_THROUGH / PERCENT flow
 * through the commission ledger — counting them again would double-pay).
 */
export async function buildPayrollLines(
  businessId: string,
  opts: { from: Date; to: Date; tz: string }
): Promise<PayrollLineDraft[]> {
  const [business, commissionSettings, timeClockSettings] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } }),
    getCommissionSettings(businessId),
    getTimeClockSettings(businessId),
  ])
  const tz = opts.tz || business?.timezone || 'UTC'

  const [payments, entries, barbers] = await Promise.all([
    prisma.payment.findMany({
      where: {
        businessId,
        createdAt: { gte: opts.from, lt: opts.to },
        status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
        barberId: { not: null },
        kind: { in: ['CHARGE', 'TIP'] },
      },
      select: { barberId: true, kind: true, amount: true, refundedAmount: true },
    }),
    prisma.timeClockEntry.findMany({
      where: {
        businessId,
        clockInAt: { gte: opts.from, lt: opts.to },
        clockOutAt: { not: null }, // closed shifts only — payroll-ready data
      },
      select: { id: true, barberId: true, clockInAt: true, clockOutAt: true, breakMinutes: true },
    }),
    prisma.barber.findMany({
      where: { businessId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const commissionEntries = await prisma.commissionEntry.findMany({
    where: {
      businessId,
      createdAt: { gte: opts.from, lt: opts.to },
    },
    select: {
      barberId: true,
      source: true,
      grossAmount: true,
      commissionAmount: true,
      adjustment: true,
      refundAdjustment: true,
    },
  })

  interface Draft {
    d: PayrollLineDraft
    tipLedgerGross: number // tips already counted through the commission ledger
  }
  const byBarber = new Map<string, Draft>()
  const ensure = (barberId: string, name: string): Draft => {
    let row = byBarber.get(barberId)
    if (!row) {
      row = {
        d: {
          barberId,
          barberName: name,
          serviceRevenue: 0,
          tips: 0,
          commission: 0,
          adjustments: 0,
          regularHours: 0,
          overtimeHours: 0,
          totalHours: 0,
          estimatedPayout: 0,
        },
        tipLedgerGross: 0,
      }
      byBarber.set(barberId, row)
    }
    return row
  }
  for (const b of barbers) ensure(b.id, b.name)

  // ── Payments: service revenue + tips (net of refunds) ──
  for (const p of payments) {
    const row = ensure(p.barberId!, 'Barber')
    const net = Math.max(0, p.amount - (p.refundedAmount ?? 0))
    if (p.kind === 'CHARGE') row.d.serviceRevenue = round2(row.d.serviceRevenue + net)
    else if (p.kind === 'TIP') row.d.tips = round2(row.d.tips + net)
  }

  // ── Commission ledger: commission + adjustments (+ commissioned tips) ──
  const tipsMode = commissionSettings.tipsMode ?? 'EXCLUDED'
  for (const e of commissionEntries) {
    const row = ensure(e.barberId, 'Barber')
    row.d.commission = round2(row.d.commission + e.commissionAmount)
    row.d.adjustments = round2(row.d.adjustments + e.adjustment + e.refundAdjustment)
    if (e.source === 'TIP') row.tipLedgerGross = round2(row.tipLedgerGross + e.grossAmount)
  }

  // ── Time clock: closed shifts → regular/overtime/total hours ──
  if (entries.length > 0) {
    const hours: BarberHoursSummary[] = buildHoursReport(
      entries.map((e) => ({
        id: e.id,
        barberId: e.barberId,
        barberName: byBarber.get(e.barberId)?.d.barberName ?? 'Barber',
        clockInAt: e.clockInAt,
        clockOutAt: e.clockOutAt!,
        breakMinutes: e.breakMinutes,
      })),
      // historical entries keep the shop's CURRENT overtime rules; a report
      // snapshot freezes the resulting numbers.
      timeClockSettings,
      tz,
      opts.from,
      opts.to,
      new Date(opts.to.getTime() - 1)
    )
    for (const h of hours) {
      const row = ensure(h.barberId, h.barberName)
      row.d.regularHours = h.regularHours
      row.d.overtimeHours = h.overtimeHours
      row.d.totalHours = h.totalHours
    }
  }

  // ── Estimated payout ──
  const rows: PayrollLineDraft[] = []
  for (const { d, tipLedgerGross } of byBarber.values()) {
    // Tips flow to the barber twice only if the shop commissions them AND
    // they still count as the barber's own. Under PASS_THROUGH/PERCENT the
    // ledger already carries the tip money as commission.
    const tipsOwned =
      tipsMode === 'EXCLUDED' ? d.tips : tipsMode === 'PASS_THROUGH' ? Math.max(0, d.tips - tipLedgerGross) : 0
    d.estimatedPayout = round2(d.commission + d.adjustments + tipsOwned)
    // only include barbers with any activity in the period
    if (
      d.serviceRevenue || d.tips || d.commission || d.adjustments ||
      d.totalHours || d.estimatedPayout
    ) {
      rows.push(d)
    }
  }
  return rows.sort((a, b) => a.barberName.localeCompare(b.barberName))
}

// ─── Report lifecycle ──────────────────────────────────────────────────────

const FORWARD: Record<string, string[]> = {
  DRAFT: ['REVIEWED', 'EXPORTED', 'FINALIZED'],
  REVIEWED: ['EXPORTED', 'FINALIZED'],
  EXPORTED: ['FINALIZED'],
  FINALIZED: [],
}

/**
 * Create a payroll-ready report for the period containing `anchor`
 * (resolved under the shop's configured pay period), or an explicit
 * [from, to) custom range. The per-barber numbers are FROZEN at generation
 * time. Requires the owner's master switch ON.
 */
export async function createPayrollReport(
  businessId: string,
  opts: {
    anchor?: Date
    from?: Date
    to?: Date
    createdByUserId: string
    now?: Date
  }
): Promise<{ report: { id: string; periodLabel: string; lineCount: number } }> {
  const settings = await getPayrollSettings(businessId)
  if (!settings.enabled) throw new PayrollError('PAYROLL_DISABLED', 'Payroll reporting is turned off')

  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } })
  const tz = business?.timezone || 'UTC'

  let from: Date
  let to: Date
  let periodType: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'CUSTOM'
  if (opts.from && opts.to) {
    from = opts.from
    to = opts.to
    if (from >= to) throw new PayrollError('INVALID_PERIOD', 'Period start must be before end')
    const spanDays = (to.getTime() - from.getTime()) / (24 * 3600 * 1000)
    if (spanDays < 1 || spanDays > 400) throw new PayrollError('INVALID_PERIOD', 'Custom period must be 1–400 days')
    periodType = 'CUSTOM'
  } else {
    const anchor = opts.anchor ?? opts.now ?? new Date()
    ;({ from, to } = payrollPeriodRange(settings, anchor, tz))
    periodType = settings.payPeriodType
  }

  const lines = await buildPayrollLines(businessId, { from, to, tz })
  const label = payrollPeriodLabel(from, to, tz)

  const report = await prisma.payrollReport.create({
    data: {
      businessId,
      status: 'DRAFT',
      periodType,
      periodStart: from,
      periodEnd: to,
      periodLabel: label,
      createdByUserId: opts.createdByUserId,
      lines: {
        create: lines.map((l) => ({
          businessId,
          barberId: l.barberId,
          barberName: l.barberName,
          serviceRevenue: l.serviceRevenue,
          tips: l.tips,
          commission: l.commission,
          adjustments: l.adjustments,
          regularHours: l.regularHours,
          overtimeHours: l.overtimeHours,
          totalHours: l.totalHours,
          estimatedPayout: l.estimatedPayout,
        })),
      },
    },
  })
  return { report: { id: report.id, periodLabel: report.periodLabel, lineCount: lines.length } }
}

async function getReport(businessId: string, reportId: string) {
  const report = await prisma.payrollReport.findFirst({
    where: { id: reportId, businessId },
    include: { lines: true, adjustments: true },
  })
  if (!report) throw new PayrollError('NOT_FOUND', 'Payroll report not found')
  return report
}

/** Full owner view: frozen lines with manual adjustments applied. */
export async function getPayrollReport(businessId: string, reportId: string) {
  const report = await getReport(businessId, reportId)
  return {
    report,
    lines: report.lines
      .map((l) => ({
        ...l,
        ...applyAdjustments(l, report.adjustments),
      }))
      .sort((a, b) => a.barberName.localeCompare(b.barberName)),
  }
}

/**
 * Forward-only status transitions. Finalization locks the snapshot: from
 * then on, ONLY adjustments (audit trail) change the effective numbers.
 */
export async function setPayrollReportStatus(
  businessId: string,
  reportId: string,
  target: 'REVIEWED' | 'EXPORTED' | 'FINALIZED',
  now = new Date()
) {
  const report = await getReport(businessId, reportId)
  const allowed = FORWARD[report.status] ?? []
  if (!allowed.includes(target)) {
    throw new PayrollError(
      'INVALID_TRANSITION',
      `Cannot move a ${report.status} report to ${target}`
    )
  }
  const data: Record<string, unknown> = { status: target }
  if (target === 'REVIEWED') data.reviewedAt = now
  if (target === 'EXPORTED') data.exportedAt = now
  if (target === 'FINALIZED') data.finalizedAt = now
  const updated = await prisma.payrollReport.update({ where: { id: report.id }, data })
  return { report: updated }
}

/**
 * Append a manual adjustment (the audit mechanism for finalized reports).
 * Appends a row — it NEVER rewrites the frozen line values.
 */
export async function addPayrollAdjustment(
  businessId: string,
  reportId: string,
  opts: { barberId: string; amount: number; reason: string; createdByUserId: string }
) {
  const report = await getReport(businessId, reportId)
  const line = report.lines.find((l) => l.barberId === opts.barberId)
  if (!line) throw new PayrollError('INVALID_ADJUSTMENT', 'Barber is not on this report')
  if (!Number.isFinite(opts.amount) || opts.amount === 0) {
    throw new PayrollError('INVALID_ADJUSTMENT', 'Adjustment amount must be a nonzero number')
  }
  const trimmed = (opts.reason ?? '').trim()
  if (!trimmed) throw new PayrollError('INVALID_ADJUSTMENT', 'Adjustment reason is required')
  const adjustment = await prisma.payrollReportAdjustment.create({
    data: {
      businessId,
      reportId: report.id,
      barberId: opts.barberId,
      amount: round2(opts.amount),
      reason: trimmed,
      createdByUserId: opts.createdByUserId,
    },
  })
  return { adjustment }
}

// ─── CSV export (payroll-ready data, never payments) ───────────────────────

/** Documented per-barber export — matches the spec header exactly. */
export const PAYROLL_CSV_HEADER =
  'Barber,Pay Period,Regular Hours,Overtime Hours,Service Revenue,Tips,Commission,Adjustments,Estimated Payout'

const csvCell = (v: string | number) => {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Per-barber CSV: one row per barber with effective values (manual
 * adjustments applied on top of the frozen snapshot) and a TOTAL row.
 */
export function payrollReportCsv(
  report: {
    periodLabel: string
    lines: {
      barberName: string
      regularHours: number
      overtimeHours: number
      serviceRevenue: number
      tips: number
      commission: number
      adjustments: number
      effectivePayout: number
    }[]
  }
): string {
  const rows: string[] = [PAYROLL_CSV_HEADER]
  const n = (v: number) => v.toFixed(2)
  for (const l of report.lines) {
    rows.push(
      [
        l.barberName,
        report.periodLabel,
        n(l.regularHours),
        n(l.overtimeHours),
        n(l.serviceRevenue),
        n(l.tips),
        n(l.commission),
        n(l.adjustments),
        n(l.effectivePayout),
      ]
        .map(csvCell)
        .join(',')
    )
  }
  const sum = (k: 'regularHours' | 'overtimeHours' | 'serviceRevenue' | 'tips' | 'commission' | 'adjustments' | 'effectivePayout') =>
    round2(report.lines.reduce((s, l) => s + l[k], 0))
  rows.push(
    ['TOTAL', report.periodLabel, n(sum('regularHours')), n(sum('overtimeHours')), n(sum('serviceRevenue')), n(sum('tips')), n(sum('commission')), n(sum('adjustments')), n(sum('effectivePayout'))]
      .map(csvCell)
      .join(',')
  )
  return rows.join('\n')
}

// ─── Barber self-view (own summary only — never shop totals) ────────────────

/**
 * The barber's OWN payroll summaries across reports. Owner-gated by
 * settings.barberSelfView; contains only the caller's lines — no other
 * barbers, no shop totals.
 */
export async function barberSelfSummaries(
  businessId: string,
  barberId: string
) {
  const settings = await getPayrollSettings(businessId)
  if (!settings.enabled || !settings.barberSelfView) {
    throw new PayrollError('PAYROLL_DISABLED', 'Payroll self-view is not enabled')
  }
  const reports = await prisma.payrollReport.findMany({
    where: { businessId },
    include: { lines: { where: { barberId } }, adjustments: { where: { barberId } } },
    orderBy: { periodStart: 'desc' },
    take: 24,
  })
  return reports
    .filter((r) => r.lines.length > 0)
    .map((r) => {
      const line = r.lines[0]
      const eff = applyAdjustments(line, r.adjustments)
      return {
        reportId: r.id,
        status: r.status,
        periodLabel: r.periodLabel,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        serviceRevenue: line.serviceRevenue,
        tips: line.tips,
        commission: line.commission,
        adjustments: eff.adjustments,
        regularHours: line.regularHours,
        overtimeHours: line.overtimeHours,
        totalHours: line.totalHours,
        estimatedPayout: eff.effectivePayout,
      }
    })
}

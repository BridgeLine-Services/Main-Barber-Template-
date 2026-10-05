/**
 * Barber Time Clock — core domain library.
 *
 * OPTIONAL shop feature, owner-controlled end to end:
 *   - TimeClockSettings.enabled is the OWNER's master switch. OFF hides all
 *     time-clock UI and blocks new clock-in/out records server-side; it
 *     never deletes or hides historical entries (payroll history survives).
 *     Scheduling, appointments, and commissions continue independently.
 *   - Authorized barbers (owner-managed BarberTimeClockAccess) clock in/out
 *     and take breaks; every transition is validated so a client crash can
 *     never create duplicate clock-ins, clock-outs, or overlapping breaks.
 *   - Owner corrections NEVER rewrite values silently: each changed field
 *     appends an immutable TimeClockEntryRevision (original → new, who,
 *     when, why).
 *   - Overtime rules are shop DATA (daily/weekly thresholds, 0 = disabled),
 *     never hard-coded. The system produces payroll-ready data only — it
 *     never creates payroll payments.
 *
 * All queries are businessId-scoped (tenant isolation is also enforced by
 * Postgres RLS; this keeps application reads scoped too).
 */
import { prisma } from '@/lib/prisma'
import type { Barber, PayPeriodType, TimeClockSettings } from '@prisma/client'

// ─── Settings ──────────────────────────────────────────────────────────────

/** Shop-level settings, lazily created with the documented defaults. */
export async function getTimeClockSettings(businessId: string): Promise<TimeClockSettings> {
  const existing = await prisma.timeClockSettings.findUnique({ where: { businessId } })
  if (existing) return existing
  return prisma.timeClockSettings.create({ data: { businessId } })
}

/** Owner (or platform owner) manages time clock configuration & reports. */
export function canManageTimeClock(role: string): boolean {
  return role === 'OWNER' || role === 'PLATFORM_OWNER'
}

/** Per-barber access row, lazily created with the defaults (eligible, no
 *  team view). A missing row means the barber's default state. */
export async function getBarberAccess(businessId: string, barberId: string) {
  const existing = await prisma.barberTimeClockAccess.findUnique({ where: { barberId } })
  if (existing && existing.businessId === businessId) return existing
  // Default row: eligible=true, canViewTeamRecords=false. Not created
  // eagerly — the owner only creates rows to CHANGE someone's defaults.
  return {
    id: null,
    businessId,
    barberId,
    eligible: true,
    canViewTeamRecords: false,
    createdAt: null,
    updatedAt: null,
  }
}

// ─── Date ranges (shop timezone) ───────────────────────────────────────────

const dayInTz = (now: Date, tz: string) => {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  return fmt.format(now) // YYYY-MM-DD in shop timezone
}

/**
 * UTC instant of LOCAL midnight for the given date in shop tz.
 * DST-safe: derives the shop's UTC offset at `d` from the wall-clock
 * difference, then shifts local midnight by it (a naive
 * `${date}T00:00:00Z` would be UTC midnight, up to a day off for
 * non-UTC shops).
 */
const startOfDayUtc = (d: Date, tz: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  const offset = wall - d.getTime() // ms the shop is ahead of UTC
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')) - offset)
}

/** Monday-based start of the local week containing `now` (UTC instant). */
export function startOfWeekUtc(now: Date, tz: string): Date {
  const monday = startOfDayUtc(now, tz)
  const dow = monday.getUTCDay() // 0=Sunday
  return new Date(monday.getTime() - ((dow + 6) % 7) * 24 * 3600 * 1000)
}

/**
 * Pay-period range [from, to) containing `now`, in shop tz.
 * WEEKLY: Monday→Sunday. BIWEEKLY: two-week periods anchored on the
 * settings' payPeriodAnchorDate (any Monday); periods count forward from
 * it, so every shop gets stable, gapless pay periods.
 */
export function payPeriodRange(settings: TimeClockSettings, now: Date, tz: string): { from: Date; to: Date } {
  const weekStart = startOfWeekUtc(now, tz)
  const type: PayPeriodType = settings.payPeriodType ?? 'WEEKLY'
  if (type === 'WEEKLY') {
    return { from: weekStart, to: new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000) }
  }
  // BIWEEKLY: anchor to the anchor-date's Monday, then take pairs of weeks.
  const anchor = new Date(settings.payPeriodAnchorDate)
  // normalize anchor to its Monday (UTC) — anchor may be any Monday already
  const anchorDow = anchor.getUTCDay()
  const anchorMonday = new Date(anchor.getTime() - ((anchorDow + 6) % 7) * 24 * 3600 * 1000)
  const weekMs = 7 * 24 * 3600 * 1000
  const weeks = Math.floor((weekStart.getTime() - anchorMonday.getTime()) / weekMs)
  const periodStart = new Date(anchorMonday.getTime() + (weeks - (weeks % 2)) * weekMs)
  return { from: periodStart, to: new Date(periodStart.getTime() + 2 * weekMs) }
}

/** today | week | payperiod ranges for dashboard + barber self-view. */
export function timeClockRange(
  preset: string,
  settings: TimeClockSettings,
  now: Date,
  tz: string
): { from: Date; to: Date } {
  if (preset === 'today') {
    const from = startOfDayUtc(now, tz)
    return { from, to: new Date(from.getTime() + 24 * 3600 * 1000) }
  }
  if (preset === 'week') {
    const from = startOfWeekUtc(now, tz)
    return { from, to: new Date(from.getTime() + 7 * 24 * 3600 * 1000) }
  }
  if (preset === 'payperiod') return payPeriodRange(settings, now, tz)
  throw new Error('preset must be today | week | payperiod')
}

// ─── Hours & overtime math (pure functions) ─────────────────────────────────

export interface EntryLike {
  clockInAt: Date
  clockOutAt: Date | null
  breakMinutes: number
}

/** Worked hours of one entry: clock span minus closed break minutes.
 *  Open entries count up to `now` (missing clock-out handling: the shift
 *  keeps accruing until the owner corrects it or the barber clocks out). */
export function entryHours(entry: EntryLike, now: Date): number {
  const end = entry.clockOutAt && entry.clockOutAt > entry.clockInAt ? entry.clockOutAt : now
  const spanMinutes = Math.max(0, (end.getTime() - entry.clockInAt.getTime()) / 60_000)
  // breakMinutes only ever accumulates from CLOSED breaks — safe to deduct
  // for open shifts too (a running break is not yet in the sum).
  const breaks = Math.max(0, entry.breakMinutes)
  return Math.max(0, (spanMinutes - breaks) / 60)
}

/** Daily overtime split for one day's total hours (pure).
 *  threshold 0 = daily OT disabled → everything regular. */
export function dailyOvertimeSplit(hours: number, dailyThreshold: number): { regular: number; overtime: number } {
  if (!dailyThreshold || dailyThreshold <= 0) return { regular: hours, overtime: 0 }
  const overtime = Math.max(0, hours - dailyThreshold)
  return { regular: hours - overtime, overtime }
}

/**
 * Combined daily + weekly overtime for a set of per-day hour totals
 * (pure). Weekly OT counts hours beyond the weekly threshold that were
 * NOT already flagged as daily OT (no double counting).
 * 0-threshold disables the respective rule.
 */
export function overtimeTotals(
  dayHours: number[],
  dailyThreshold: number,
  weeklyThreshold: number
): { regular: number; dailyOvertime: number; weeklyOvertime: number; overtime: number; total: number } {
  let regular = 0
  let dailyOvertime = 0
  for (const h of dayHours) {
    const split = dailyOvertimeSplit(h, dailyThreshold)
    regular += split.regular
    dailyOvertime += split.overtime
  }
  // weekly OT counts hours beyond the weekly threshold that were NOT
  // already flagged as daily OT — and moves them out of regular, so
  // regular + overtime always equals total hours (no double counting).
  const gross = regular + dailyOvertime
  let weeklyOvertime = 0
  if (weeklyThreshold > 0 && gross > weeklyThreshold) {
    weeklyOvertime = Math.max(0, gross - weeklyThreshold - dailyOvertime)
  }
  regular = gross - dailyOvertime - weeklyOvertime
  const overtime = dailyOvertime + weeklyOvertime
  return { regular, dailyOvertime, weeklyOvertime, overtime, total: gross }
}

// ─── Report aggregation ─────────────────────────────────────────────────────

export interface ReportEntry extends EntryLike {
  id: string
  barberId: string
  barberName: string
}

export interface BarberHoursSummary {
  barberId: string
  barberName: string
  /** shop-tz day totals (YYYY-MM-DD → hours) used for overtime */
  dayHours: Record<string, number>
  regularHours: number
  dailyOvertimeHours: number
  weeklyOvertimeHours: number
  overtimeHours: number
  totalHours: number
  openShift: boolean
  entryCount: number
}

/**
 * Aggregate entries per barber over [from, to) with daily + weekly overtime
 * (thresholds from settings). Grouping days in the shop timezone keeps a
 * 22:00–02:00 shift on one day for overtime purposes.
 */
export function buildHoursReport(
  entries: ReportEntry[],
  settings: TimeClockSettings,
  tz: string,
  from: Date,
  to: Date,
  now: Date
): BarberHoursSummary[] {
  const byBarber = new Map<string, BarberHoursSummary>()
  for (const e of entries) {
    let sum = byBarber.get(e.barberId)
    if (!sum) {
      sum = {
        barberId: e.barberId,
        barberName: e.barberName,
        dayHours: {},
        regularHours: 0,
        dailyOvertimeHours: 0,
        weeklyOvertimeHours: 0,
        overtimeHours: 0,
        totalHours: 0,
        openShift: false,
        entryCount: 0,
      }
      byBarber.set(e.barberId, sum)
    }
    sum.entryCount++
    if (!e.clockOutAt) sum.openShift = true
    const dayKey = dayInTz(e.clockInAt, tz)
    sum.dayHours[dayKey] = (sum.dayHours[dayKey] ?? 0) + entryHours(e, now)
  }
  const daily = settings.dailyOvertimeThresholdHours
  const weekly = settings.weeklyOvertimeThresholdHours
  for (const sum of byBarber.values()) {
    const totals = overtimeTotals(Object.values(sum.dayHours), daily, weekly)
    sum.regularHours = round2(totals.regular)
    sum.dailyOvertimeHours = round2(totals.dailyOvertime)
    sum.weeklyOvertimeHours = round2(totals.weeklyOvertime)
    sum.overtimeHours = round2(totals.overtime)
    sum.totalHours = round2(totals.total)
  }
  return [...byBarber.values()]
}

const round2 = (n: number) => Math.round(n * 100) / 100

// ─── CSV export (payroll-ready data, never payments) ───────────────────────

export const TIME_CLOCK_CSV_HEADER =
  'Barber,Date,Clock In,Break Start,Break End,Clock Out,Regular Hours,Overtime Hours,Total Hours'

const csvCell = (v: string | null | undefined) => {
  const s = v ?? ''
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const hoursCell = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

export interface CsvEntry extends ReportEntry {
  breaks: { startedAt: Date; endedAt: Date | null }[]
}

/**
 * Payroll-ready CSV rows: one CLOSED entry per line (open shifts have no
 * clock-out yet and stay out of payroll exports until corrected/closed).
 * Multi-break shifts export the FIRST break start and LAST break end; all
 * closed break minutes are already deducted from hours. Per-entry overtime
 * uses the DAILY rule only (weekly OT is reported in the dashboard
 * aggregates). Times are ISO-8601 UTC.
 */
export function timeClockCsv(entries: CsvEntry[], settings: TimeClockSettings): string {
  const lines = [TIME_CLOCK_CSV_HEADER]
  for (const e of entries) {
    if (!e.clockOutAt) continue
    const hours = entryHours(e, new Date())
    const { regular, overtime } = dailyOvertimeSplit(hours, settings.dailyOvertimeThresholdHours)
    const closedBreaks = e.breaks.filter((b) => b.endedAt)
    const breakStart = closedBreaks.length ? closedBreaks[0].startedAt.toISOString() : ''
    const breakEnd = closedBreaks.length ? closedBreaks[closedBreaks.length - 1].endedAt!.toISOString() : ''
    lines.push(
      [
        csvCell(e.barberName),
        csvCell(dayInTz(e.clockInAt, 'UTC')),
        e.clockInAt.toISOString(),
        breakStart,
        breakEnd,
        e.clockOutAt.toISOString(),
        hoursCell(regular),
        hoursCell(overtime),
        hoursCell(hours),
      ].join(',')
    )
  }
  return lines.join('\n')
}

// ─── Clock state transitions (validated, transactional) ─────────────────────

/** Typed domain error so routes can map to precise status codes. */
export class TimeClockError extends Error {
  code:
    | 'TIME_CLOCK_DISABLED'
    | 'BARBER_NOT_ELIGIBLE'
    | 'ALREADY_CLOCKED_IN'
    | 'NOT_CLOCKED_IN'
    | 'BREAK_ALREADY_ACTIVE'
    | 'NO_ACTIVE_BREAK'
    | 'INVALID_TIME'
  constructor(code: TimeClockError['code'], message: string) {
    super(message)
    this.code = code
  }
}

async function requireOpenEntry(businessId: string, barberId: string) {
  const entry = await prisma.timeClockEntry.findFirst({
    where: { businessId, barberId, clockOutAt: null },
    orderBy: { clockInAt: 'desc' },
  })
  if (!entry) throw new TimeClockError('NOT_CLOCKED_IN', 'No open shift: clock in first.')
  return entry
}

/** Clock in. Master switch + eligibility enforced server-side; one open
 *  shift per barber (duplicate clock-in prevention). */
export async function clockIn(businessId: string, barberId: string, at: Date) {
  const settings = await getTimeClockSettings(businessId)
  if (!settings.enabled) throw new TimeClockError('TIME_CLOCK_DISABLED', 'Time clock is off.')
  const access = await getBarberAccess(businessId, barberId)
  if (!access.eligible) throw new TimeClockError('BARBER_NOT_ELIGIBLE', 'Not authorized for the time clock.')
  const open = await prisma.timeClockEntry.findFirst({ where: { businessId, barberId, clockOutAt: null } })
  if (open) throw new TimeClockError('ALREADY_CLOCKED_IN', 'Already clocked in.')
  return prisma.timeClockEntry.create({ data: { businessId, barberId, clockInAt: at } })
}

/** Clock out. Auto-closes a running break (minutes counted) so a forgotten
 *  break can never leave a stuck open state. */
export async function clockOut(businessId: string, barberId: string, at: Date) {
  const settings = await getTimeClockSettings(businessId)
  if (!settings.enabled) throw new TimeClockError('TIME_CLOCK_DISABLED', 'Time clock is off.')
  const entry = await requireOpenEntry(businessId, barberId)
  return prisma.$transaction(async (tx) => {
    const openBreak = await tx.timeClockBreak.findFirst({ where: { entryId: entry.id, endedAt: null } })
    let breakMinutes = entry.breakMinutes
    if (openBreak) {
      const ended = at > openBreak.startedAt ? at : openBreak.startedAt
      await tx.timeClockBreak.update({ where: { id: openBreak.id }, data: { endedAt: ended } })
      breakMinutes += Math.max(0, (ended.getTime() - openBreak.startedAt.getTime()) / 60_000)
    }
    const clockOutAt = at >= entry.clockInAt ? at : entry.clockInAt
    return tx.timeClockEntry.update({
      where: { id: entry.id },
      data: { clockOutAt, breakMinutes: Math.round(breakMinutes) },
    })
  })
}

/** Start a break — at most one open break per shift (app check + partial
 *  unique index backstop). */
export async function startBreak(businessId: string, barberId: string, at: Date) {
  const settings = await getTimeClockSettings(businessId)
  if (!settings.enabled) throw new TimeClockError('TIME_CLOCK_DISABLED', 'Time clock is off.')
  const entry = await requireOpenEntry(businessId, barberId)
  const open = await prisma.timeClockBreak.findFirst({ where: { entryId: entry.id, endedAt: null } })
  if (open) throw new TimeClockError('BREAK_ALREADY_ACTIVE', 'A break is already running.')
  return prisma.timeClockBreak.create({ data: { businessId, entryId: entry.id, startedAt: at } })
}

/** End the running break and fold its minutes into the shift. */
export async function endBreak(businessId: string, barberId: string, at: Date) {
  const settings = await getTimeClockSettings(businessId)
  if (!settings.enabled) throw new TimeClockError('TIME_CLOCK_DISABLED', 'Time clock is off.')
  const entry = await requireOpenEntry(businessId, barberId)
  const open = await prisma.timeClockBreak.findFirst({ where: { entryId: entry.id, endedAt: null } })
  if (!open) throw new TimeClockError('NO_ACTIVE_BREAK', 'No break is running.')
  const ended = at > open.startedAt ? at : open.startedAt
  const minutes = Math.max(0, (ended.getTime() - open.startedAt.getTime()) / 60_000)
  return prisma.$transaction(async (tx) => {
    await tx.timeClockBreak.update({ where: { id: open.id }, data: { endedAt: ended } })
    return tx.timeClockEntry.update({
      where: { id: entry.id },
      data: { breakMinutes: { increment: Math.round(minutes) } },
    })
  })
}

// ─── Owner correction (audited, immutable history) ──────────────────────────

export interface CorrectionInput {
  entryId: string
  businessId: string
  changedBy: { userId: string; name: string; email: string }
  reason: string
  clockInAt?: Date | null
  clockOutAt?: Date | null
  breakMinutes?: number
  notes?: string | null
}

const EDITABLE_FIELDS = ['clockInAt', 'clockOutAt', 'breakMinutes', 'notes'] as const

/**
 * Owner manual correction of a time entry. Every changed field appends a
 * TimeClockEntryRevision row: original value, new value, who changed it,
 * when, and the owner's reason (required). Values are never rewritten
 * silently — the revision trail is the audit record.
 */
export async function correctTimeEntry(input: CorrectionInput) {
  const reason = input.reason?.trim()
  if (!reason) throw new TimeClockError('INVALID_TIME', 'A correction reason is required.')
  const entry = await prisma.timeClockEntry.findUnique({ where: { id: input.entryId } })
  if (!entry || entry.businessId !== input.businessId) {
    throw new TimeClockError('INVALID_TIME', 'Entry not found.')
  }
  const updates: Record<string, unknown> = {}
  const revisions: {
    field: string
    originalValue: string
    newValue: string
  }[] = []

  const serialize = (f: string, v: unknown) => (f === 'notes' ? String(v ?? '') : v === null ? 'null' : new Date(v as any).toISOString())

  const pairs: [string, unknown, unknown][] = [
    ['clockInAt', input.clockInAt, entry.clockInAt],
    ['clockOutAt', input.clockOutAt, entry.clockOutAt],
    ['breakMinutes', input.breakMinutes, entry.breakMinutes],
    ['notes', input.notes, entry.notes],
  ]
  for (const [field, incoming, current] of pairs) {
    if (incoming === undefined) continue // field not being edited
    if (field === 'breakMinutes') {
      const n = Number(incoming)
      if (!Number.isFinite(n) || n < 0) throw new TimeClockError('INVALID_TIME', 'breakMinutes must be ≥ 0.')
      if (Math.round(n * 100) !== Math.round((current as number) * 100)) {
        updates[field] = Math.round(n)
        revisions.push({ field, originalValue: String(current), newValue: String(Math.round(n)) })
      }
      continue
    }
    if (field === 'notes') {
      const next = incoming === null ? null : String(incoming)
      if ((next ?? null) !== ((current as string | null) ?? null)) {
        updates[field] = next
        revisions.push({ field, originalValue: String(current ?? ''), newValue: String(next ?? '') })
      }
      continue
    }
    // timestamps
    const next = incoming === null ? null : new Date(incoming as Date)
    if (field === 'clockInAt' && !next) throw new TimeClockError('INVALID_TIME', 'clockInAt cannot be removed.')
    if (next && isNaN(next.getTime())) throw new TimeClockError('INVALID_TIME', `Invalid ${field}.`)
    const changed = next?.getTime() !== (current ? (current as Date).getTime() : null)
    if (changed) {
      updates[field] = next
      revisions.push({ field, originalValue: serialize(field, current), newValue: serialize(field, next) })
    }
  }

  // final consistency: clockOut (when set) must follow clockIn
  const finalIn = (updates.clockInAt as Date | undefined) ?? entry.clockInAt
  const finalOut = (updates.clockOutAt as Date | null | undefined) !== undefined ? (updates.clockOutAt as Date | null) : entry.clockOutAt
  if (finalOut && finalOut < finalIn) {
    throw new TimeClockError('INVALID_TIME', 'Clock-out must not be before clock-in.')
  }

  if (!revisions.length) return { entry, revisions: [] as PrismaRevision[] }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.timeClockEntry.update({ where: { id: entry.id }, data: updates })
    const rows = await Promise.all(
      revisions.map((r) =>
        tx.timeClockEntryRevision.create({
          data: {
            businessId: input.businessId,
            entryId: entry.id,
            changedByUserId: input.changedBy.userId,
            changedByName: input.changedBy.name,
            changedByEmail: input.changedBy.email,
            field: r.field,
            originalValue: r.originalValue,
            newValue: r.newValue,
            reason,
          },
        })
      )
    )
    return { entry: updated, revisions: rows }
  })
}

type PrismaRevision = Awaited<ReturnType<typeof prisma.timeClockEntryRevision.create>>

// ─── Dashboard board (who is in / on break / out) ───────────────────────────

export interface BarberClockState {
  barberId: string
  barberName: string
  state: 'IN' | 'BREAK' | 'OUT'
  since: string | null // ISO of the last transition
  todayHours: number // hours worked today (shop tz), breaks deducted
  eligible: boolean
}

/** Live board: every barber's current clock state + today's hours. */
export async function buildStatusBoard(businessId: string, tz: string, now: Date): Promise<BarberClockState[]> {
  const today = startOfDayUtc(now, tz)
  const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000)
  const barbers = await prisma.barber.findMany({
    where: { businessId, isActive: true },
    orderBy: { name: 'asc' },
  })
  const todayEntries = await prisma.timeClockEntry.findMany({
    where: { businessId, clockInAt: { gte: today, lt: tomorrow } },
  })
  const byBarber = new Map<string, typeof todayEntries>()
  for (const e of todayEntries) {
    const list = byBarber.get(e.barberId) ?? []
    list.push(e)
    byBarber.set(e.barberId, list)
  }
  const accessRows = await prisma.barberTimeClockAccess.findMany({ where: { businessId } })
  const accessByBarber = new Map(accessRows.map((a) => [a.barberId, a]))
  const activeBreaks = await prisma.timeClockBreak.findMany({
    where: { businessId, endedAt: null, entry: { clockOutAt: null, businessId } },
  })
  const breakEntries = new Set(activeBreaks.map((b) => b.entryId))

  return barbers.map((b: Barber) => {
    const entries = byBarber.get(b.id) ?? []
    const open = entries.find((e) => !e.clockOutAt)
    const todayHours = entries.reduce((acc, e) => acc + entryHours(e, now), 0)
    const onBreak = open ? breakEntries.has(open.id) : false
    const state: BarberClockState['state'] = open ? (onBreak ? 'BREAK' : 'IN') : 'OUT'
    const since = open ? (onBreak ? activeBreaks.find((x) => x.entryId === open.id)!.startedAt : open.clockInAt) : null
    const access = accessByBarber.get(b.id)
    return {
      barberId: b.id,
      barberName: b.name,
      state,
      since: since ? since.toISOString() : null,
      todayHours: round2(todayHours),
      eligible: access ? access.eligible : true,
    }
  })
}

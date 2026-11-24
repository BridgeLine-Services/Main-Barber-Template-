/**
 * Quiet-day recommendations (Priority 3: "win-back and slow-day recommendations").
 *
 * The growth centre could already tell an owner who they can reach and who has drifted. It
 * could not say which day of their week is quiet, which is the question that actually
 * changes what they do on a Monday morning.
 *
 * Four rules hold this honest:
 *
 *  - Nothing is judged from too little history. A weekday needs to have appeared at least
 *    three times before it can be called quiet.
 *  - A failed read is null and says so. It is never a zero, and it is never "your week is
 *    even".
 *  - A day is only called quiet against this shop's own average, never against an industry
 *    number this code cannot know.
 *  - No revenue is promised. The recommendation is who to invite back, not what it will earn.
 *
 * Pure: the caller supplies the days, already limited to a window, and the timezone.
 */

import { ymdInZone } from '../calendar-tz'
import type { GrowthCard, GrowthState } from './overview'

/** Sunday first, matching `Date.getUTCDay()` and how a shop owner reads a week. */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

/** One open day for the shop. Closed days are not supplied by the caller. */
export interface ShopDay {
  /** Shop-local calendar day, YYYY-MM-DD. */
  date: string
  /** Appointments on the book that day. Cancellations and no-shows are excluded by the caller. */
  booked: number
}

export interface SlowDayFinding {
  /** 0 is Sunday. */
  weekday: number
  name: string
  /** Appointments per open day on this weekday, to one decimal. */
  averageBooked: number
  /** Appointments per open day across the whole window, to one decimal. */
  shopAverage: number
  /** How far below the shop average, in whole percentage points. */
  percentBelow: number
  /** How many times this weekday appeared in the window. */
  occurrences: number
  /** One sentence stating the basis, so the claim can be checked. */
  basis: string
}

export interface SlowDayInput {
  /** Open days in the window, or null when the read failed. */
  days: ShopDay[] | null
  /** Customers past their usual return date, or null when unknown. */
  dormantCustomers?: number | null
  /** How often a weekday must appear before it can be judged. Defaults to 3. */
  minOccurrences?: number
}

export interface SlowDayReport {
  state: GrowthState
  headline: string
  detail: string
  action: string | null
  findings: SlowDayFinding[]
  /** Weekdays that were judged, as opposed to seen. */
  judgedWeekdays: number
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** How far back a quiet day is judged. Eight weeks is long enough to see every weekday. */
export const SLOW_DAY_WINDOW_WEEKS = 8

/**
 * The window the caller should read, ending now.
 *
 * Kept here rather than in the page so the page has no clock of its own: the range is a
 * rule about the recommendation, so it is stated once and pinned by a test.
 */
export function recentWindow(
  weeks: number = SLOW_DAY_WINDOW_WEEKS,
  now: Date = new Date(),
): { since: Date; until: Date } {
  const safeWeeks = Number.isFinite(weeks) && weeks >= 1 ? weeks : SLOW_DAY_WINDOW_WEEKS
  return { since: new Date(now.getTime() - safeWeeks * 7 * 24 * 60 * 60 * 1000), until: now }
}

/** Appointments per open day, to one decimal, without trailing ".0". */
function rate(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function people(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return rounded === 1 ? 'person' : 'people'
}

/**
 * Weekday index of a shop-local calendar day.
 *
 * Deliberately parsed as UTC midnight from the date string alone: the day is already local,
 * so converting it again through a timezone would move it. This keeps the answer identical
 * on a server in any zone.
 */
export function weekdayOf(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay()
}

/**
 * Bucket appointment start times into shop-local days.
 *
 * The bucketing is in the shop's timezone, not the server's: an appointment at 11pm Pacific
 * belongs to that day in the shop even though it is the next day in UTC.
 */
export function groupByShopDay(startTimes: Array<Date | string>, timezone: string): ShopDay[] {
  const counts = new Map<string, number>()

  for (const start of startTimes) {
    const when = start instanceof Date ? start : new Date(start)
    if (Number.isNaN(when.getTime())) continue
    const day = ymdInZone(when.toISOString(), timezone)
    if (!ISO_DAY.test(day)) continue
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([date, booked]) => ({ date, booked }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

function nothingToJudge(detail: string): SlowDayReport {
  return {
    state: 'not-configured',
    headline: 'Not enough history to spot a quiet day yet.',
    detail,
    action: 'This fills in on its own as appointments are booked and completed.',
    findings: [],
    judgedWeekdays: 0,
  }
}

export function buildSlowDayReport(input: SlowDayInput): SlowDayReport {
  if (input.days === null) {
    return {
      state: 'could-not-check',
      headline: 'We could not read your calendar just now.',
      detail: 'This is a problem with the check, not with your appointments. Nothing was changed.',
      action: 'Reload the page in a moment. If it keeps happening, ask for a technical review.',
      findings: [],
      judgedWeekdays: 0,
    }
  }

  const minOccurrences = Math.max(1, input.minOccurrences ?? 3)

  // Only real days with a sane count. A negative count is not a fact about a day.
  const days = input.days.filter(
    (day) => day && ISO_DAY.test(day.date) && Number.isFinite(day.booked) && day.booked >= 0,
  )

  if (days.length === 0) {
    return nothingToJudge('There are no open days in the last eight weeks to look at.')
  }

  const totalBooked = days.reduce((sum, day) => sum + day.booked, 0)
  if (totalBooked === 0) {
    return {
      state: 'not-configured',
      headline: 'No appointments are on the book yet.',
      detail:
        'A quiet day is only quiet compared with your own busier days, so there is nothing to compare with yet.',
      action: 'Nothing to do until a few appointments have been booked.',
      findings: [],
      judgedWeekdays: 0,
    }
  }

  const shopAverage = totalBooked / days.length

  const byWeekday = new Map<number, { count: number; booked: number }>()
  for (const day of days) {
    const index = weekdayOf(day.date)
    const bucket = byWeekday.get(index) ?? { count: 0, booked: 0 }
    bucket.count += 1
    bucket.booked += day.booked
    byWeekday.set(index, bucket)
  }

  const findings: SlowDayFinding[] = []
  let judgedWeekdays = 0

  for (const [weekday, bucket] of byWeekday) {
    if (bucket.count < minOccurrences) continue
    judgedWeekdays += 1

    const average = bucket.booked / bucket.count
    const gap = shopAverage - average
    // Two conditions, both needed: clearly below the shop's own average, and at least one
    // booking a day behind. Without the second, a shop booking 0.4 a day everywhere would
    // have "quiet days" that are rounding noise.
    if (average > shopAverage * 0.7 || gap < 1) continue

    const name = WEEKDAY_NAMES[weekday]
    findings.push({
      weekday,
      name,
      averageBooked: Math.round(average * 10) / 10,
      shopAverage: Math.round(shopAverage * 10) / 10,
      percentBelow: Math.round((gap / shopAverage) * 100),
      occurrences: bucket.count,
      basis: `Across ${bucket.count} ${name}s you booked about ${rate(average)} ${people(average)} a day, against ${rate(shopAverage)} on an average day.`,
    })
  }

  if (judgedWeekdays === 0) {
    return nothingToJudge(
      `Each day of the week needs to appear at least ${minOccurrences} times before it can be compared, and none has yet.`,
    )
  }

  if (findings.length === 0) {
    return {
      state: 'healthy',
      headline: 'Your week is fairly even.',
      detail: `No day of the week is far behind the others: every judged day is within 30% of your ${rate(shopAverage)} appointments a day.`,
      action: null,
      findings: [],
      judgedWeekdays,
    }
  }

  findings.sort((a, b) => a.averageBooked - b.averageBooked || a.weekday - b.weekday)
  const top = findings.slice(0, 3)
  const names = top.map((finding) => finding.name)
  const list =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

  const dormant = input.dormantCustomers
  const action =
    typeof dormant === 'number' && dormant > 0
      ? `Invite the ${dormant} ${dormant === 1 ? 'customer' : 'customers'} who have not been back to fill ${names.length === 1 ? 'that day' : 'those days'}.`
      : typeof dormant === 'number' && dormant === 0
        ? 'There is nobody to invite back yet. This becomes actionable once customers have visited and agreed to hear from you.'
        : 'Invite regulars back on that day once your customer list has people who agreed to hear from you.'

  return {
    state: 'needs-attention',
    headline:
      names.length === 1
        ? `${list} is your quietest day.`
        : `${list} are your quietest days.`,
    detail: top[0].basis,
    action,
    findings: top,
    judgedWeekdays,
  }
}

/** The card the growth centre renders. Same shape as every other card on that page. */
export function slowDayCard(report: SlowDayReport): GrowthCard {
  return {
    id: 'slow-days',
    title: 'Quiet days',
    state: report.state,
    headline: report.headline,
    detail: report.detail,
    action: report.action,
  }
}

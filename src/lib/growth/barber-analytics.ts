/**
 * A solo barber's own growth numbers (Priority 5, parts B and C).
 *
 * Seven questions, each answered in one sentence, with the basis stated so the answer can be
 * checked. Two rules run through all of them:
 *
 *  - An answer that could not be computed is null and says so. It is never zero.
 *  - Money is labelled for what it is: taken, refunded, tips (which belong to staff),
 *    commission owed, and expenses that were actually recorded. There is no profit figure,
 *    because this template does not record enough to know one.
 *
 * Pure: the caller supplies the facts and the current time.
 */

export interface AppointmentFact {
  id: string
  startTime: Date
  status: string
  serviceName: string | null
  servicePriceCents: number | null
  source: string | null
  customerId: string
}

export interface PaymentFact {
  grossCents: number
  refundCents: number
  /** Null when this shop does not record tips, so "no tips" and "not recorded" stay distinct. */
  tipCents: number | null
  commissionCents: number | null
}

export interface ReferralFact {
  customerId: string
  referrerCustomerId: string | null
  source: string | null
}

export interface ScheduleFact {
  dayOfWeek: number
  startTime: string
  endTime: string
  isOff: boolean
}

export interface BarberAnalyticsInput {
  appointments: AppointmentFact[] | null
  payments: PaymentFact[] | null
  referrals: ReferralFact[] | null
  schedules: ScheduleFact[] | null
  rangeDays: number
}

export interface Answer {
  id: string
  question: string
  /** The answer as a sentence. Null when it could not be computed. */
  answer: string | null
  value: number | null
  unit: 'money' | 'count' | 'percent' | 'time'
  /** How the answer was worked out, so the barber can check it. */
  basis: string
  unknown: boolean
}

export interface RevenueBreakdown {
  grossCents: number | null
  refundsCents: number | null
  netCents: number | null
  tipsCents: number | null
  commissionsCents: number | null
  /** This template has no expense ledger, so this is always null and labelled as unknown. */
  recordedExpensesCents: null
  labels: Record<string, string>
  note: string
}

export interface BarberAnalyticsResult {
  answers: Answer[]
  revenue: RevenueBreakdown
  notes: string[]
  allRead: boolean
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const COUNTS_AS_SOLD = new Set(['COMPLETED', 'CONFIRMED', 'PENDING', 'RESCHEDULED'])

function money(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function minutesOf(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

function unknownAnswer(id: string, question: string, unit: Answer['unit'], basis: string): Answer {
  return { id, question, answer: null, value: null, unit, basis, unknown: true }
}

export function buildBarberAnalytics(input: BarberAnalyticsInput): BarberAnalyticsResult {
  const { appointments, payments, referrals, schedules } = input
  const days = Math.max(1, Math.round(input.rangeDays))
  const answers: Answer[] = []

  // ─── 1. Best booking channel by new customers ────────────────────────────
  if (!referrals) {
    answers.push(unknownAnswer('channel', 'Where did your new customers come from?', 'count', 'Referral and source records could not be read.'))
  } else {
    const byChannel = new Map<string, number>()
    for (const row of referrals) {
      const channel = row.referrerCustomerId ? 'Customer referral' : (row.source ?? 'Not recorded')
      byChannel.set(channel, (byChannel.get(channel) ?? 0) + 1)
    }
    const ranked = Array.from(byChannel, ([channel, count]) => ({ channel, count })).sort((a, b) => b.count - a.count)
    answers.push(ranked.length === 0
      ? { id: 'channel', question: 'Where did your new customers come from?', answer: 'No new customer has been attributed yet.', value: 0, unit: 'count', basis: 'No referral or source record exists for this period.', unknown: false }
      : { id: 'channel', question: 'Where did your new customers come from?', answer: `${ranked[0].channel} brought ${ranked[0].count} new customer${ranked[0].count === 1 ? '' : 's'}.`, value: ranked[0].count, unit: 'count', basis: `Counted attributed customers by channel: ${ranked.map((r) => `${r.channel} ${r.count}`).join(', ')}.`, unknown: false })
  }

  // ─── 2. Top services by money taken ──────────────────────────────────────
  if (!appointments) {
    answers.push(unknownAnswer('services', 'Which services earn you the most?', 'money', 'Appointments could not be read.'))
  } else {
    const completed = appointments.filter((a) => a.status === 'COMPLETED')
    const byService = new Map<string, { cents: number; count: number }>()
    let anyPriceUnknown = false
    for (const appointment of completed) {
      const name = appointment.serviceName ?? 'Service not recorded'
      if (appointment.servicePriceCents === null) { anyPriceUnknown = true; continue }
      const current = byService.get(name) ?? { cents: 0, count: 0 }
      byService.set(name, { cents: current.cents + appointment.servicePriceCents, count: current.count + 1 })
    }
    const ranked = Array.from(byService, ([name, value]) => ({ name, ...value })).sort((a, b) => b.cents - a.cents)
    answers.push(ranked.length === 0
      ? { id: 'services', question: 'Which services earn you the most?', answer: 'No completed appointment with a recorded price in this period.', value: 0, unit: 'money', basis: 'Only completed appointments with a price are counted.', unknown: false }
      : { id: 'services', question: 'Which services earn you the most?', answer: `${ranked[0].name} earned ${money(ranked[0].cents)} from ${ranked[0].count} appointment${ranked[0].count === 1 ? '' : 's'}.`, value: ranked[0].cents, unit: 'money', basis: `Completed appointments grouped by service.${anyPriceUnknown ? ' Some appointments had no recorded price and were left out.' : ''}`, unknown: false })
  }

  // ─── 3. Returning customers ──────────────────────────────────────────────
  if (!appointments) {
    answers.push(unknownAnswer('returning', 'How many customers came back?', 'count', 'Appointments could not be read.'))
  } else {
    const visits = new Map<string, number>()
    for (const appointment of appointments) {
      if (appointment.status !== 'COMPLETED') continue
      visits.set(appointment.customerId, (visits.get(appointment.customerId) ?? 0) + 1)
    }
    const returning = Array.from(visits.values()).filter((count) => count > 1).length
    const total = visits.size
    answers.push({
      id: 'returning',
      question: 'How many customers came back?',
      answer: total === 0
        ? 'No completed appointment in this period.'
        : `${returning} of ${total} customer${total === 1 ? '' : 's'} came more than once.`,
      value: returning,
      unit: 'count',
      basis: 'Customers with more than one completed appointment in this period.',
      unknown: false,
    })
  }

  // ─── 4. Referrals ────────────────────────────────────────────────────────
  if (!referrals) {
    answers.push(unknownAnswer('referrals', 'How many customers did you refer in?', 'count', 'Referral records could not be read.'))
  } else {
    const referred = referrals.filter((r) => r.referrerCustomerId !== null).length
    answers.push({
      id: 'referrals',
      question: 'How many customers did you refer in?',
      answer: referred === 0 ? 'No customer was referred by another customer in this period.' : `${referred} customer${referred === 1 ? ' was' : 's were'} referred by another customer.`,
      value: referred,
      unit: 'count',
      basis: 'Attributions that name the customer who referred them.',
      unknown: false,
    })
  }

  // ─── 5. Quietest times, so gaps can be filled ────────────────────────────
  if (!appointments || !schedules) {
    answers.push(unknownAnswer('quiet', 'When is your diary least busy?', 'percent', 'Appointments or opening hours could not be read.'))
  } else {
    const openByDay = new Map<number, number>()
    for (const row of schedules) {
      if (row.isOff) continue
      const start = minutesOf(row.startTime)
      const end = minutesOf(row.endTime)
      if (start === null || end === null || end <= start) continue
      openByDay.set(row.dayOfWeek, (openByDay.get(row.dayOfWeek) ?? 0) + (end - start))
    }
    const bookedByDay = new Map<number, number>()
    for (const appointment of appointments) {
      if (!COUNTS_AS_SOLD.has(appointment.status)) continue
      const day = appointment.startTime.getDay()
      // A booked appointment occupies the slot; without a duration we use a 30-minute
      // assumption and say so, rather than inventing precision.
      bookedByDay.set(day, (bookedByDay.get(day) ?? 0) + 30)
    }
    const weeks = Math.max(1, Math.round(days / 7))
    const rows = Array.from(openByDay, ([day, openMinutes]) => {
      const booked = bookedByDay.get(day) ?? 0
      const available = openMinutes * weeks
      const percent = available > 0 ? Math.min(100, Math.round((booked / available) * 100)) : null
      return { day, percent }
    }).filter((row): row is { day: number; percent: number } => row.percent !== null).sort((a, b) => a.percent - b.percent)

    answers.push(rows.length === 0
      ? unknownAnswer('quiet', 'When is your diary least busy?', 'percent', 'No readable opening hours were found.')
      : { id: 'quiet', question: 'When is your diary least busy?', answer: `${DAY_NAMES[rows[0].day]} is your quietest day, about ${rows[0].percent}% full.`, value: rows[0].percent, unit: 'percent', basis: 'Booked time compared with the hours you are open, per weekday. A booked appointment is assumed to take 30 minutes.', unknown: false })
  }

  // ─── 6. Money lost to cancellations ──────────────────────────────────────
  if (!appointments) {
    answers.push(unknownAnswer('lost', 'How much did cancellations cost you?', 'money', 'Appointments could not be read.'))
  } else {
    const cancelled = appointments.filter((a) => a.status === 'CANCELLED')
    const noShows = appointments.filter((a) => a.status === 'NO_SHOW')
    const priced = [...cancelled, ...noShows].filter((a) => a.servicePriceCents !== null)
    const unpriced = [...cancelled, ...noShows].length - priced.length
    const lostCents = priced.reduce((sum, a) => sum + (a.servicePriceCents ?? 0), 0)
    answers.push({
      id: 'lost',
      question: 'How much did cancellations cost you?',
      answer: `${money(lostCents)} of booked work was cancelled or missed (${cancelled.length} cancelled, ${noShows.length} no-show).`,
      value: lostCents,
      unit: 'money',
      basis: `Cancelled and missed appointments priced at their service price.${unpriced > 0 ? ` ${unpriced} had no recorded price and were left out.` : ''}`,
      unknown: false,
    })
  }

  // ─── 7. Revenue, labelled honestly ───────────────────────────────────────
  const sumOrNull = (pick: (p: PaymentFact) => number | null): number | null => {
    let total = 0
    for (const payment of payments ?? []) {
      const value = pick(payment)
      if (value === null) return null
      total += value
    }
    return total
  }

  const revenue: RevenueBreakdown = payments
    ? {
        grossCents: payments.reduce((sum, p) => sum + p.grossCents, 0),
        refundsCents: payments.reduce((sum, p) => sum + p.refundCents, 0),
        netCents: payments.reduce((sum, p) => sum + p.grossCents - p.refundCents, 0),
        tipsCents: sumOrNull((p) => p.tipCents),
        commissionsCents: sumOrNull((p) => p.commissionCents),
        recordedExpensesCents: null,
        labels: {
          grossCents: 'Money taken before refunds',
          refundsCents: 'Money refunded',
          netCents: 'Money taken after refunds',
          tipsCents: 'Tips, which belong to the barber who earned them',
          commissionsCents: 'Commission owed to you from this work',
          recordedExpensesCents: 'Expenses you have recorded',
        },
        note: 'No profit figure is shown. This template does not record enough of your costs to know one, so a profit number would be a guess. A money row shown as blank was not recorded, which is not the same as being zero.',
      }
    : {
        grossCents: null, refundsCents: null, netCents: null, tipsCents: null, commissionsCents: null,
        recordedExpensesCents: null,
        labels: {
          grossCents: 'Money taken before refunds',
          refundsCents: 'Money refunded',
          netCents: 'Money taken after refunds',
          tipsCents: 'Tips, which belong to the barber who earned them',
          commissionsCents: 'Commission owed to you from this work',
          recordedExpensesCents: 'Expenses you have recorded',
        },
        note: 'Payments could not be read, so no money figure is shown.',
      }

  const notes: string[] = []
  notes.push('Every figure here covers the period you chose and nothing else.')
  notes.push('An answer that could not be worked out is left blank rather than shown as zero.')
  if (!payments) notes.push('Money figures are missing because payments could not be read.')
  notes.push('There is no profit figure. Costs are only known where you record them.')

  const allRead = answers.every((a) => !a.unknown) && payments !== null

  return { answers, revenue, notes, allRead }
}

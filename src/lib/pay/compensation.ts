/**
 * Pay arithmetic for the four compensation models the owner approved on 2026-11-18.
 *
 * The rule that matters most: an input we cannot read makes the answer UNKNOWN, never
 * zero. A barber whose hours were not recorded has not earned nothing, and a payroll
 * screen that says £0 is worse than one that says it cannot tell.
 */

export type CompensationModelName = 'COMMISSION' | 'HOURLY' | 'BOOTH_RENTAL' | 'HYBRID'

export interface PayInput {
  model: string | null | undefined
  /** Service revenue the barber generated in the period, before commission. */
  serviceRevenue: number | null
  /** Percentage, as stored on Barber.commissionRate or PaymentSettings. */
  commissionRate: number | null
  /** Hours actually worked. Supplied by the caller; never inferred from appointments. */
  hoursWorked: number | null
  hourlyRate: number | null
  boothRentAmount: number | null
  boothRentPeriod: string | null
  /** The payroll period being calculated. */
  payPeriod: string | null
  /** HYBRID only: commission applies above this revenue. Null = all revenue. */
  commissionThreshold?: number | null
  /**
   * Commission already computed by the ledger (with the shop's overrides and tip
   * rules applied). When supplied, it is used instead of rate x revenue, so payroll
   * never recalculates money the ledger has already decided.
   */
  commissionAmount?: number | null
}

export interface PayResult {
  amount: number | null
  known: boolean
  explanation: string
  /** Money the barber owes the shop, when rent exceeds revenue. */
  owed: number | null
}

const money = (n: number) => Math.round(n * 100) / 100

const unknown = (explanation: string): PayResult => ({ amount: null, known: false, explanation, owed: null })

function commissionOn(revenue: number, rate: number, threshold: number | null | undefined) {
  const base = typeof threshold === 'number' && threshold > 0 ? Math.max(0, revenue - threshold) : revenue
  return money((base * rate) / 100)
}

function rentForPeriod(rent: number, rentPeriod: string | null, payPeriod: string | null): number | null {
  const rent_ = (rentPeriod ?? 'WEEKLY').toUpperCase()
  const pay = (payPeriod ?? '').toUpperCase()
  if (rent_ === pay) return rent
  // Prorating a monthly rent into a weekly period is a policy decision the owner has not
  // made. Refusing to guess is the honest answer, not multiplying by four over three.
  return null
}

export function calculatePay(input: PayInput): PayResult {
  const model = (input.model ?? 'COMMISSION').toUpperCase() as CompensationModelName

  if (model === 'COMMISSION') {
    if (typeof input.commissionAmount === 'number') {
      return { amount: money(input.commissionAmount), known: true, explanation: 'Commission from the commission ledger.', owed: null }
    }
    if (input.serviceRevenue === null) return unknown('Service revenue for this period could not be read.')
    if (input.commissionRate === null) return unknown('No commission rate is set for this barber or the shop.')
    return {
      amount: commissionOn(input.serviceRevenue, input.commissionRate, input.commissionThreshold),
      known: true,
      explanation: `${input.commissionRate}% of service revenue.`,
      owed: null,
    }
  }

  if (model === 'HOURLY') {
    if (input.hoursWorked === null) return unknown('Hours worked for this period were not recorded.')
    if (input.hourlyRate === null) return unknown('No hourly rate is set for this barber.')
    return {
      amount: money(input.hoursWorked * input.hourlyRate),
      known: true,
      explanation: `${input.hoursWorked} hours at the hourly rate.`,
      owed: null,
    }
  }

  if (model === 'BOOTH_RENTAL') {
    if (input.serviceRevenue === null) return unknown('Service revenue for this period could not be read.')
    if (input.boothRentAmount === null) return unknown('No booth rent amount is set for this barber.')
    const rent = rentForPeriod(input.boothRentAmount, input.boothRentPeriod, input.payPeriod)
    if (rent === null)
      return unknown('The rent period and the pay period do not match, and prorating is not a decision that has been made.')
    const net = money(input.serviceRevenue - rent)
    return {
      amount: Math.max(0, net),
      known: true,
      explanation: net < 0 ? 'Service revenue did not cover the booth rent this period.' : 'Service revenue after booth rent.',
      owed: net < 0 ? money(-net) : null,
    }
  }

  if (model === 'HYBRID') {
    const base =
      input.hourlyRate !== null
        ? input.hoursWorked === null
          ? null
          : money(input.hoursWorked * input.hourlyRate)
        : input.boothRentAmount !== null
          ? rentForPeriod(input.boothRentAmount, input.boothRentPeriod, input.payPeriod)
          : null
    if (base === null) return unknown('The base for this hybrid barber could not be worked out.')
    if (input.serviceRevenue === null && typeof input.commissionAmount !== 'number')
      return unknown('Service revenue for this period could not be read.')
    let extra: number
    if (typeof input.commissionAmount === 'number') {
      extra = money(input.commissionAmount)
    } else {
      if (input.commissionRate === null) return unknown('No commission rate is set for the commission part of hybrid pay.')
      extra = commissionOn(input.serviceRevenue as number, input.commissionRate, input.commissionThreshold)
    }
    return {
      amount: money(base + extra),
      known: true,
      explanation: 'Base plus commission on service revenue.',
      owed: null,
    }
  }

  return unknown('This barber has a compensation model the payroll screen does not recognise.')
}

export interface PayoutInput extends PayInput {
  /** Manual and refund adjustments already on the ledger for this period. */
  adjustments?: number
  /** Tips that belong to the barber under the shop's tips mode. */
  tipsOwned?: number
}

export interface PayoutResult {
  amount: number
  known: boolean
  note: string | null
  owed: number | null
}

/**
 * The figure payroll freezes into a report: model pay, plus adjustments, plus tips.
 *
 * When the model's own inputs are missing, the payout falls back to the commission the
 * ledger already recorded, and says so. It never invents a zero, and it never presents a
 * fallback as if the model had been calculated.
 */
export function resolvePayout(input: PayoutInput): PayoutResult {
  const adjustments = input.adjustments ?? 0
  const tipsOwned = input.tipsOwned ?? 0
  const pay = calculatePay(input)
  const tail = money(adjustments + tipsOwned)
  if (pay.known) {
    return { amount: money((pay.amount ?? 0) + tail), known: true, note: pay.explanation, owed: pay.owed }
  }
  const fallback = money((input.commissionAmount ?? 0) + tail)
  return {
    amount: fallback,
    known: false,
    note: `${pay.explanation} Showing the commission figure instead, so nothing is understated or invented.`,
    owed: null,
  }
}

export interface StoredLineExplanation {
  payoutKnown: boolean
  payoutNote: string
}

/**
 * The sentence that belongs beside a figure already frozen into a report.
 *
 * Nothing is stored: a report keeps its money, and the explanation is re-derived from the
 * barber's model and the numbers the report already holds. That is why this needed no
 * migration, and why an old report can suddenly gain a clearer note without its figures
 * moving by a cent.
 */
export function explainStoredLine(input: {
  model: string | null | undefined
  serviceRevenue: number
  commission: number
  regularHours: number
  overtimeHours: number
  hourlyRate: number | null
  boothRentAmount: number | null
  boothRentPeriod: string | null
  payPeriod: string | null
}): StoredLineExplanation {
  const hours = input.regularHours + input.overtimeHours
  const pay = calculatePay({
    model: input.model,
    serviceRevenue: input.serviceRevenue,
    commissionRate: null,
    commissionAmount: input.commission,
    hoursWorked: hours > 0 ? hours : null,
    hourlyRate: input.hourlyRate,
    boothRentAmount: input.boothRentAmount,
    boothRentPeriod: input.boothRentPeriod,
    payPeriod: input.payPeriod,
  })
  if (pay.known) return { payoutKnown: true, payoutNote: pay.explanation }
  return {
    payoutKnown: false,
    payoutNote: `${pay.explanation} The figure shown is the commission recorded for this period, plus tips and adjustments.`,
  }
}

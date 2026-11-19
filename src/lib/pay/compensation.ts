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
    if (input.serviceRevenue === null) return unknown('Service revenue for this period could not be read.')
    if (input.commissionRate === null) return unknown('No commission rate is set for the commission part of hybrid pay.')
    const extra = commissionOn(input.serviceRevenue, input.commissionRate, input.commissionThreshold)
    return {
      amount: money(base + extra),
      known: true,
      explanation: 'Base plus commission on service revenue.',
      owed: null,
    }
  }

  return unknown('This barber has a compensation model the payroll screen does not recognise.')
}

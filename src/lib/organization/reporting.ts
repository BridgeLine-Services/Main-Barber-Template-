/**
 * Consolidated organization reporting (Priority 2 stage 3, Priority 3 part D).
 *
 * The report is aggregates only. It has no customer identity field, no customer list and
 * no per-person history, because the corporate permission to see totals is not the
 * permission to open a profile. `aggregateOnlyGuard` in privacy.ts is run over the output
 * by the route, so that cannot change quietly.
 *
 * Honesty rules, each tested:
 *  - A total is null when any contributing location is null. An unverifiable total is not
 *    a total.
 *  - Gross sales, refunds, net, commissions, recorded expenses and estimates are labelled
 *    separately. There is no "profit" figure anywhere, because expenses are only known
 *    where a shop records them.
 */

export interface LocationRollup {
  businessId: string
  name: string
  region: string | null
  status: string
  grossRevenueCents: number | null
  refundsCents: number | null
  netRevenueCents: number | null
  commissionsCents: number | null
  recordedExpensesCents: number | null
  appointments: number | null
  completed: number | null
  cancelled: number | null
  newCustomers: number | null
  returningCustomers: number | null
  activeMemberships: number | null
  membershipRevenueCents: number | null
  /** Derived from booked minutes over open minutes. Always an estimate. */
  utilisationPercent: number | null
  staffCount: number | null
}

export type TotalKey =
  | 'grossRevenueCents'
  | 'refundsCents'
  | 'netRevenueCents'
  | 'commissionsCents'
  | 'recordedExpensesCents'
  | 'appointments'
  | 'completed'
  | 'cancelled'
  | 'newCustomers'
  | 'returningCustomers'
  | 'activeMemberships'
  | 'membershipRevenueCents'
  | 'staffCount'

export interface OrganizationTotals extends Partial<Record<TotalKey, number | null>> {
  /** Never a profit figure. Present so the UI can say what it does not know. */
  profitCents: null
}

export interface OrganizationReport {
  organizationId: string
  generatedAt: string
  rangeLabel: string
  locations: LocationRollup[]
  totals: OrganizationTotals
  /** Which locations had at least one unreadable figure. */
  unverifiedLocations: string[]
  labels: Record<string, string>
  notes: string[]
  /** Always true: this report is aggregates only. */
  aggregateOnly: true
}

const TOTAL_KEYS: TotalKey[] = [
  'grossRevenueCents',
  'refundsCents',
  'netRevenueCents',
  'commissionsCents',
  'recordedExpensesCents',
  'appointments',
  'completed',
  'cancelled',
  'newCustomers',
  'returningCustomers',
  'activeMemberships',
  'membershipRevenueCents',
  'staffCount',
]

/** Figures that are genuinely not recorded in this template, so their absence is not a failed read. */
const NOT_RECORDED: TotalKey[] = ['recordedExpensesCents', 'membershipRevenueCents']

function sumOrNull(rows: LocationRollup[], key: TotalKey): number | null {
  let total = 0
  for (const row of rows) {
    const value = row[key]
    if (value === null || value === undefined) return null
    total += value
  }
  return total
}

export const REPORT_LABELS: Record<string, string> = {
  grossRevenueCents: 'Money taken before refunds',
  refundsCents: 'Money refunded',
  netRevenueCents: 'Money taken after refunds',
  commissionsCents: 'Commission owed to staff (money that is not yours to keep)',
  recordedExpensesCents: 'Expenses a location has actually recorded',
  appointments: 'Appointments booked',
  completed: 'Appointments completed',
  cancelled: 'Appointments cancelled',
  newCustomers: 'Customers seen for the first time',
  returningCustomers: 'Customers who had been before',
  activeMemberships: 'Memberships currently active',
  membershipRevenueCents: 'Membership money billed',
  utilisationPercent: 'How full the diary was (an estimate)',
  staffCount: 'People working at the location',
}

export function buildOrganizationReport(
  organizationId: string,
  locations: LocationRollup[],
  options: { generatedAt: string; rangeLabel: string },
): OrganizationReport {
  const totals: OrganizationTotals = { profitCents: null }
  for (const key of TOTAL_KEYS) totals[key] = sumOrNull(locations, key)

  const unverifiedLocations = locations
    .filter((l) => TOTAL_KEYS.filter((key) => !NOT_RECORDED.includes(key)).some((key) => l[key] === null))
    .map((l) => l.name)

  const notes: string[] = []
  notes.push('These figures are totals for the organization. They do not include individual customer records.')
  if (unverifiedLocations.length > 0) {
    notes.push(`Some figures could not be read at ${unverifiedLocations.join(', ')}, so the matching totals are shown as unknown rather than as zero.`)
  }
  notes.push('Utilisation is an estimate: it compares booked minutes with the hours a location is open.')
  notes.push('No profit figure is shown. Expenses are only known where a location records them, so a profit number would be a guess.')

  return {
    organizationId,
    generatedAt: options.generatedAt,
    rangeLabel: options.rangeLabel,
    locations,
    totals,
    unverifiedLocations,
    labels: REPORT_LABELS,
    notes,
    aggregateOnly: true,
  }
}

/** One sentence for the top of the page. */
export function describeOrganizationReport(report: OrganizationReport): string {
  const count = report.locations.length
  const revenue = report.totals.netRevenueCents
  const money = revenue === null || revenue === undefined
    ? 'revenue could not be totalled'
    : `${(revenue / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} taken after refunds`
  return `${count} location${count === 1 ? '' : 's'}, ${money}, ${report.rangeLabel}.`
}

/**
 * Marketing performance (Section 12 of the platform brief), as pure logic.
 *
 * The brief is explicit: report campaign revenue and repeat visits "where the data
 * supports it", and do not invent numbers the data cannot support. `MarketingCampaign`
 * records a name, an audience, a status, a send time and a recipient count. It records no
 * opens, no clicks and no revenue. So this module computes what is real, and states plainly
 * what is not measurable yet instead of filling the gap with a guess.
 */

export interface CampaignRow {
  id: string
  name: string
  audience: string
  status: string
  sentAt: Date | string | null
  recipientCount: number | null
}

export interface AttributionRow {
  customerId: string
  source: string | null
  referrerCustomerId: string | null
}

export interface VisitRow {
  customerId: string
  startTime: Date | string
  status: string
}

export interface CampaignSummary {
  sent: number
  drafts: number
  recipientsReached: number
  /** Sent campaigns per audience, highest first. */
  byAudience: Array<{ audience: string; sent: number; recipients: number }>
}

export interface SourceSummary {
  source: string
  customers: number
  /** Customers from this source with two or more completed visits. */
  returning: number
  /** Share of this source's customers who came back, 0 to 1. */
  repeatRate: number
}

export interface MarketingPerformance {
  campaigns: CampaignSummary
  sources: SourceSummary[]
  totals: { attributedCustomers: number; returningCustomers: number; repeatRate: number }
  /** What this shop cannot measure yet, in words, so nobody reads absence as zero. */
  notMeasurable: string[]
}

const UNKNOWN_SOURCE = 'UNKNOWN'

function normaliseSource(source: string | null): string {
  const value = (source ?? '').trim().toUpperCase()
  return value.length > 0 ? value : UNKNOWN_SOURCE
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function summariseCampaigns(campaigns: CampaignRow[]): CampaignSummary {
  const sent = campaigns.filter((campaign) => campaign.status === 'SENT' && campaign.sentAt !== null)
  const drafts = campaigns.filter((campaign) => campaign.status === 'DRAFT').length
  const recipientsReached = sent.reduce((sum, campaign) => sum + Math.max(0, campaign.recipientCount ?? 0), 0)

  const grouped = new Map<string, { sent: number; recipients: number }>()
  for (const campaign of sent) {
    const current = grouped.get(campaign.audience) ?? { sent: 0, recipients: 0 }
    current.sent += 1
    current.recipients += Math.max(0, campaign.recipientCount ?? 0)
    grouped.set(campaign.audience, current)
  }

  const byAudience = [...grouped.entries()]
    .map(([audience, counts]) => ({ audience, sent: counts.sent, recipients: counts.recipients }))
    .sort((a, b) => b.sent - a.sent || a.audience.localeCompare(b.audience))

  return { sent: sent.length, drafts, recipientsReached, byAudience }
}

export function summariseSources(attributions: AttributionRow[], visits: VisitRow[]): SourceSummary[] {
  const completedByCustomer = new Map<string, number>()
  for (const visit of visits) {
    if (visit.status !== 'COMPLETED') continue
    completedByCustomer.set(visit.customerId, (completedByCustomer.get(visit.customerId) ?? 0) + 1)
  }

  const bySource = new Map<string, { customers: Set<string>; returning: Set<string> }>()
  for (const attribution of attributions) {
    const source = normaliseSource(attribution.source)
    const entry = bySource.get(source) ?? { customers: new Set<string>(), returning: new Set<string>() }
    entry.customers.add(attribution.customerId)
    if ((completedByCustomer.get(attribution.customerId) ?? 0) >= 2) entry.returning.add(attribution.customerId)
    bySource.set(source, entry)
  }

  return [...bySource.entries()]
    .map(([source, entry]) => ({
      source,
      customers: entry.customers.size,
      returning: entry.returning.size,
      repeatRate: entry.customers.size === 0 ? 0 : round2(entry.returning.size / entry.customers.size),
    }))
    .sort((a, b) => b.customers - a.customers || a.source.localeCompare(b.source))
}

/** The sentence a shop reads about what is not measured. Fixed, because it is a fact about
 *  the schema, not about one shop's numbers. */
export const NOT_MEASURABLE = [
  'Opens and clicks are not recorded, so no open or click rate can be reported.',
  'Revenue is not recorded against a campaign, so revenue is attributed by booking source, never by campaign.',
  'A campaign send is not linked to the appointments it produced, so no per-campaign return is claimed.',
] as const

export function marketingPerformance(input: {
  campaigns: CampaignRow[]
  attributions: AttributionRow[]
  visits: VisitRow[]
}): MarketingPerformance {
  const campaigns = summariseCampaigns(input.campaigns)
  const sources = summariseSources(input.attributions, input.visits)
  const attributedCustomers = sources.reduce((sum, entry) => sum + entry.customers, 0)
  const returningCustomers = sources.reduce((sum, entry) => sum + entry.returning, 0)
  return {
    campaigns,
    sources,
    totals: {
      attributedCustomers,
      returningCustomers,
      repeatRate: attributedCustomers === 0 ? 0 : round2(returningCustomers / attributedCustomers),
    },
    notMeasurable: [...NOT_MEASURABLE],
  }
}

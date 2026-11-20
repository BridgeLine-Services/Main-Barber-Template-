/**
 * Referral attribution (Priority 5, part A).
 *
 * The hard part of referral tracking is not counting referrals; it is not counting the same
 * customer twice and not crediting someone for referring themselves. So attribution is a
 * decision with stated reasons, and the database carries a unique key on the customer as a
 * second line of defence.
 *
 * Pure: no network, no database, no clock.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I, O, 0, 1: a code read aloud without mistakes

export function normaliseReferralCode(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
}

/** Deterministic code from a prefix and a customer id, with an attempt salt for collisions. */
export function buildReferralCode(prefix: string, customerId: string, attempt = 0): string {
  const cleanPrefix = normaliseReferralCode(prefix).slice(0, 4) || 'REF'
  let hash = 2166136261
  const seed = `${customerId}:${attempt}`
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  let body = ''
  let value = hash
  for (let i = 0; i < 6; i++) {
    body += ALPHABET[value % ALPHABET.length]
    value = Math.floor(value / ALPHABET.length)
  }
  return `${cleanPrefix}${body}`
}

export function referralLink(baseUrl: string, code: string): string {
  const normalised = normaliseReferralCode(code)
  if (!normalised) return baseUrl
  try {
    const url = new URL(baseUrl)
    url.searchParams.set('ref', normalised)
    return url.toString()
  } catch {
    const separator = baseUrl.includes('?') ? '&' : '?'
    return `${baseUrl}${separator}ref=${normalised}`
  }
}

export interface ReferralParams {
  code: string
  source: string | null
  campaign: string | null
}

/** Read what arrived on a booking link. Unknown keys are ignored, never invented. */
export function parseReferralParams(params: { get(name: string): string | null }): ReferralParams {
  const code = normaliseReferralCode(params.get('ref') ?? params.get('code'))
  const sourceRaw = (params.get('source') ?? '').trim().toLowerCase()
  const source = sourceRaw ? sourceRaw.replace(/[^a-z0-9_-]/g, '').slice(0, 32) || null : null
  const campaignRaw = (params.get('campaign') ?? '').trim()
  return { code, source, campaign: campaignRaw ? campaignRaw.slice(0, 64) : null }
}

export interface AttributionInput {
  businessId: string
  customerId: string
  existing: { customerId: string; referrerCustomerId: string | null } | null
  referrerCustomerId: string | null
  code: string | null
  source: string | null
  campaign: string | null
  appointmentId: string | null
  /** True only for this customer's first visit at this business. */
  isFirstVisit: boolean
}

export interface AttributionRecord {
  businessId: string
  customerId: string
  referrerCustomerId: string | null
  code: string | null
  source: string | null
  campaign: string | null
  appointmentId: string | null
}

export interface AttributionDecision {
  attribute: boolean
  reason: string
  record: AttributionRecord | null
}

export function decideAttribution(input: AttributionInput): AttributionDecision {
  if (input.existing) {
    return { attribute: false, reason: 'This customer is already attributed, so a second referral would be double counting.', record: null }
  }
  if (input.referrerCustomerId && input.referrerCustomerId === input.customerId) {
    return { attribute: false, reason: 'A customer cannot refer themselves.', record: null }
  }
  if (!input.isFirstVisit) {
    return { attribute: false, reason: 'Only a customer’s first visit is attributed, so a returning visit is not counted again.', record: null }
  }
  if (!input.code && !input.source) {
    return { attribute: false, reason: 'There is no referral code and no marketing source, so there is nothing to attribute.', record: null }
  }
  return {
    attribute: true,
    reason: input.code
      ? 'A referral code was used on this customer’s first visit.'
      : 'A marketing source was recorded on this customer’s first visit.',
    record: {
      businessId: input.businessId,
      customerId: input.customerId,
      referrerCustomerId: input.referrerCustomerId,
      code: input.code,
      source: input.source,
      campaign: input.campaign,
      appointmentId: input.appointmentId,
    },
  }
}

export interface ReferralRow {
  customerId: string
  referrerCustomerId: string | null
  source: string | null
  revenueCents: number | null
  bookings: number
}

export interface ReferralMetrics {
  referredCustomers: number
  converted: number
  conversionRate: number | null
  repeatBookings: number
  referralRevenueCents: number | null
  shareOfRevenuePercent: number | null
  byChannel: Array<{ channel: string; customers: number }>
  note: string
}

/**
 * A revenue total is null when any referred customer's revenue is unknown, because a partial
 * sum presented as a total is a wrong number.
 */
export function summariseReferrals(rows: ReferralRow[] | null, totalRevenueCents: number | null): ReferralMetrics {
  if (rows === null) {
    return {
      referredCustomers: 0, converted: 0, conversionRate: null, repeatBookings: 0,
      referralRevenueCents: null, shareOfRevenuePercent: null, byChannel: [],
      note: 'Referrals could not be read just now.',
    }
  }
  const referredCustomers = rows.length
  const converted = rows.filter((r) => r.bookings > 0).length
  const repeatBookings = rows.filter((r) => r.bookings > 1).length
  const allKnown = rows.every((r) => r.revenueCents !== null)
  const referralRevenueCents = allKnown ? rows.reduce((sum, r) => sum + (r.revenueCents ?? 0), 0) : null
  const shareOfRevenuePercent = referralRevenueCents !== null && totalRevenueCents !== null && totalRevenueCents > 0
    ? Math.round((referralRevenueCents / totalRevenueCents) * 1000) / 10
    : null

  const channels = new Map<string, number>()
  for (const row of rows) {
    const channel = row.referrerCustomerId ? 'Customer referral' : (row.source ?? 'Unknown source')
    channels.set(channel, (channels.get(channel) ?? 0) + 1)
  }

  return {
    referredCustomers,
    converted,
    conversionRate: referredCustomers > 0 ? Math.round((converted / referredCustomers) * 1000) / 10 : null,
    repeatBookings,
    referralRevenueCents,
    shareOfRevenuePercent,
    byChannel: Array.from(channels, ([channel, customers]) => ({ channel, customers })).sort((a, b) => b.customers - a.customers),
    note: allKnown
      ? 'Every referred customer’s revenue was read.'
      : 'Some referred customers’ revenue could not be read, so the referral total is unknown.',
  }
}

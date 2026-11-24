/**
 * Location price approvals (Priority 3, part E, the part that was missing).
 *
 * A location may ask to charge something different from the corporate standard. The ask is
 * a record, not an edit: nothing about the shop's price changes until an authorized
 * corporate user approves it, and the previous value stays readable either way.
 *
 * Every refusal here says what to do instead, because a price that silently stays at the
 * standard price is worse than one that says why.
 */

import { can, type OrgRole } from './capabilities'

export type PriceRequestStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'REVOKED'

export const PRICE_REQUEST_STATUSES: PriceRequestStatus[] = ['PENDING', 'APPROVED', 'DECLINED', 'REVOKED']

/** A thousand dollars is a typo guard, not a business rule. */
export const MAX_PRICE_CENTS = 100000
export const MIN_REASON_LENGTH = 10

export interface PriceRequestInput {
  templateName?: string | null
  templateActive?: boolean | null
  standardPriceCents?: number | null
  requestedPriceCents?: number | null
  reason?: string | null
  businessId?: string | null
  /** Locations the requester may act on, resolved on the server from the session. */
  allowedBusinessIds: string[]
}

export interface Verdict {
  allowed: boolean
  reason: string
}

export function validatePriceRequest(input: PriceRequestInput): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!input.templateName) errors.push('Choose the service this price is for.')
  if (input.templateActive === false) {
    errors.push('That service is switched off. Switch it on before asking for a different price.')
  }
  if (!input.businessId) errors.push('Choose the location asking for this price.')
  else if (!input.allowedBusinessIds.includes(input.businessId)) {
    errors.push('You can only ask for a price at a location you are assigned to.')
  }

  const requested = input.requestedPriceCents
  if (requested === null || requested === undefined || !Number.isFinite(requested)) {
    errors.push('Enter the price you want to charge.')
  } else if (!Number.isInteger(requested) || requested <= 0) {
    errors.push('Enter a price in whole cents above zero.')
  } else if (requested > MAX_PRICE_CENTS) {
    errors.push('That price looks like a mistake. The most that can be requested is $1000.')
  } else if (requested === input.standardPriceCents) {
    errors.push('That is already the standard price, so there is nothing to approve.')
  }

  const reason = (input.reason ?? '').trim()
  if (reason.length < MIN_REASON_LENGTH) {
    errors.push('Say why this location needs a different price, in at least 10 characters.')
  }
  return { valid: errors.length === 0, errors }
}

/** Who may ask: anyone who can read services at a location they are assigned to. */
export function requestVerdict(role: OrgRole, input: PriceRequestInput): Verdict {
  if (!can(role, 'services.read')) {
    return { allowed: false, reason: 'Your role cannot see service prices.' }
  }
  if (!input.businessId || !input.allowedBusinessIds.includes(input.businessId)) {
    return { allowed: false, reason: 'You can only ask for a price at a location you are assigned to.' }
  }
  return { allowed: true, reason: 'You may ask for a different price at this location.' }
}

/** Who may decide: corporate users with services.manage. A location never approves itself. */
export function decisionVerdict(role: OrgRole, status: string): Verdict {
  if (!can(role, 'services.manage')) {
    return { allowed: false, reason: 'Only an organization owner or corporate admin can decide a price request.' }
  }
  if (status !== 'PENDING') {
    return { allowed: false, reason: `This request was already ${statusWords(status).toLowerCase()}.` }
  }
  return { allowed: true, reason: 'You may decide this request.' }
}

export function revokeVerdict(role: OrgRole, status: string): Verdict {
  if (!can(role, 'services.manage')) {
    return { allowed: false, reason: 'Only an organization owner or corporate admin can revoke an approved price.' }
  }
  if (status !== 'APPROVED') {
    return { allowed: false, reason: 'Only an approved price can be revoked.' }
  }
  return { allowed: true, reason: 'You may revoke this approved price. The location returns to the standard price.' }
}

export function statusWords(status: string): string {
  switch (status) {
    case 'PENDING':
      return 'Waiting for a decision'
    case 'APPROVED':
      return 'Approved'
    case 'DECLINED':
      return 'Declined'
    case 'REVOKED':
      return 'Revoked'
    default:
      return 'State could not be read'
  }
}

export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return 'Not available'
  return '$' + (cents / 100).toFixed(2)
}

/** "From $18.00 to $20.00, $2.00 more." Never a bare number the reader has to compare. */
export function describePriceChange(standardCents: number, requestedCents: number): string {
  const difference = requestedCents - standardCents
  const word = difference === 0 ? 'the same' : difference > 0 ? 'more' : 'less'
  const amount = money(Math.abs(difference))
  return `From ${money(standardCents)} to ${money(requestedCents)}, ${amount} ${word}.`
}

export interface PriceRequestRow {
  id: string
  status: string
  requestedAt: string
  templateName: string
  locationName: string
  standardPriceCents: number
  requestedPriceCents: number
  reason: string | null
  requestedByName: string | null
  approvedByName: string | null
  decidedAt: string | null
}

export interface RequestSummary {
  pending: number
  approved: number
  declined: number
  revoked: number
  oldestPendingDays: number | null
  headline: string
}

export function summariseRequests(rows: PriceRequestRow[], now: Date): RequestSummary {
  const counts = { pending: 0, approved: 0, declined: 0, revoked: 0 }
  let oldest: number | null = null
  for (const row of rows) {
    if (row.status === 'PENDING') counts.pending += 1
    else if (row.status === 'APPROVED') counts.approved += 1
    else if (row.status === 'DECLINED') counts.declined += 1
    else if (row.status === 'REVOKED') counts.revoked += 1

    if (row.status === 'PENDING') {
      const asked = Date.parse(row.requestedAt)
      if (!Number.isNaN(asked)) {
        const days = Math.floor((now.getTime() - asked) / 86400000)
        if (days >= 0 && (oldest === null || days > oldest)) oldest = days
      }
    }
  }
  const headline =
    rows.length === 0
      ? 'No location has asked for a different price.'
      : counts.pending === 0
        ? 'Nothing is waiting for a decision.'
        : counts.pending === 1
          ? 'One request is waiting for a decision.'
          : `${counts.pending} requests are waiting for a decision.`
  return { ...counts, oldestPendingDays: oldest, headline }
}

export interface TemplateChangeImpact {
  templateId: string
  templateName: string
  locationsAtStandardPrice: number
  locationsWithApprovedException: number
  /** True when changing the standard price would alter what some location charges. */
  changesWhatSomeoneCharges: boolean
  note: string
}

/**
 * What a template price change would touch. This is shown before publishing, and it never
 * overwrites an approved exception: a location that fought for its price keeps it.
 */
export function describeTemplateChange(
  templateId: string,
  templateName: string,
  standardPriceCents: number,
  newStandardPriceCents: number,
  locationCount: number,
  approvedExceptionCount: number,
): TemplateChangeImpact {
  const atStandard = Math.max(0, locationCount - approvedExceptionCount)
  return {
    templateId,
    templateName,
    locationsAtStandardPrice: atStandard,
    locationsWithApprovedException: approvedExceptionCount,
    changesWhatSomeoneCharges: newStandardPriceCents !== standardPriceCents && atStandard > 0,
    note:
      approvedExceptionCount > 0
        ? `${approvedExceptionCount} location(s) have an approved price of their own and keep it. ${atStandard} location(s) follow the standard price.`
        : `All ${atStandard} location(s) follow the standard price.`,
  }
}

/**
 * The customer privacy boundary (Priority 3, critical requirement).
 *
 * Corporate reporting reads aggregates. Opening a customer profile is a different
 * permission, held only at the location that actually serves that customer. This module
 * makes the boundary explicit in three places: a guard for reads, a check that a report
 * carries no identity, and the consent rules for sharing a customer's history across
 * locations.
 *
 * Pure: no database access, so the rules can be tested without a shop.
 */

import { can, CUSTOMER_RECORD_CAPABILITY, isCorporateRole, type OrgRole } from './capabilities'

export interface CustomerReadRequest {
  role: OrgRole
  /** The location the record belongs to. */
  recordBusinessId: string
  /** The location the person is acting for, resolved from their session. */
  actingBusinessId: string | null
  /** True only when the person is the customer themselves. */
  isSelf?: boolean
}

export interface CustomerReadDecision {
  allowed: boolean
  reason: string
}

/**
 * A customer record may be opened only by a location-level role acting for the location
 * that owns it, or by the customer themselves. A corporate role is refused even when it
 * holds every reporting capability.
 */
export function canReadCustomerRecord(request: CustomerReadRequest): CustomerReadDecision {
  if (request.isSelf) return { allowed: true, reason: 'This is your own record.' }
  if (isCorporateRole(request.role)) {
    return {
      allowed: false,
      reason: 'Corporate roles see totals, not individual customer records. This needs a separate grant from the location.',
    }
  }
  if (!can(request.role, CUSTOMER_RECORD_CAPABILITY)) {
    return { allowed: false, reason: 'This role cannot open customer records.' }
  }
  if (!request.actingBusinessId || request.actingBusinessId !== request.recordBusinessId) {
    return { allowed: false, reason: 'This customer belongs to another location.' }
  }
  return { allowed: true, reason: 'This customer belongs to the location you are acting for.' }
}

/** Field names that would identify a person. A corporate report must contain none of them. */
export const IDENTITY_FIELDS = ['customerId', 'customerName', 'email', 'phone', 'firstName', 'lastName', 'address', 'dateOfBirth']

export interface AggregateGuardResult {
  safe: boolean
  offending: string[]
}

/**
 * Check a report payload for identity fields. Used by the reporting route before it
 * serialises anything, so a future change cannot quietly add a name to a corporate total.
 */
export function aggregateOnlyGuard(payload: unknown, path = ''): AggregateGuardResult {
  const offending: string[] = []
  const visit = (value: unknown, current: string) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${current}[${index}]`))
      return
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const next = current ? `${current}.${key}` : key
        if (IDENTITY_FIELDS.includes(key)) offending.push(next)
        visit(child, next)
      }
    }
  }
  visit(payload, path)
  return { safe: offending.length === 0, offending }
}

export interface CustomerLocationLinkRecord {
  customerId: string
  businessId: string
  organizationId: string
  consentText: string
  consentedAt: string
  revokedAt?: string | null
}

/**
 * A second location may see a customer's history at another location only with an
 * explicit, unrevoked consent record that names both locations. No record, no history.
 */
export function canShareHistoryAcrossLocations(
  link: CustomerLocationLinkRecord | null,
  request: { customerId: string; fromBusinessId: string; toBusinessId: string; organizationId: string },
): { allowed: boolean; reason: string } {
  if (!link) {
    return { allowed: false, reason: 'The customer has not agreed to share their history with another location.' }
  }
  if (link.customerId !== request.customerId) {
    return { allowed: false, reason: 'The consent record belongs to a different customer.' }
  }
  if (link.organizationId !== request.organizationId) {
    return { allowed: false, reason: 'The consent record belongs to a different organization.' }
  }
  if (link.businessId !== request.fromBusinessId && link.businessId !== request.toBusinessId) {
    return { allowed: false, reason: 'The consent record does not name either location involved.' }
  }
  if (link.revokedAt) {
    return { allowed: false, reason: 'The customer has withdrawn this consent.' }
  }
  if (!link.consentedAt || !link.consentText.trim()) {
    return { allowed: false, reason: 'The consent record is incomplete, so it cannot be relied on.' }
  }
  return { allowed: true, reason: 'The customer agreed to share this history, and the agreement is still current.' }
}

/** What the customer is agreeing to, in words they can actually read. */
export const CUSTOMER_LINK_CONSENT_TEXT =
  'I agree that these two barbershops may share my visit history with each other, so I do not have to repeat my details. I can withdraw this at any time and the sharing stops.'

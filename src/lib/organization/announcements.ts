/**
 * Corporate announcements (Priority 3, part E).
 *
 * An announcement may go to every location, one region, one location, or one named group
 * of employees. The audience is resolved from the organization's own location list, so an
 * announcement cannot be addressed to a location that is not part of it.
 */

import { can, type OrgRole } from './capabilities'

export type AudienceType = 'all' | 'region' | 'location' | 'group'

export interface Audience {
  type: AudienceType
  values: string[]
}

export interface LocationRef {
  businessId: string
  region: string | null
  status: string
}

export interface AudienceResolution {
  businessIds: string[]
  explanation: string
  empty: boolean
}

export function resolveAudience(audience: Audience, locations: LocationRef[]): AudienceResolution {
  const open = locations.filter((l) => l.status !== 'closed')
  if (audience.type === 'all') {
    return {
      businessIds: open.map((l) => l.businessId),
      explanation: `Every open location (${open.length}).`,
      empty: open.length === 0,
    }
  }
  if (audience.type === 'region') {
    const wanted = new Set(audience.values.map((v) => v.trim().toLowerCase()))
    const matched = open.filter((l) => l.region !== null && wanted.has(l.region.toLowerCase()))
    return {
      businessIds: matched.map((l) => l.businessId),
      explanation: `Locations in ${audience.values.join(', ') || 'no region'} (${matched.length}).`,
      empty: matched.length === 0,
    }
  }
  if (audience.type === 'location') {
    const wanted = new Set(audience.values)
    const matched = open.filter((l) => wanted.has(l.businessId))
    return {
      businessIds: matched.map((l) => l.businessId),
      explanation: `${matched.length} chosen location${matched.length === 1 ? '' : 's'}.`,
      empty: matched.length === 0,
    }
  }
  // A named group is a list of location ids the caller has already resolved from
  // assignments. Unknown ids are dropped, never invented.
  const wanted = new Set(audience.values)
  const matched = open.filter((l) => wanted.has(l.businessId))
  return {
    businessIds: matched.map((l) => l.businessId),
    explanation: `Locations with people in the chosen group (${matched.length}).`,
    empty: matched.length === 0,
  }
}

export interface AnnouncementDraft {
  title: string
  body: string
  audience: Audience
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export function validateAnnouncement(draft: Partial<AnnouncementDraft>): ValidationResult {
  const errors: string[] = []
  if (!draft.title?.trim()) errors.push('An announcement needs a title.')
  if (!draft.body?.trim()) errors.push('An announcement needs a message.')
  if (!draft.audience) errors.push('Choose who should see this.')
  else if (draft.audience.type !== 'all' && draft.audience.values.length === 0) errors.push('Choose at least one region, location or group.')
  return { valid: errors.length === 0, errors }
}

export function maySendAnnouncement(role: OrgRole): { allowed: boolean; reason: string } {
  if (!can(role, 'announcements.send')) {
    return { allowed: false, reason: 'Your role cannot send announcements.' }
  }
  return { allowed: true, reason: 'Your role can send announcements to the locations you are responsible for.' }
}

/** Restrict an already-resolved audience to the locations the sender may address. */
export function limitToSenderScope(resolved: string[], allowedBusinessIds: string[]): { businessIds: string[]; dropped: number } {
  const allowed = new Set(allowedBusinessIds)
  const businessIds = resolved.filter((id) => allowed.has(id))
  return { businessIds, dropped: resolved.length - businessIds.length }
}

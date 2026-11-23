/**
 * The words on the franchise overview (Priority 3, read-only).
 *
 * Every label here comes from an existing rule, not a second copy of it: the location
 * lifecycle decides what a status means, the branding resolver decides whether a location
 * has an approved change, and the price resolver decides whether a price is standard or an
 * exception. This module only turns those answers into sentences a franchise operator
 * reads without a glossary.
 *
 * Nothing here guesses. A status that is not recognised says so; a setting that was never
 * made says it was never made, which is different from saying it is fine.
 */

import { resolveBrand, type BrandSettingsRecord, type BrandValues } from './branding'
import { resolveServicePrice, formatCents, type ServiceTemplate, type PriceException } from './service-templates'

export type Tone = 'open' | 'preparing' | 'closing' | 'closed' | 'standard' | 'exception' | 'unset' | 'unknown'

export interface StatusLine {
  label: string
  detail: string
  tone: Tone
}

/** The lifecycle words, in the operator's language. */
export function describeLocationStatus(status: string | null | undefined): StatusLine {
  switch (status) {
    case 'onboarding':
      return { label: 'Location is being prepared', detail: 'It is not taking bookings as a normal shop yet.', tone: 'preparing' }
    case 'active':
      return { label: 'Location is open', detail: 'It is trading normally.', tone: 'open' }
    case 'closing':
      return { label: 'Location is closing', detail: 'It is winding down and will stop taking new bookings.', tone: 'closing' }
    case 'closed':
      return { label: 'Location is closed', detail: 'It is not trading. Its records are kept.', tone: 'closed' }
    default:
      return {
        label: 'Status could not be read',
        detail: 'This is not a statement that the location is open. Its status needs a technical look.',
        tone: 'unknown',
      }
  }
}

export function describeRegion(region: string | null | undefined): string {
  return region && region.trim().length > 0 ? region : 'No region set'
}

/**
 * Whether this location uses the shared brand or has an approved change of its own.
 * The branding resolver decides; this only reports what it decided.
 */
export function describeBranding(
  settings: BrandSettingsRecord | null,
  overrides: Partial<BrandValues> | null,
): StatusLine {
  if (!settings) {
    return {
      label: 'No company branding set up yet',
      detail: 'This organization has not set shared colours or a logo, so each shop shows its own.',
      tone: 'unset',
    }
  }
  const resolved = resolveBrand(settings, overrides)
  const changed = resolved.filter((field) => field.source === 'location').map((field) => field.field)
  if (changed.length > 0) {
    return {
      label: 'Approved location-specific change',
      detail: `This location may use its own ${changed.join(', ')}. Everything else comes from the company brand.`,
      tone: 'exception',
    }
  }
  return {
    label: 'Standard company branding',
    detail: 'This location uses the shared logo and colours.',
    tone: 'standard',
  }
}

/** Standard prices, or an approved exception, decided by the existing price resolver. */
export function describePricing(
  templates: ServiceTemplate[],
  exceptions: PriceException[],
  businessId: string,
): StatusLine {
  if (templates.length === 0) {
    return {
      label: 'No standard prices set up yet',
      detail: 'This organization has no shared service prices, so each shop sets its own.',
      tone: 'unset',
    }
  }
  const approved = exceptions.filter((exception) => exception.businessId === businessId)
  if (approved.length > 0) {
    const example = approved[0]
    const template = templates.find((entry) => entry.id === example.templateId)
    const explanation = template
      ? resolveServicePrice(template, example, businessId).explanation
      : 'This location has an approved price that differs from the standard.'
    return {
      label: 'Approved price exception',
      detail: `${approved.length} service${approved.length === 1 ? '' : 's'} priced differently. ${explanation}`,
      tone: 'exception',
    }
  }
  const cheapest = templates.reduce((lowest, entry) => (entry.defaultPriceCents < lowest.defaultPriceCents ? entry : lowest), templates[0])
  return {
    label: 'Standard service prices',
    detail: `${templates.length} shared service${templates.length === 1 ? '' : 's'}, from ${formatCents(cheapest.defaultPriceCents)}.`,
    tone: 'standard',
  }
}

export interface AssignmentLike {
  userId: string
  businessId: string
  role: string
  effectiveFrom: Date | string
  effectiveTo: Date | string | null
}

export interface StaffSummary {
  total: number
  byRole: Array<{ role: string; people: number }>
  label: string
}

const ROLE_WORDS: Record<string, string> = {
  LOCATION_MANAGER: 'location managers',
  ADMIN: 'administrators',
  BARBER: 'barbers',
}

/** Who is assigned to a location right now, counted, never named. */
export function summariseStaff(assignments: AssignmentLike[], businessId: string, at: Date): StaffSummary {
  const current = assignments.filter((assignment) => {
    if (assignment.businessId !== businessId) return false
    const from = new Date(assignment.effectiveFrom).getTime()
    const to = assignment.effectiveTo ? new Date(assignment.effectiveTo).getTime() : null
    return from <= at.getTime() && (to === null || to > at.getTime())
  })
  const people = new Set(current.map((assignment) => assignment.userId))
  const counts = new Map<string, Set<string>>()
  for (const assignment of current) {
    const set = counts.get(assignment.role) ?? new Set<string>()
    set.add(assignment.userId)
    counts.set(assignment.role, set)
  }
  const byRole = [...counts.entries()].map(([role, set]) => ({ role, people: set.size }))
  const label = people.size === 0
    ? 'Nobody is assigned here yet.'
    : `${people.size} ${people.size === 1 ? 'person is' : 'people are'} assigned: ${byRole
        .map((entry) => `${entry.people} ${ROLE_WORDS[entry.role] ?? entry.role.toLowerCase()}`)
        .join(', ')}.`
  return { total: people.size, byRole, label }
}

export interface AnnouncementLike {
  title: string
  audienceType: string
  audienceValues: string[]
  publishedAt: Date | string | null
  createdAt: Date | string
}

/** Sent or still a draft. There is no third state, and a missing date is not "sent". */
export function describeAnnouncement(row: AnnouncementLike): StatusLine {
  const audience = row.audienceType === 'all'
    ? 'everyone in the organization'
    : row.audienceType === 'region'
      ? `the ${row.audienceValues.join(', ')} region${row.audienceValues.length === 1 ? '' : 's'}`
      : row.audienceType === 'location'
        ? 'one location'
        : `a group (${row.audienceValues.join(', ')})`
  if (!row.publishedAt) {
    return { label: 'Draft, not sent', detail: `Written for ${audience} but never sent.`, tone: 'unset' }
  }
  const when = new Date(row.publishedAt)
  const date = Number.isNaN(when.getTime()) ? 'an unreadable date' : when.toISOString().slice(0, 10)
  return { label: `Sent on ${date}`, detail: `Went to ${audience}.`, tone: 'standard' }
}

/** The one-line answer at the top of the page. */
export function summariseStructure(input: {
  organizationName: string
  locations: Array<{ status: string }>
  regions: string[]
}): string {
  const count = input.locations.length
  if (count === 0) {
    return `${input.organizationName} has no locations you can see yet.`
  }
  const open = input.locations.filter((location) => location.status === 'active').length
  const preparing = input.locations.filter((location) => location.status === 'onboarding').length
  const parts = [`${count} location${count === 1 ? '' : 's'}`]
  parts.push(`${open} open`)
  if (preparing > 0) parts.push(`${preparing} being prepared`)
  const regions = input.regions.length > 0 ? ` Across ${input.regions.join(', ')}.` : ''
  return `${input.organizationName}: ${parts.join(', ')}.${regions}`
}

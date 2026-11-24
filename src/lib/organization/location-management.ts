/**
 * Location management rules (Priority 1 of the organization management phase).
 *
 * The structure page is read-only and the lifecycle state machine already exists in
 * locations.ts. What was missing was the layer between a form and that state machine:
 * the rules that decide whether a draft is worth saving, whether a location may open,
 * and what an owner must be told before a shop closes.
 *
 * Pure on purpose. Nothing here reads a database, so every refusal can be pinned by a test.
 * The caller supplies the facts it has already loaded inside the session's scope.
 */

import { canTransition, OPENING_STEPS, CLOSING_STEPS, type LocationStatus } from './locations'

export interface LocationDraft {
  name?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
  timezone?: string | null
  region?: string | null
}

export interface LocationFacts {
  businessId: string
  name: string
  region: string | null
  status: string
}

export interface LocationReadiness {
  /** The shared brand applies, or an approved exception is recorded. */
  brandSet: boolean
  /** At least one service is priced for this location. */
  servicesSet: boolean
  /** A location manager assignment is in force. */
  managerAssigned: boolean
}

export interface Verdict {
  allowed: boolean
  reasons: string[]
}

const MAX_NAME = 80
const MAX_REGION = 60

/** A timezone is only accepted if the runtime can actually format in it. */
export function isValidTimezone(timezone: string | null | undefined): boolean {
  if (!timezone || timezone.trim().length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone.trim() })
    return true
  } catch {
    return false
  }
}

export function validateLocationDraft(draft: LocationDraft): Verdict {
  const reasons: string[] = []
  const name = (draft.name ?? '').trim()
  if (name.length < 2) reasons.push('Enter the shop name, at least two characters.')
  if (name.length > MAX_NAME) reasons.push(`The shop name is limited to ${MAX_NAME} characters.`)

  if (!isValidTimezone(draft.timezone)) {
    reasons.push('Choose a timezone. It decides what time an appointment shows to customers.')
  }

  const email = (draft.email ?? '').trim()
  if (email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    reasons.push('The contact email does not look like an email address.')
  }

  const phone = (draft.phone ?? '').trim()
  if (phone.length > 0 && phone.replace(/[^0-9]/g, '').length < 7) {
    reasons.push('The contact phone number needs at least seven digits.')
  }

  const region = (draft.region ?? '').trim()
  if (region.length > MAX_REGION) reasons.push(`A region name is limited to ${MAX_REGION} characters.`)

  return { allowed: reasons.length === 0, reasons }
}

/** A URL-safe shop address, made unique against the shops that already exist. */
export function slugFromName(name: string, taken: string[] = []): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')

  const seed = base.length > 0 ? base : 'shop'
  const used = new Set(taken.map((slug) => slug.toLowerCase()))
  if (!used.has(seed)) return seed
  for (let suffix = 2; suffix < 500; suffix += 1) {
    const candidate = `${seed}-${suffix}`
    if (!used.has(candidate)) return candidate
  }
  return `${seed}-${Date.now()}`
}

/** Two shops in one organization may not share a name. Returns the one that clashes. */
export function findDuplicateLocation(name: string, existing: LocationFacts[]): LocationFacts | null {
  const wanted = name.trim().toLowerCase()
  if (wanted.length === 0) return null
  return existing.find((row) => row.name.trim().toLowerCase() === wanted) ?? null
}

/**
 * Moving a location into a region is how a region comes to exist, so the move is the
 * permission check. A regional manager may only move a shop within the regions they hold;
 * an empty list means the person is not restricted to particular regions.
 */
export function regionChangeVerdict(actorRegions: string[], nextRegion: string | null): Verdict {
  const target = (nextRegion ?? '').trim()
  if (target.length === 0) return { allowed: true, reasons: [] }
  if (target.length > MAX_REGION) return { allowed: false, reasons: [`A region name is limited to ${MAX_REGION} characters.`] }
  if (actorRegions.length === 0) return { allowed: true, reasons: [] }
  const known = actorRegions.map((r) => r.trim().toLowerCase())
  if (!known.includes(target.toLowerCase())) {
    return {
      allowed: false,
      reasons: [`You look after ${actorRegions.join(', ')}, so you cannot move a shop into ${target}.`],
    }
  }
  return { allowed: true, reasons: [] }
}

export function regionNames(locations: LocationFacts[]): string[] {
  const seen = new Set<string>()
  for (const row of locations) {
    const region = (row.region ?? '').trim()
    if (region.length > 0) seen.add(region)
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b))
}

export interface RegionRenamePlan {
  allowed: boolean
  reasons: string[]
  affectedBusinessIds: string[]
}

export function planRegionRename(
  locations: LocationFacts[],
  from: string,
  to: string,
  actorRegions: string[] = [],
): RegionRenamePlan {
  const source = from.trim()
  const target = to.trim()
  const reasons: string[] = []
  if (source.length === 0) reasons.push('Choose the region you want to rename.')
  if (target.length === 0) reasons.push('Enter the new region name.')
  if (target.length > MAX_REGION) reasons.push(`A region name is limited to ${MAX_REGION} characters.`)
  if (source.toLowerCase() === target.toLowerCase()) reasons.push('That is already the name of this region.')

  const inRegion = locations.filter((row) => (row.region ?? '').trim().toLowerCase() === source.toLowerCase())
  if (source.length > 0 && inRegion.length === 0) reasons.push('No location is in that region.')

  const scope = regionChangeVerdict(actorRegions, target)
  reasons.push(...scope.reasons)
  if (scope.allowed === false && actorRegions.length > 0) {
    const outside = inRegion.filter((row) => {
      const known = actorRegions.map((r) => r.trim().toLowerCase())
      return row.region === null || !known.includes((row.region ?? '').trim().toLowerCase())
    })
    if (outside.length > 0) reasons.push('Some of those locations are outside the regions you look after.')
  }

  return { allowed: reasons.length === 0, reasons, affectedBusinessIds: inRegion.map((row) => row.businessId) }
}

/**
 * What still stands between an onboarding location and taking bookings.
 *
 * The checklist in locations.ts says what opening involves; this decides whether it has
 * actually happened. A prerequisite that is merely displayed and not enforced is how a
 * half-finished shop starts taking appointments.
 */
export function activationVerdict(location: LocationFacts, readiness: LocationReadiness): Verdict {
  const transition = canTransition(location.status as LocationStatus, 'active')
  if (!transition.allowed) return { allowed: false, reasons: [transition.reason] }

  const reasons: string[] = []
  if (!readiness.brandSet) reasons.push('Set the brand before opening. Customers would otherwise see an unbranded page.')
  if (!readiness.servicesSet) reasons.push('Choose the services and prices before opening. A shop with no services cannot be booked.')
  if (!readiness.managerAssigned) reasons.push('Appoint a location manager before opening, so somebody is responsible for the shop.')
  return { allowed: reasons.length === 0, reasons }
}

export interface ClosureFacts {
  location: LocationFacts
  upcomingAppointments: number | null
  pastAppointments: number | null
  activeEmployees: number | null
  staffAssignments: number | null
  outstandingCommissions: number | null
  unsettledPayments: number | null
  customers: number | null
  /** True once payroll and commission records for this location are settled. */
  settled: boolean
  /** True once a copy of the records has been produced. */
  exported: boolean
}

export interface ClosureLine {
  label: string
  value: number | null
  note: string
}

export interface ClosureReview {
  allowed: boolean
  reasons: string[]
  headline: string
  lines: ClosureLine[]
  keeps: string[]
}

const UNREAD = 'Could not be checked.'

/**
 * The closing conversation. It shows what is at stake, states plainly that nothing is
 * deleted, and refuses to finish while the checklist prerequisites are unmet.
 */
export function buildClosureReview(facts: ClosureFacts): ClosureReview {
  const lines: ClosureLine[] = [
    { label: 'Upcoming appointments', value: facts.upcomingAppointments, note: 'They are not cancelled. Move or keep them as they are.' },
    { label: 'Appointments already completed', value: facts.pastAppointments, note: 'Kept and still readable.' },
    { label: 'People working here', value: facts.activeEmployees, note: 'Nobody is dismissed by closing a location.' },
    { label: 'Location assignments', value: facts.staffAssignments, note: 'They stop granting access; the history stays.' },
    { label: 'Commissions not yet settled', value: facts.outstandingCommissions, note: 'Settle these before closing.' },
    { label: 'Payments not yet settled', value: facts.unsettledPayments, note: 'Settle these before closing.' },
    { label: 'Customer records', value: facts.customers, note: 'Kept. Nothing is deleted, and no customer is told anything by this action.' },
  ].map((line) => (line.value === null ? { ...line, note: UNREAD } : line))

  const reasons: string[] = []
  const transition = canTransition(facts.location.status as LocationStatus, 'closed')
  if (!transition.allowed) reasons.push(transition.reason)
  if (!facts.settled) reasons.push('Payments and commissions for this location are not settled yet.')
  if (!facts.exported) reasons.push('Export a copy of the records before closing.')

  return {
    allowed: reasons.length === 0,
    reasons,
    headline: `Closing ${facts.location.name} stops new bookings and takes it out of organization totals. Its records stay where they are.`,
    lines,
    keeps: [
      'Appointments, payments, commissions and customer history are kept, not deleted.',
      'The location keeps its identity. It is not replaced by a copy.',
      'Nothing is sent to customers by closing a location.',
    ],
  }
}

/** A closed location cannot come back as itself. The state machine says so, and so do we. */
export function reopenGuidance(status: string): { allowed: boolean; message: string } {
  if (status !== 'closed') {
    return { allowed: false, message: 'This location is not closed, so there is nothing to reopen.' }
  }
  return {
    allowed: false,
    message:
      'A closed location cannot be reopened. Its records stay readable, and a new location can be created for the same shop address. If reopening the original is needed, the proposal in docs/ORGANIZATION-MANAGEMENT.md describes a closed to reopening to onboarding path that keeps the same identity. That change needs an owner decision before it is built.',
  }
}

export interface StatusCounts {
  total: number
  active: number
  onboarding: number
  closing: number
  closed: number
}

export function statusCounts(locations: LocationFacts[]): StatusCounts {
  const counts: StatusCounts = { total: locations.length, active: 0, onboarding: 0, closing: 0, closed: 0 }
  for (const row of locations) {
    if (row.status === 'active') counts.active += 1
    else if (row.status === 'onboarding') counts.onboarding += 1
    else if (row.status === 'closing') counts.closing += 1
    else if (row.status === 'closed') counts.closed += 1
  }
  return counts
}

/** The steps an owner is walked through when a location opens, in order. */
export function openingSteps(): typeof OPENING_STEPS {
  return OPENING_STEPS
}

export function closingSteps(): typeof CLOSING_STEPS {
  return CLOSING_STEPS
}

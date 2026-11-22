/**
 * Turning an organization report into what an owner reads.
 *
 * Pure presentation: no database, no session, no clock. The one rule that matters is that
 * a figure nobody could read is never rendered as a number. "Could not verify" is a
 * different statement from "zero", and a smaller total presented as the organization
 * total would be a lie the owner could act on.
 *
 * The report itself carries no customer identity (reporting.ts builds aggregates only,
 * and the route runs aggregateOnlyGuard over it). Nothing here adds a field that could
 * reintroduce one.
 */

import type { LocationRollup, OrganizationReport } from './reporting'

export interface RangeOption {
  days: number
  label: string
  href: string
}

/** The reporting range the endpoint supports: 1 to 365 days. These are the useful stops. */
export const RANGE_OPTIONS: RangeOption[] = [
  { days: 7, label: 'Last 7 days', href: '/dashboard/organization?days=7' },
  { days: 30, label: 'Last 30 days', href: '/dashboard/organization?days=30' },
  { days: 90, label: 'Last 90 days', href: '/dashboard/organization?days=90' },
  { days: 365, label: 'Last 12 months', href: '/dashboard/organization?days=365' },
]

export const UNVERIFIED = 'Could not verify'

export interface Metric {
  key: string
  label: string
  /** Already formatted for display. Never an invented number. */
  value: string
  /** True when the underlying figure was null, so the UI can style it as unknown. */
  unverified: boolean
}

function isMoneyKey(key: string): boolean {
  return key.endsWith('Cents')
}

export function formatMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return UNVERIFIED
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(Math.round(cents))
  const dollars = Math.floor(absolute / 100).toLocaleString('en-US')
  const remainder = String(absolute % 100).padStart(2, '0')
  return `${sign}$${dollars}.${remainder}`
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNVERIFIED
  return Math.round(value).toLocaleString('en-US')
}

function metric(key: string, label: string, value: number | null | undefined): Metric {
  const missing = value === null || value === undefined || !Number.isFinite(value)
  return {
    key,
    label,
    value: missing ? UNVERIFIED : isMoneyKey(key) ? formatMoney(value) : formatCount(value),
    unverified: missing,
  }
}

/**
 * The consolidated figures, in the order an owner asks for them. Everything a location
 * could not supply makes the total null upstream, so this list inherits that honesty
 * without having to re-check it.
 */
export function summaryMetrics(report: OrganizationReport): Metric[] {
  const totals = report.totals
  const label = (key: string) => report.labels[key] ?? key
  return [
    metric('appointments', label('appointments'), totals.appointments ?? null),
    metric('completed', label('completed'), totals.completed ?? null),
    metric('grossRevenueCents', label('grossRevenueCents'), totals.grossRevenueCents ?? null),
    metric('refundsCents', label('refundsCents'), totals.refundsCents ?? null),
    metric('netRevenueCents', label('netRevenueCents'), totals.netRevenueCents ?? null),
    metric('staffCount', label('staffCount'), totals.staffCount ?? null),
  ]
}

export interface LocationView {
  businessId: string
  name: string
  region: string | null
  statusLabel: string
  /** True when at least one figure at this location could not be read. */
  hasUnverifiedFigures: boolean
  metrics: Metric[]
}

/** Status in words a person uses, never a raw database value presented as healthy. */
export function describeLocationStatus(status: string | null | undefined): string {
  const value = (status ?? '').trim().toUpperCase()
  if (value === 'ACTIVE') return 'Open for bookings'
  if (value === 'INACTIVE' || value === 'PAUSED' || value === 'SUSPENDED') return 'Not taking bookings'
  if (!value) return 'Status could not be read'
  return 'Status not recognised'
}

export function locationView(location: LocationRollup): LocationView {
  const metrics = [
    metric('appointments', 'Appointments booked', location.appointments),
    metric('completed', 'Appointments completed', location.completed),
    metric('grossRevenueCents', 'Money taken before refunds', location.grossRevenueCents),
    metric('refundsCents', 'Money refunded', location.refundsCents),
    metric('netRevenueCents', 'Money taken after refunds', location.netRevenueCents),
    metric('staffCount', 'People working here', location.staffCount),
  ]
  return {
    businessId: location.businessId,
    name: location.name,
    region: location.region,
    statusLabel: describeLocationStatus(location.status),
    hasUnverifiedFigures: metrics.some((m) => m.unverified),
    metrics,
  }
}

export function locationViews(report: OrganizationReport): LocationView[] {
  return report.locations.map(locationView)
}

/**
 * What the page says about the figures it could not read. Null when everything was read,
 * so the page does not carry a reassuring empty box.
 */
export function unverifiedNotice(report: OrganizationReport): string | null {
  const named = report.unverifiedLocations.filter(Boolean)
  const unreadableTotals = summaryMetrics(report).filter((m) => m.unverified)
  if (named.length === 0 && unreadableTotals.length === 0) return null

  if (named.length === 0) {
    return `Some figures for ${report.rangeLabel} could not be read. They are marked "${UNVERIFIED}" and are not included in any total.`
  }
  const list = named.join(', ')
  const totalsPart = unreadableTotals.length > 0
    ? ' The organization totals below are marked "Could not verify" for the same reason: a total that leaves a shop out is not the organization total.'
    : ''
  return `${named.length === 1 ? 'One location' : `${named.length} locations`} could not be read in full (${list}).${totalsPart}`
}

/** Plain words for a person who belongs to no organization. Not an error state. */
export function noOrganizationCopy(reason: string | null | undefined): string {
  switch (reason) {
    case 'suspended':
      return 'Your organization access is paused. Your own shop dashboard still works, and nothing about your shop has changed.'
    case 'unrecognised-role':
      return 'We could not work out which organization role you hold, so this page will not guess. Ask whoever set up your access to check it.'
    case 'read-failed':
      return 'We could not read your organization just now. This is not a statement that you have no organization; try again in a minute.'
    default:
      return 'This page is for owners who manage more than one shop. You are not part of an organization, so your own shop dashboard is the right place to work.'
  }
}

/** The one sentence at the top of the page. */
export function describeOrganizationHeadline(report: OrganizationReport, locationCount: number): string {
  const shops = locationCount === 1 ? '1 location' : `${locationCount} locations`
  const unknown = report.unverifiedLocations.length > 0 ? ' Some figures could not be read and are marked as such.' : ''
  return `Across ${shops} for ${report.rangeLabel}.${unknown}`
}

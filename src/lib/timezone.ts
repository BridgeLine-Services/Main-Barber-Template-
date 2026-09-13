// ============================================================================
// Timezone Utilities
// Centralized timezone handling for all business logic
// Every time computation goes through these functions to ensure consistency
//
// CRITICAL: A "calendar day" (e.g. "August 18, 2026") must be constructed
// from year/month/day components in the BUSINESS TIMEZONE, not from a
// JS Date instant which depends on the server's local timezone.
// On Vercel (UTC), new Date(2026, 7, 18, 0, 0, 0) is midnight UTC, which
// is 5pm PDT Aug 17 — off by one day for Pacific businesses.
// ============================================================================

import { DateTime } from 'luxon'

/**
 * Fallback IANA timezone used when no Business record is resolvable (e.g.
 * database not yet onboarded). Mirrors the Prisma `Business.timezone`
 * schema default so the schema remains the single source of truth; each
 * deployment overrides it through onboarding/admin configuration. This is
 * a generic application default (Constitution §6), never client
 * configuration — no route may hard-code its own timezone fallback.
 */
export const DEFAULT_BUSINESS_TIMEZONE = 'America/Los_Angeles'

/**
 * Resolve a business's IANA timezone with the schema-aligned application
 * default. Every consumer must use this instead of a local literal.
 */
export function resolveBusinessTimezone(
  business?: { timezone?: string | null } | null
): string {
  return business?.timezone || DEFAULT_BUSINESS_TIMEZONE
}

/**
 * Convert a UTC Date to a local DateTime in the business timezone
 */
export function toLocalDate(utcDate: Date | string, timezone: string): DateTime {
  const dt = typeof utcDate === 'string' ? DateTime.fromISO(utcDate) : DateTime.fromJSDate(utcDate)
  return dt.setZone(timezone)
}

/**
 * Format a UTC date for display in the business timezone
 */
export function formatInTimezone(
  utcDate: Date | string,
  timezone: string,
  formatStr: string = 'MMM d, yyyy h:mm a'
): string {
  return toLocalDate(utcDate, timezone).toFormat(formatStr)
}

/**
 * Format just the time portion in the business timezone
 */
export function formatTimeInTimezone(utcDate: Date | string, timezone: string): string {
  return toLocalDate(utcDate, timezone).toFormat('h:mm a')
}

/**
 * Format just the date portion in the business timezone
 */
export function formatDateInTimezone(utcDate: Date | string, timezone: string): string {
  return toLocalDate(utcDate, timezone).toFormat('MMM d, yyyy')
}

/**
 * Get the start of day in the business timezone from year/month/day, as a UTC Date.
 * This is the correct way to compute day boundaries — it constructs the instant
 * directly in the business timezone, avoiding server-local timezone ambiguity.
 */
export function dayBoundsFromYMD(
  timezone: string,
  year: number,
  month: number, // 1-indexed (1 = January)
  day: number
): { start: Date; end: Date } {
  const startLocal = DateTime.fromObject(
    { year, month, day, hour: 0, minute: 0, second: 0 },
    { zone: timezone }
  )
  const endLocal = startLocal.endOf('day')
  return {
    start: startLocal.toUTC().toJSDate(),
    end: endLocal.toUTC().toJSDate(),
  }
}

/**
 * Convert a local time string (HH:mm) on a specific calendar day to UTC.
 * Uses year/month/day to construct the instant in the business timezone.
 */
export function localTimeToUTCFromYMD(
  localTimeStr: string, // "HH:mm"
  year: number,
  month: number, // 1-indexed
  day: number,
  timezone: string
): Date {
  const [hours, minutes] = localTimeStr.split(':').map(Number)
  return DateTime.fromObject(
    { year, month, day, hour: hours, minute: minutes },
    { zone: timezone }
  ).toUTC().toJSDate()
}

/**
 * Get the start of day in the business timezone, as a UTC Date
 * @deprecated Use dayBoundsFromYMD when you have year/month/day available
 */
export function startOfDayUTC(timezone: string, date?: Date): Date {
  const dt = date ? DateTime.fromJSDate(date) : DateTime.now()
  return dt.setZone(timezone).startOf('day').toUTC().toJSDate()
}

/**
 * Get the end of day in the business timezone, as a UTC Date
 * @deprecated Use dayBoundsFromYMD when you have year/month/day available
 */
export function endOfDayUTC(timezone: string, date?: Date): Date {
  const dt = date ? DateTime.fromJSDate(date) : DateTime.now()
  return dt.setZone(timezone).endOf('day').toUTC().toJSDate()
}

/**
 * Get the start and end of a week (Monday-Sunday) in the business timezone
 */
export function weekRangeUTC(timezone: string, referenceDate?: Date): { start: Date; end: Date } {
  const dt = referenceDate ? DateTime.fromJSDate(referenceDate) : DateTime.now()
  const local = dt.setZone(timezone)
  const start = local.startOf('week').toUTC().toJSDate()
  const end = local.endOf('week').toUTC().toJSDate()
  return { start, end }
}

/**
 * Get the start and end of a month in the business timezone
 */
export function monthRangeUTC(timezone: string, year: number, month: number): { start: Date; end: Date } {
  const local = DateTime.fromObject({ year, month, day: 1 }, { zone: timezone })
  const start = local.toUTC().toJSDate()
  const end = local.endOf('month').endOf('day').toUTC().toJSDate()
  return { start, end }
}

/**
 * Check if a UTC date falls on the same calendar day in the business timezone
 */
export function isSameBusinessDay(utcDate: Date, timezone: string, referenceDate?: Date): boolean {
  const local = toLocalDate(utcDate, timezone)
  const ref = referenceDate ? toLocalDate(referenceDate, timezone) : toLocalDate(new Date(), timezone)
  return local.hasSame(ref, 'day')
}

/**
 * Get the day of week (0=Sunday..6=Saturday) for a calendar date in the business timezone
 */
export function dayOfWeekFromYMD(timezone: string, year: number, month: number, day: number): number {
  return DateTime.fromObject({ year, month, day }, { zone: timezone }).weekday % 7
}

/**
 * Return a calendar date suitable for Prisma's @db.Date fields.
 * Date-only values are normalized to UTC midnight so the server timezone
 * cannot shift the stored calendar day.
 */
export function dateOnlyUTCFromYMD(year: number, month: number, day: number): Date {
  return DateTime.utc(year, month, day).startOf('day').toJSDate()
}

/**
 * Get a human-readable timezone offset label
 * e.g. "PST (UTC-8)" or "PDT (UTC-7)"
 */
export function getTimezoneLabel(timezone: string): string {
  const now = DateTime.now().setZone(timezone)
  const offset = now.offset
  const offsetHours = Math.floor(Math.abs(offset) / 60)
  const offsetMins = Math.abs(offset) % 60
  const sign = offset >= 0 ? '+' : '-'
  const offsetStr = offsetMins > 0
    ? `UTC${sign}${offsetHours}:${offsetMins.toString().padStart(2, '0')}`
    : `UTC${sign}${offsetHours}`
  const abbr = now.toFormat('ZZZZ')
  return `${abbr} (${offsetStr})`
}

/**
 * List of common US timezones for settings dropdown
 */
export const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
]

/**
 * Convert a local time string (HH:mm) on a specific date to UTC.
 * @deprecated Use localTimeToUTCFromYMD when you have year/month/day available
 */
export function localTimeToUTC(
  localTimeStr: string,
  date: Date,
  timezone: string
): Date {
  const [hours, minutes] = localTimeStr.split(':').map(Number)
  const local = DateTime.fromObject(
    { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: hours, minute: minutes },
    { zone: timezone }
  )
  return local.toUTC().toJSDate()
}

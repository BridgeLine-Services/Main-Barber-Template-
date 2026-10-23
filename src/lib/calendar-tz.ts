// Client-side business-timezone helpers for the dashboard calendar.
//
// The backend interprets every calendar date/time in the BUSINESS timezone
// (see src/lib/timezone.ts), so the dashboard calendar must bucket and
// format appointments in that same zone — never in the browser's zone.
// An owner travelling abroad would otherwise see appointments slide to
// different days/hours than the ones customers booked. All helpers take
// the zone explicitly so nothing depends on the viewer's clock.

import { DateTime } from 'luxon'

/** Parse a UTC ISO instant (e.g. startTime from the API) into the business zone. */
export function inZone(iso: string, timezone: string): DateTime {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(timezone)
}

/** Calendar day (YYYY-MM-DD) of a UTC ISO instant, in the business zone. */
export function ymdInZone(iso: string, timezone: string): string {
  return inZone(iso, timezone).toFormat('yyyy-MM-dd')
}

/** Wall-clock hour (0-23) of a UTC ISO instant, in the business zone. */
export function hourInZone(iso: string, timezone: string): number {
  return inZone(iso, timezone).hour
}

/** "h:mm a" time-of-day label of a UTC ISO instant, in the business zone. */
export function timeInZone(iso: string, timezone: string): string {
  return inZone(iso, timezone).toFormat('h:mm a')
}

/** Today's calendar day (YYYY-MM-DD) in the business zone. */
export function todayYMDInZone(timezone: string): string {
  return DateTime.now().setZone(timezone).toFormat('yyyy-MM-dd')
}

/**
 * The business zone's "today" as a browser-local Date anchored at noon.
 * The calendar page stores its current day as a plain local Date; anchoring
 * at noon guarantees the local calendar date never shifts across timezones
 * (the "wrong day" bug toISOString() causes). Everything downstream reads
 * only the YMD, so the clock time is irrelevant.
 */
export function businessTodayAsLocalDate(timezone: string): Date {
  const [y, m, d] = todayYMDInZone(timezone).split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0)
}

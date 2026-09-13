// ============================================================================
// Appointment Calendar Export (.ics)
// Standards-compliant iCalendar generation for customer appointments.
//
// Security model:
//   Events are generated server-side only, after the customer proves access
//   via the existing customerAccessToken mechanism (the same token gate used
//   by the public appointment/reschedule/cancel routes). Tokens are unique
//   per appointment and at least 32 characters — appointments are never
//   addressable by a predictable internal ID.
//
// Privacy model:
//   The generated event contains no customer PII — no name, phone, email,
//   or notes. CalendarAppointment deliberately has no customer fields.
//
// Timezone model:
//   DTSTART/DTEND are emitted as UTC instants (RFC 5545 form with Z suffix),
//   which is unambiguous across DST changes and requires no VTIMEZONE
//   definitions. The business's IANA timezone (from the Business record,
//   never hardcoded) is surfaced via X-WR-TIMEZONE and used for the
//   human-readable local time in the description.
// ============================================================================

import { TextEncoder } from 'util'
import { toLocalDate } from '@/lib/timezone'

export interface CalendarAppointment {
  confirmationNumber: string
  startTime: Date
  endTime: Date
  status: string
  service?: { name: string } | null
  barber?: { name: string } | null
  business?: {
    name: string
    address?: string | null
    city?: string | null
    state?: string | null
    zipCode?: string | null
    phone?: string | null
    timezone?: string | null
  } | null
}

const TEXT_ENCODER = new TextEncoder()

/** Minimum token length accepted for calendar export (matches public routes). */
export const CALENDAR_TOKEN_MIN_LENGTH = 32

/**
 * Escape a TEXT value per RFC 5545 §3.3.11:
 * backslash, semicolon, comma, and line breaks must be escaped.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n')
}

/** Format a Date as an RFC 5545 UTC datetime: YYYYMMDDTHHMMSSZ */
export function icsUtcTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * Fold a content line to a maximum of 75 octets per RFC 5545 §3.1,
 * continuing with a single space. Octets (not characters) matter for
 * correctness with multi-byte text.
 */
export function foldIcsLine(line: string): string {
  const bytes = TEXT_ENCODER.encode(line)
  if (bytes.length <= 75) return line

  const charBytes = Array.from(line).map(ch => TEXT_ENCODER.encode(ch).length)
  const out: string[] = []
  let pos = 0
  let currentLength = 0
  let firstLine = true
  let i = 0
  while (i < line.length) {
    const limit = firstLine ? 75 : 74 // continuation lines include the leading space
    const byteLen = charBytes[i]
    if (currentLength + byteLen > limit) {
      out.push(line.slice(pos, i))
      pos = i
      currentLength = 0
      firstLine = false
    }
    currentLength += byteLen
    i++
  }
  out.push(line.slice(pos))
  return out.join('\r\n ')
}

/**
 * Build a complete standards-compliant .ics document for one appointment.
 * Unavailable business fields (address, phone) are gracefully omitted.
 */
export function buildAppointmentIcs(appt: CalendarAppointment, now: Date = new Date()): string {
  const business = appt.business
  const serviceName = appt.service?.name || 'Appointment'
  const barberName = appt.barber?.name || 'Your barber'
  const businessName = business?.name
  const timezone = business?.timezone || 'UTC'

  const titleParts = [`${serviceName} with ${barberName}`]
  if (businessName) titleParts.push(`at ${businessName}`)
  const summary = titleParts.join(' ')

  // Compose the address from whatever fields exist — omit gracefully.
  const addressParts = [business?.address, business?.city, business?.state, business?.zipCode]
    .filter(part => part && part.trim())
    .map(part => part!.trim())
  const address = addressParts.join(', ')
  const phone = business?.phone?.trim() || undefined

  const descriptionLines: string[] = [
    `${serviceName} with ${barberName}`,
    businessName ? `Business: ${businessName}` : '',
    address ? `Address: ${address}` : '',
    phone ? `Call shop: ${phone}` : '',
    `Time: ${toLocalDate(appt.startTime, timezone).toFormat('ccc, MMM d, yyyy h:mm a ZZZZ')} (${timezone})`,
    `Confirmation: ${appt.confirmationNumber}`,
  ].filter(Boolean)

  const description = escapeIcsText(descriptionLines.join('\n'))

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Booking//Appointment 1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-TIMEZONE:${timezone}`,
    'BEGIN:VEVENT',
    // Stable UID: regenerated exports dedupe instead of duplicating.
    `UID:${escapeIcsText(appt.confirmationNumber)}@appointment`,
    `DTSTAMP:${icsUtcTimestamp(now)}`,
    `DTSTART:${icsUtcTimestamp(appt.startTime)}`,
    `DTEND:${icsUtcTimestamp(appt.endTime)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${description}`,
  ]
  if (address) lines.push(`LOCATION:${escapeIcsText(address)}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')

  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}

/**
 * Result of resolving a calendar export request for a token.
 * Errors carry HTTP-ish statuses; the route maps them directly.
 */
export type CalendarExportResult =
  | { ok: true; ics: string; filename: string }
  | { ok: false; status: 400 | 404 | 410; error: string }

/** True when a token has the minimum shape used by all public appointment routes. */
export function isValidCalendarToken(token: string): boolean {
  return typeof token === 'string' && token.length >= CALENDAR_TOKEN_MIN_LENGTH
}

/** Slugify a value for a download filename (ASCII, lowercase, dashed). */
export function icsFilename(value: string, date: Date): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const ymd = date.toISOString().slice(0, 10)
  return `${slug || 'appointment'}-${ymd}.ics`
}

/**
 * Authorize + build an export for a customer token.
 *
 * `fetchAppointmentByToken` is injected so this stays pure/testable; the
 * API route wires it to Prisma with a token lookup (never an ID lookup).
 */
export async function generateIcsForToken(
  token: string,
  fetchAppointmentByToken: (token: string) => Promise<CalendarAppointment | null>
): Promise<CalendarExportResult> {
  if (!isValidCalendarToken(token)) {
    return { ok: false, status: 400, error: 'Invalid token' }
  }

  const appt = await fetchAppointmentByToken(token)
  if (!appt) {
    return { ok: false, status: 404, error: 'Appointment not found' }
  }

  if (appt.status === 'CANCELLED') {
    return { ok: false, status: 410, error: 'This appointment was cancelled' }
  }

  const ics = buildAppointmentIcs(appt)
  return {
    ok: true,
    ics,
    filename: icsFilename(appt.service?.name || 'appointment', appt.startTime),
  }
}

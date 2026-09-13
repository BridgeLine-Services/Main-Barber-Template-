/**
 * Appointment Calendar Export tests — pure logic, no database.
 * The API route wires generateIcsForToken to Prisma; here the fetcher is
 * injected, so authorization, tenant isolation, and error paths are tested
 * without a live database.
 *
 * Covers the spec: timezone, DST transitions, appointment duration,
 * business address, missing address, special characters, tenant
 * isolation, unauthorized appointment access.
 */
import { TextEncoder } from 'util'
import {
  buildAppointmentIcs,
  escapeIcsText,
  foldIcsLine,
  icsUtcTimestamp,
  isValidCalendarToken,
  icsFilename,
  generateIcsForToken,
  CalendarAppointment,
} from '../src/lib/calendar-export'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, condition: boolean) {
  if (condition) {
    passed++
  } else {
    failed++
    failures.push(name)
  }
}

// RFC 5545 folds long lines with "\r\n " continuations — join them
// before doing content assertions on folded values (DESCRIPTION, etc).
function unfolded(ics: string): string {
  return ics.replace(/\r\n /g, '')
}

const HOUR = 60 * 60 * 1000

function appt(overrides: Partial<CalendarAppointment> = {}): CalendarAppointment {
  return {
    confirmationNumber: 'CONF-ABC123',
    startTime: new Date('2026-10-15T18:00:00.000Z'), // 11:00 AM PDT
    endTime: new Date('2026-10-15T18:45:00.000Z'),
    status: 'CONFIRMED',
    service: { name: 'Classic Cut' },
    barber: { name: 'Marco' },
    business: {
      name: 'Bridge Line Barbers',
      address: '482 Main St',
      city: 'Los Angeles',
      state: 'CA',
      zipCode: '90001',
      phone: '+1 555 010 2030',
      timezone: 'America/Los_Angeles',
    },
    ...overrides,
  }
}

;(async () => {
// ── Escaping (special characters) ──────────────────────────────────────────
{
  check('backslash escaped', escapeIcsText('a\\b') === 'a\\\\b')
  check('semicolon escaped', escapeIcsText('a;b') === 'a\\;b')
  check('comma escaped', escapeIcsText('a,b') === 'a\\,b')
  check('newline escaped', escapeIcsText('a\nb') === 'a\\nb')
  check('CRLF escaped', escapeIcsText('a\r\nb') === 'a\\nb')
  check('plain text untouched', escapeIcsText('Classic Cut') === 'Classic Cut')

  const special = appt({
    service: { name: 'Cut, Fade & Shave; "Deluxe"' },
    barber: { name: 'D\\Weaver' },
    business: {
      name: "Papa's Shop, Inc.",
      address: '45 Rue Léon, Apt #3',
      city: 'Montréal',
      state: 'QC',
      zipCode: 'H2X 1K4',
      phone: '+1 555 010 2030',
      timezone: 'America/Los_Angeles',
    },
  })
  const ics = buildAppointmentIcs(special)
  check('comma in service name escaped in SUMMARY', ics.includes('SUMMARY:Cut\\, Fade & Shave\\; "Deluxe" with D\\\\Weaver'))
  check('comma in business name escaped', ics.includes('at Papa\'s Shop\\, Inc.'))
  check('comma in address escaped in LOCATION', ics.includes('LOCATION:45 Rue Léon\\, Apt #3\\, Montréal\\, QC\\, H2X 1K4'))
  check('no bare unescaped comma inside SUMMARY value', !/SUMMARY:[^\r\n]*[^\\],/.test(ics))
}

// ── Line folding ────────────────────────────────────────────────────────────
{
  const short = 'SUMMARY:Classic Cut'
  check('short lines not folded', foldIcsLine(short) === short)

  const long = 'DESCRIPTION:' + 'x'.repeat(200)
  const folded = foldIcsLine(long)
  const segments = folded.split('\r\n ')
  const encoder = new TextEncoder()
  const all75OrLess = segments.every(s => encoder.encode(s).length <= 75)
  check('folded lines stay within 75 octets', all75OrLess)
  check('fold joins to the original', segments.join('') === long)
  check('fold uses space continuation', folded.includes('\r\n '))

  // Multi-byte text folds on octets, not characters
  const unicode = 'DESCRIPTION:' + 'é'.repeat(100) // 2 bytes each
  const foldedUnicode = foldIcsLine(unicode)
  const segs = foldedUnicode.split('\r\n ')
  check('multi-byte folding respects octet limit', segs.every(s => encoder.encode(s).length <= 75))
  check('multi-byte folding preserves content', segs.join('') === unicode)
}

// ── Structure and required fields ───────────────────────────────────────────
{
  const ics = buildAppointmentIcs(appt(), new Date('2026-09-13T17:00:00.000Z'))
  const lines = ics.split('\r\n')

  check('starts with BEGIN:VCALENDAR', lines[0] === 'BEGIN:VCALENDAR')
  check('ends with END:VCALENDAR', lines[lines.length - 2] === 'END:VCALENDAR' || lines[lines.length - 1] === 'END:VCALENDAR')
  check('CRLF line endings with trailing newline', ics.endsWith('\r\n'))
  check('VERSION 2.0 declared', lines.includes('VERSION:2.0'))
  check('PRODID present', ics.includes('PRODID:-//Booking//Appointment 1.0//EN'))
  check('single VEVENT', lines.filter(l => l === 'BEGIN:VEVENT').length === 1)

  check(
    'DTSTART is UTC RFC 5545 form',
    ics.includes('DTSTART:20261015T180000Z')
  )
  check(
    'DTEND is UTC RFC 5545 form',
    ics.includes('DTEND:20261015T184500Z')
  )
  check('DTSTAMP emitted', ics.includes('DTSTAMP:20260913T170000Z'))
  check('stable UID from confirmation number', ics.includes('UID:CONF-ABC123@appointment'))

  const rebuilt = buildAppointmentIcs(appt(), new Date('2026-09-13T17:00:00.000Z'))
  check(
    'same appointment + stamp produces identical output (dedupe on import)',
    rebuilt === ics
  )

  check('SUMMARY contains service and barber', ics.includes('SUMMARY:Classic Cut with Marco'))
  check('SUMMARY contains business name', ics.includes('at Bridge Line Barbers'))
  check('LOCATION composed from full address', ics.includes('LOCATION:482 Main St\\, Los Angeles\\, CA\\, 90001'))
  check('phone included in description', ics.includes('Call shop: +1 555 010 2030'))
  check('confirmation number in description', unfolded(ics).includes('Confirmation: CONF-ABC123'))
}

// ── Duration ────────────────────────────────────────────────────────────────
{
  const a = appt({ startTime: new Date('2026-10-15T18:00:00Z'), endTime: new Date('2026-10-15T18:45:00Z') })
  const ics = buildAppointmentIcs(a)
  check(
    'appointment duration (45 min) reflected as DTEND - DTSTART',
    ics.includes('DTSTART:20261015T180000Z') && ics.includes('DTEND:20261015T184500Z')
  )

  const ninety = appt({ startTime: new Date('2026-10-15T16:00:00Z'), endTime: new Date('2026-10-15T17:30:00Z') })
  const ics90 = buildAppointmentIcs(ninety)
  check('90-minute appointment reflected', ics90.includes('DTEND:20261015T173000Z'))

  // Midnight-crossing appointment keeps the correct end date
  const overnight = appt({ startTime: new Date('2026-10-15T23:30:00Z'), endTime: new Date('2026-10-16T01:00:00Z') })
  const icsOver = buildAppointmentIcs(overnight)
  check('overnight duration rolls to next day', icsOver.includes('DTSTART:20261015T233000Z') && icsOver.includes('DTEND:20261016T010000Z'))
}

// ── Timezone + DST ─────────────────────────────────────────────────────────
{
  // Timezone comes from the Business record — never hardcoded
  const la = buildAppointmentIcs(appt())
  check('business timezone surfaced (X-WR-TIMEZONE)', la.includes('X-WR-TIMEZONE:America/Los_Angeles'))

  const ny = buildAppointmentIcs(appt({
    business: { name: 'East Side Cuts', phone: '+1 555 010 4050', timezone: 'America/New_York' },
  }))
  check('different business → different timezone', ny.includes('X-WR-TIMEZONE:America/New_York'))
  check('no other timezone leaks into the NY event', !ny.includes('America/Los_Angeles'))

  // Missing business falls back to UTC without crashing
  const noBiz = buildAppointmentIcs(appt({ business: null }))
  check('missing business falls back to UTC', noBiz.includes('X-WR-TIMEZONE:UTC'))
  check('missing business still emits DTSTART', noBiz.includes('DTSTART:20261015T180000Z'))

  // DST: America/Los_Angeles — PDT (UTC-7) until Nov 1 2026, then PST (UTC-8).
  // The same local wall time produces different UTC instants on either side.
  const OctPdt = new Date('2026-10-31T21:30:00Z') // 2:30 PM PDT
  const NovPst = new Date('2026-11-01T22:30:00Z') // 2:30 PM PST
  check('PDT local 2:30 PM is 21:30Z', icsUtcTimestamp(OctPdt) === '20261031T213000Z')
  check('PST local 2:30 PM is 22:30Z', icsUtcTimestamp(NovPst) === '20261101T223000Z')

  const icsBefore = buildAppointmentIcs(appt({ startTime: OctPdt, endTime: new Date(OctPdt.getTime() + HOUR) }))
  const icsAfter = buildAppointmentIcs(appt({ startTime: NovPst, endTime: new Date(NovPst.getTime() + HOUR) }))

  // Local wall-clock time shown in the description stays 2:30 PM on both
  // sides of the transition (luxon applies the right offset per instant).
  const descBefore = icsBefore.replace(/\r\n /g, '').split('DESCRIPTION:')[1]?.split('\r\n')[0] || ''
  const descAfter = icsAfter.replace(/\r\n /g, '').split('DESCRIPTION:')[1]?.split('\r\n')[0] || ''
  check('description shows 2:30 PM local before DST end', descBefore.includes('2:30 PM'))
  check('description shows PDT abbreviation before the transition', descBefore.includes('PDT'))
  check('description shows 2:30 PM local after DST end', descAfter.includes('2:30 PM'))
  check('description shows PST abbreviation after the transition', descAfter.includes('PST'))

  // Spring forward: America/New_York, Mar 8 2026, 2:30 PM local
  const spring = new Date('2026-03-08T18:30:00Z') // EDT (UTC-4)
  const icsSpring = buildAppointmentIcs(appt({
    startTime: spring,
    endTime: new Date(spring.getTime() + HOUR),
    business: { name: 'East Side Cuts', phone: '+1 555 010 4050', timezone: 'America/New_York' },
  }))
  const springDesc = icsSpring.replace(/\r\n /g, '').split('DESCRIPTION:')[1]?.split('\r\n')[0] || ''
  check('description shows 2:30 PM local on spring-forward day', springDesc.includes('2:30 PM'))
  check('description shows EDT abbreviation on spring-forward day', springDesc.includes('EDT'))
}

// ── Business address / missing fields ───────────────────────────────────────
{
  // Missing address entirely
  const noAddress = buildAppointmentIcs(appt({
    business: { name: 'Bridge Line Barbers', phone: '+1 555 010 2030', timezone: 'America/Los_Angeles' },
  }))
  check('no LOCATION when address is missing', !noAddress.includes('LOCATION:'))
  check('no Address: line in description when missing', !noAddress.includes('Address:'))
  check('phone still present without address', unfolded(noAddress).includes('Call shop:'))
  check('event still well-formed without address', noAddress.includes('BEGIN:VEVENT') && noAddress.includes('END:VEVENT'))

  // Partial address: only street + city
  const partial = buildAppointmentIcs(appt({
    business: {
      name: 'Bridge Line Barbers',
      address: '482 Main St',
      city: 'Los Angeles',
      state: null,
      zipCode: null,
      phone: null,
      timezone: 'America/Los_Angeles',
    },
  }))
  check('partial address composed from available parts', unfolded(partial).includes('LOCATION:482 Main St\\, Los Angeles'))
  check('trailing separators not emitted for partial address', !partial.includes('LOCATION:482 Main St\\, Los Angeles\\,'))
  check('missing phone omitted gracefully', !partial.includes('Call shop:'))

  // Whitespace-only fields are treated as missing
  const blank = buildAppointmentIcs(appt({
    business: {
      name: 'Bridge Line Barbers',
      address: '   ',
      city: '',
      state: undefined,
      zipCode: null,
      phone: '   ',
      timezone: 'America/Los_Angeles',
    },
  }))
  check('whitespace-only address treated as missing', !blank.includes('LOCATION:'))
  check('whitespace-only phone treated as missing', !unfolded(blank).includes('Call shop:'))

  // No barber or service names — falls back without crashing
  const sparse = buildAppointmentIcs(appt({ service: null, barber: null }))
  check('missing service falls back', sparse.includes('SUMMARY:Appointment with Your barber'))
}

// ── Privacy: no customer PII ────────────────────────────────────────────────
{
  const ics = buildAppointmentIcs(appt())
  // The CalendarAppointment shape structurally cannot carry customer fields,
  // but guard against accidental future additions leaking.
  const leak = /Dana|555-0199|dana@example\.com|Customer:/.test(ics)
  check('no customer name/phone/email in the event', !leak)
}

// ── Token validation + tenant isolation (generateIcsForToken) ───────────────
{
  const tokenA = 'a'.repeat(40)
  const tokenB = 'b'.repeat(40)
  const tokenC = 'c'.repeat(40)
  const shops: Record<string, CalendarAppointment> = {
    [tokenA]: appt({ confirmationNumber: 'CONF-A' }), // tenant 1 appointment
    [tokenB]: appt({
      confirmationNumber: 'CONF-B',
      business: { name: 'East Side Cuts', phone: '+1 555 010 4050', timezone: 'America/New_York' },
    }),
    [tokenC]: appt({ confirmationNumber: 'CONF-C', status: 'CANCELLED' }),
  }
  const fakeFetch = async (token: string) => shops[token] || null

  // Short / malformed tokens rejected before any lookup
  const short = await generateIcsForToken('abc', fakeFetch)
  check('short token rejected with 400', short.ok === false && short.status === 400 && short.error === 'Invalid token')

  const justUnder = await generateIcsForToken('a'.repeat(31), fakeFetch)
  check('31-char token rejected (32 minimum)', justUnder.ok === false && justUnder.status === 400)

  // Unknown token → not found
  const missing = await generateIcsForToken('z'.repeat(40), fakeFetch)
  check('unknown token returns 404', missing.ok === false && missing.status === 404 && missing.error === 'Appointment not found')

  // Cancelled appointment → gone
  const cancelled = await generateIcsForToken(tokenC, fakeFetch)
  check('cancelled appointment returns 410', cancelled.ok === false && cancelled.status === 410)

  // Valid token → its own appointment only
  const tenantA = await generateIcsForToken(tokenA, fakeFetch)
  check('valid token resolves (tenant A)', tenantA.ok)
  if (tenantA.ok) {
    check('tenant A receives only its own appointment', tenantA.ics.includes('CONF-A'))
    check('tenant A does not receive tenant B data', !tenantA.ics.includes('CONF-B') && !tenantA.ics.includes('East Side Cuts'))
  }

  const tenantB = await generateIcsForToken(tokenB, fakeFetch)
  if (tenantB.ok) {
    check('tenant B receives only its own appointment', tenantB.ics.includes('CONF-B') && !tenantB.ics.includes('CONF-A'))
    check('tenant B event uses its own timezone', tenantB.ics.includes('X-WR-TIMEZONE:America/New_York'))
  } else {
    check('tenant B resolves', false)
  }

  // Predictable/incremental IDs never grant access — lookup is by unguessable
  // token only; an attacker holding a valid confirmation number but no token
  // has nothing to call.
  const byConfNumber = await generateIcsForToken('CONF-A', fakeFetch)
  check('confirmation number is not a valid token', byConfNumber.ok === false && byConfNumber.status === 400)
}

// ── Filename generation ─────────────────────────────────────────────────────
{
  const date = new Date('2026-10-15T18:00:00Z')
  check('filename slugged from service + date', icsFilename('Classic Cut', date) === 'classic-cut-2026-10-15.ics')
  check('special characters slugged safely', icsFilename('Cut & Fade, "Deluxe"!', date) === 'cut-fade-deluxe-2026-10-15.ics')
  check('empty name falls back', icsFilename('', date) === 'appointment-2026-10-15.ics')
  check('very long names truncated', icsFilename('x'.repeat(100), date).length < 60)
}

// ── Token shape helper ──────────────────────────────────────────────────────
{
  check('valid 32+ char token accepted', isValidCalendarToken('a'.repeat(32)))
  check('31-char token rejected', !isValidCalendarToken('a'.repeat(31)))
  check('empty token rejected', !isValidCalendarToken(''))
}

console.log(`Calendar export tests: ${passed} passed, ${failed} failed`)
if (failures.length) {
  console.log('Failures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
})()

/**
 * Section 9: Customer Haircut History & Preferences Tests
 *
 * Pure tests (no database): history summarization, preferred-barber derivation,
 * flexible preference formatting, the staff/customer privacy boundary, and
 * input sanitization.
 *
 * Run: npx tsx tests/customer-history.test.ts
 */

import {
  summarizeServiceHistory,
  computePreferredBarber,
  formatPreferencesForDisplay,
  toCustomerVisibleProfile,
  sanitizePreferences,
} from '../src/lib/customer-history'

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`)
    passed++
  } else {
    console.log(`  ❌ ${message}`)
    failed++
  }
}

const mk = (overrides: Record<string, unknown>) => ({
  id: 'appt1',
  status: 'COMPLETED',
  startTime: new Date('2026-08-01T20:00:00.000Z'),
  endTime: new Date('2026-08-01T20:30:00.000Z'),
  customerNotes: null,
  service: { id: 'svc1', name: 'Fade', price: 35 },
  barber: { id: 'b1', name: 'James' },
  ...overrides,
})

console.log('\n🧪 Customer history: summarization')
const history = summarizeServiceHistory([
  mk({ id: 'a1', startTime: new Date('2026-08-01T20:00:00.000Z') }),
  mk({ id: 'a2', startTime: new Date('2026-09-01T20:00:00.000Z') }),
])
assert(history.length === 2, 'summarizes each appointment into a service record')
assert(history[0].appointmentId === 'a2' && history[1].appointmentId === 'a1', 'history is ordered most recent first')
assert(summarizeServiceHistory([]).length === 0, 'empty history returns empty list')
assert(
  summarizeServiceHistory([mk({ service: null, barber: null })])[0].serviceName === 'Service removed' &&
    summarizeServiceHistory([mk({ service: null, barber: null })])[0].barberName === 'Unassigned',
  'handles removed services / unassigned barbers gracefully'
)

console.log('\n🧪 Customer history: preferred barber derivation')
const preferred = computePreferredBarber([
  mk({ barber: { id: 'b1', name: 'James' } }),
  mk({ barber: { id: 'b1', name: 'James' } }),
  mk({ barber: { id: 'b2', name: 'Carlos' } }),
])
assert(preferred?.barberId === 'b1' && preferred?.completedVisits === 2, 'preferred barber is the one with most COMPLETED visits')
assert(computePreferredBarber([]) === null, 'no history → no preferred barber')
assert(
  computePreferredBarber([mk({ status: 'CANCELLED' }), mk({ status: 'NO_SHOW' })]) === null,
  'cancelled / no-show visits never count toward preference'
)
const tie = computePreferredBarber([
  mk({ id: 'old', barber: { id: 'b1', name: 'James' }, startTime: new Date('2026-06-01T20:00:00.000Z') }),
  mk({ id: 'recent', barber: { id: 'b2', name: 'Carlos' }, startTime: new Date('2026-09-01T20:00:00.000Z') }),
])
assert(tie?.barberId === 'b2', 'tie in visit count falls to the most recent visit')

console.log('\n🧪 Customer history: flexible preference formatting')
const prefs = formatPreferencesForDisplay({
  haircutStyle: 'Low fade, tapered',
  guardLength: '#2 on the sides',
  custom_shop_thing: 'Hot towel always',
  nestedObject: { a: 1 },
  emptyString: '   ',
  listValue: ['scissors', 'clippers'],
  bool: true,
})
assert(prefs.find((p) => p.key === 'haircutStyle')?.label === 'Haircut Style', 'known keys get friendly labels')
assert(prefs.find((p) => p.key === 'guardLength')?.value === '#2 on the sides', 'values pass through verbatim')
assert(prefs.some((p) => p.key === 'custom_shop_thing' && p.label === 'Custom shop thing'), 'unknown keys are preserved with humanized labels — no rigid taxonomy')
assert(!prefs.some((p) => p.key === 'nestedObject'), 'non-scalar values are skipped, not coerced')
assert(!prefs.some((p) => p.key === 'emptyString'), 'blank values are skipped')
assert(prefs.find((p) => p.key === 'listValue')?.value === 'scissors, clippers', 'simple arrays join into a readable string')
assert(prefs.find((p) => p.key === 'bool')?.value === 'true', 'booleans render as text')
assert(formatPreferencesForDisplay(null).length === 0 && formatPreferencesForDisplay('x').length === 0, 'non-object input yields empty list')

console.log('\n🧪 Customer history: privacy boundary (staff notes never customer-visible)')
const profile = toCustomerVisibleProfile({
  customer: {
    firstName: 'Alex',
    lastName: 'Doe',
    email: 'alex@test.com',
    phone: '555-0100',
    smsConsent: true,
    preferences: { haircutStyle: 'Low fade' },
  },
  appointments: [
    mk({ id: 'past', status: 'COMPLETED' }),
    mk({ id: 'upcoming', status: 'CONFIRMED', startTime: new Date('2030-01-01T20:00:00.000Z'), endTime: new Date('2030-01-01T20:30:00.000Z') }),
  ],
  now: new Date('2026-09-15T00:00:00.000Z'),
})
const serialized = JSON.stringify(profile)
assert(!serialized.includes('notes') && !serialized.includes('tags'), 'customer-visible profile contains no staff notes or tags fields')
assert(profile.preferences.length === 1 && profile.preferences[0].value === 'Low fade', 'customer-visible profile includes preferences')
assert(profile.upcomingCount === 1 && profile.completedCount === 1, 'upcoming/completed counts are computed correctly')
assert(profile.serviceHistory.length === 2, 'service history is included for the customer')

console.log('\n🧪 Customer history: preference input sanitization')
assert(sanitizePreferences({ haircutStyle: 'Low fade', guardLength: 2 }) !== null, 'accepts simple string/number preferences')
assert(sanitizePreferences({}) === null, 'rejects empty preference payloads')
assert(sanitizePreferences('not an object') === null, 'rejects non-object payloads')
assert(sanitizePreferences({ bad: { nested: 'no' } }) === null, 'rejects nested object values')
const tooMany: Record<string, string> = {}
for (let i = 0; i < 21; i++) tooMany[`pref${i}`] = 'x'
assert(sanitizePreferences(tooMany) === null, 'rejects more than 20 keys')
assert(sanitizePreferences({ [`${'x'.repeat(50)}`]: 'too long key' }) === null, 'rejects keys longer than 40 chars')
assert(sanitizePreferences({ ok: 'x'.repeat(201) }) === null, 'rejects values longer than 200 chars')
assert(sanitizePreferences({ 'weird key!': 'x' }) === null, 'rejects keys with special characters')
const cleaned = sanitizePreferences({ num: 42, flag: true })
assert(cleaned?.num === '42' && cleaned?.flag === 'true', 'numbers and booleans are coerced to strings')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

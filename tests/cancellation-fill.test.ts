/**
 * Section 8: Cancellation-Fill Assistant Tests
 *
 * Pure tests (no database): candidate matching and deterministic priority
 * ordering against a released slot. DB-dependent behaviors (offer atomicity,
 * slot re-check) are guarded in the route + lib and exercised via reliability
 * patterns elsewhere.
 *
 * Run: npx tsx tests/cancellation-fill.test.ts
 */

import { rankWaitlistCandidates, dayPartOf, OFFER_HOLD_MINUTES } from '../src/lib/cancellation-fill'
import type { WaitlistCandidateInput } from '../src/lib/cancellation-fill'

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

const TZ = 'America/Los_Angeles'

function makeEntry(overrides: Partial<WaitlistCandidateInput> & { id: string }): WaitlistCandidateInput {
  return {
    businessId: 'biz1',
    customerId: null,
    firstName: 'Alex',
    lastName: 'Doe',
    phone: '555-0100',
    email: 'alex@test.com',
    barberId: null,
    serviceId: 'svc-fade',
    preferredDate: new Date('2026-09-20T00:00:00.000Z'),
    preferredTimeRange: null,
    status: 'WAITING',
    notifiedAt: null,
    expiresAt: null,
    offeredSlotStart: null,
    createdAt: new Date('2026-09-10T15:00:00.000Z'),
    ...overrides,
  }
}

// Opening: Sept 20, 2026, 2:30 PM PDT, barber James, fade service
const opening = {
  businessId: 'biz1',
  barberId: 'barber-james',
  serviceId: 'svc-fade',
  startTime: new Date('2026-09-20T21:30:00.000Z'), // 2:30 PM PDT
  timezone: TZ,
}

console.log('\n🧪 Cancellation-Fill: service matching')

assert(
  rankWaitlistCandidates([makeEntry({ id: 'e1', serviceId: 'svc-shave' })], opening).length === 0,
  'excludes entries requesting a different service'
)
assert(
  rankWaitlistCandidates([makeEntry({ id: 'e1' })], opening).length === 1,
  'includes entries requesting the same service'
)
assert(
  rankWaitlistCandidates([makeEntry({ id: 'e1', serviceId: 'other' })], opening).length === 0,
  'service match is exact, not fuzzy'
)

console.log('\n🧪 Cancellation-Fill: barber matching')
assert(
  rankWaitlistCandidates([makeEntry({ id: 'e1', barberId: 'barber-other' })], opening).length === 0,
  'excludes entries requesting a different specific barber'
)
assert(
  rankWaitlistCandidates([makeEntry({ id: 'e1', barberId: 'barber-james' })], opening).length === 1,
  'includes entries requesting the exact barber'
)
assert(
  rankWaitlistCandidates([makeEntry({ id: 'e1', barberId: null })], opening).length === 1,
  'includes entries open to any barber (barberId null)'
)

console.log('\n🧪 Cancellation-Fill: status / pending offer handling')
assert(
  rankWaitlistCandidates([makeEntry({ id: 'e1', status: 'NOTIFIED' })], opening).length === 0,
  'excludes entries with a pending (NOTIFIED) offer'
)
assert(
  rankWaitlistCandidates([makeEntry({ id: 'e1', status: 'WAITLIST_FULFILLED' })], opening).length === 0,
  'excludes entries in a non-WAITING state'
)
assert(
  rankWaitlistCandidates([makeEntry({ id: 'e1', status: 'NOTIFIED', expiresAt: new Date('2026-09-01T00:00:00Z'), offeredSlotStart: opening.startTime }), makeEntry({ id: 'e2' })], opening, new Date('2026-09-20T12:00:00Z')).map((c) => c.entryId).join(',') === 'e2',
  'WAITING entry ranks even alongside an expired offer on the same slot (duplicate prevention is live-offer only, and e2 wins by order)'
)

console.log('\n🧪 Cancellation-Fill: tenant isolation (defense in depth)')
assert(
  rankWaitlistCandidates([makeEntry({ id: 'e1', businessId: 'biz-other' })], opening).length === 0,
  'pure ranker never returns entries from another business'
)

console.log('\n🧪 Cancellation-Fill: date preference')
assert(
  rankWaitlistCandidates([makeEntry({ id: 'e1', preferredDate: new Date('2026-09-25T00:00:00.000Z') })], opening).length === 0,
  'excludes entries preferring a LATER date than the slot'
)
assert(
  rankWaitlistCandidates([makeEntry({ id: 'e1', preferredDate: new Date('2026-09-20T00:00:00.000Z') })], opening).length === 1,
  'includes entries preferring the exact slot date'
)
assert(
  rankWaitlistCandidates([makeEntry({ id: 'e1', preferredDate: new Date('2026-09-18T00:00:00.000Z') })], opening).length === 1,
  'includes entries preferring an earlier date (slot may satisfy them sooner)'
)

console.log('\n🧪 Cancellation-Fill: deterministic priority ordering')

const ranked = rankWaitlistCandidates(
  [
    // anyBarber, exact date, no time pref, earliest
    makeEntry({ id: 'any-barber-early', createdAt: new Date('2026-09-10T15:00:00.000Z') }),
    // specific barber, exact date, matching time range (afternoon), later join
    makeEntry({
      id: 'james-exact',
      barberId: 'barber-james',
      preferredDate: new Date('2026-09-20T00:00:00.000Z'),
      preferredTimeRange: 'afternoon',
      createdAt: new Date('2026-09-12T15:00:00.000Z'),
    }),
    // specific barber, earlier date preference, later join
    makeEntry({
      id: 'james-earlier-date',
      barberId: 'barber-james',
      preferredDate: new Date('2026-09-18T00:00:00.000Z'),
      createdAt: new Date('2026-09-11T15:00:00.000Z'),
    }),
  ],
  opening
)

assert(ranked.map((c) => c.entryId).join(',') === 'james-exact,james-earlier-date,any-barber-early', 'barber match outranks date/time/creation order')
assert(ranked[0].matchReasons.includes('Requested this barber'), 'top candidate shows barber match reason')

const fifo = rankWaitlistCandidates(
  [makeEntry({ id: 'late', createdAt: new Date('2026-09-12T15:00:00.000Z') }), makeEntry({ id: 'early', createdAt: new Date('2026-09-10T15:00:00.000Z') })],
  opening
)
assert(fifo.map((c) => c.entryId).join(',') === 'early,late', 'all else equal, earlier-created entry ranks first (FIFO)')

const timePref = rankWaitlistCandidates(
  [
    makeEntry({ id: 'no-pref' }),
    makeEntry({ id: 'matching-afternoon', preferredTimeRange: 'afternoon' }),
    makeEntry({ id: 'morning-only', preferredTimeRange: 'morning' }),
  ],
  opening
)
assert(
  timePref.map((c) => c.entryId).join(',') === 'matching-afternoon,morning-only,no-pref',
  'matching time range ranks first, then any time preference, then none'
)

console.log('\n🧪 Cancellation-Fill: transparency of match reasons')
assert(
  ranked[0].matchReasons.includes('Requested this date') && ranked[0].matchReasons.includes('Requested afternoon times'),
  'reasons expose exactly the criteria used (date + time range)'
)

console.log('\n🧪 Cancellation-Fill: hold duration sanity')
assert(OFFER_HOLD_MINUTES === 15, 'offer hold is 15 minutes')

console.log('\n🧪 Cancellation-Fill: day-part mapping (business timezone)')
assert(dayPartOf(new Date('2026-09-20T15:30:00.000Z'), TZ) === 'morning', '8:30 AM PDT is morning')
assert(dayPartOf(new Date('2026-09-20T21:30:00.000Z'), TZ) === 'afternoon', '2:30 PM PDT is afternoon')
assert(dayPartOf(new Date('2026-09-21T01:00:00.000Z'), TZ) === 'evening', '6:00 PM PDT is evening')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

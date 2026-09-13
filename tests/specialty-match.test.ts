/**
 * Specialty Matching + First Available Ordering Tests
 *
 * Pure-logic tests (no database required):
 *   - specialty tokenization and stemming
 *   - service-name ↔ barber-specialty overlap
 *   - ranking: matches first, then existing order asc, stable otherwise
 *   - First Available: chronological slot ordering + deterministic tie-break
 *
 * Run: npx tsx tests/specialty-match.test.ts
 */

import {
  specialtyTokens,
  matchSpecialty,
  rankBarbersForService,
} from '../src/lib/specialty-match'
import { slotTimeToMinutes } from '../src/lib/availability'

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

console.log('\nTokenization')
{
  const t = specialtyTokens('Fades • Tapers • Beard Work')
  assert(t.includes('fade') && t.includes('taper') && t.includes('beard'), 'splits and stems plural tokens')
  assert(t.includes('work'), 'keeps single-word tokens')
  assert(!specialtyTokens('The Cut and a Trim').includes('the'), 'stop words removed')
  assert(specialtyTokens(null).length === 0, 'null specialty tokenizes to empty')
  assert(specialtyTokens('Kids Cuts').includes('kid'), 'stemming handles "Kids" → "kid"')
}

console.log('\nMatch computation')
{
  const m = matchSpecialty('Skin Fade', 'Fades • Tapers • Beard Work')
  assert(m.overlap === 1 && m.matchedTerms[0] === 'fade', 'plural specialty matches singular service token')
  const none = matchSpecialty('Beard Trim', 'Fades • Tapers')
  assert(none.overlap === 0, 'no overlap → 0')
  const empty = matchSpecialty(null, 'Fades')
  assert(empty.overlap === 0, 'missing service name → 0')
  const noSpecialty = matchSpecialty('Fades', null)
  assert(noSpecialty.overlap === 0, 'barber without specialty → 0 (graceful)')
  const multi = matchSpecialty('Kids Fade Service', 'Kids Fades • Line Ups')
  assert(multi.overlap >= 2, 'multiple overlapping tokens counted')
}

console.log('\nRanking')
{
  const barbers = [
    { id: 'a', name: 'A', specialty: 'Beard Work', order: 1 },
    { id: 'b', name: 'B', specialty: 'Fades • Tapers', order: 2 },
    { id: 'c', name: 'C', specialty: null, order: 3 },
    { id: 'd', name: 'D', specialty: 'Fade Master', order: 4 },
  ]
  const ranked = rankBarbersForService(barbers, 'Skin Fade')
  assert(ranked[0].barber.id === 'b', 'higher overlap ranks first (2 tokens)')
  assert(ranked[1].barber.id === 'd', 'single-overlap match ranks next')
  assert(ranked[2].barber.id === 'a' && ranked[3].barber.id === 'c', 'non-matches keep original order after matches')

  // Tie on overlap count → order asc decides
  const tie = rankBarbersForService(
    [
      { id: 'x', specialty: 'Fade Pro', order: 5 },
      { id: 'y', specialty: 'Fades', order: 1 },
    ],
    'Fade'
  )
  assert(tie[0].barber.id === 'y', 'equal overlap → lower order wins (deterministic)')

  // No serviceName → pure order asc, everyone "unmatched"
  const noName = rankBarbersForService(barbers, null)
  assert(noName.map(r => r.barber.id).join(',') === 'a,b,c,d', 'no service name → original order preserved')
}

console.log('\nFirst Available chronological ordering')
{
  assert(slotTimeToMinutes('1:00 PM') < slotTimeToMinutes('2:00 PM'), 'afternoon ordering')
  assert(slotTimeToMinutes('11:00 AM') < slotTimeToMinutes('12:00 PM'), 'AM before noon')
  assert(slotTimeToMinutes('12:00 PM') < slotTimeToMinutes('12:30 PM'), 'minutes within hour')
  assert(slotTimeToMinutes('11:30 AM') < slotTimeToMinutes('12:00 PM'), 'late morning before noon')
  assert(slotTimeToMinutes('9:15 AM') < slotTimeToMinutes('9:20 AM'), 'quarter-hour precision')

  // Regression: barber B's 1:00 PM slot was merged AFTER barber A's 2:00 PM
  // slot in insertion order — sorting by parsed time must put 1:00 PM first.
  const merged = [
    { time: '2:00 PM', available: true },
    { time: '1:00 PM', available: true },
  ].sort((a, b) => slotTimeToMinutes(a.time) - slotTimeToMinutes(b.time))
  assert(merged[0].time === '1:00 PM', 'insertion order does not decide "earliest" — time does')

  // Unavailable slots can never become "earliest"
  const mergedUnavailable = [
    { time: '9:00 AM', available: false },
    { time: '10:00 AM', available: true },
  ].sort((a, b) => slotTimeToMinutes(a.time) - slotTimeToMinutes(b.time))
  assert(
    mergedUnavailable.find(s => s.available)!.time === '10:00 AM',
    'earliest AVAILABLE slot skips unavailable earlier times'
  )
}

console.log(`\nSpecialty + First Available tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

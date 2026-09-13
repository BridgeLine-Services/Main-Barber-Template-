/**
 * Section 10: Daily Operations Tests
 *
 * Pure tests (no database): open-range computation accounting for
 * appointments, breaks, blocked time and closures; utilization math; and
 * per-barber price override handling.
 *
 * Run: npx tsx tests/daily-operations.test.ts
 */

import {
  computeFreeRanges,
  minutesWithin,
  computeUtilization,
  effectivePrice,
  MIN_OPEN_GAP_MINUTES,
} from '../src/lib/daily-operations'

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

const T = (s: string) => new Date(s)
const win = { start: T('2026-09-20T15:00:00.000Z'), end: T('2026-09-20T23:00:00.000Z') } // 8h window

console.log('\n🧪 Daily operations: free-range computation')
const simple = computeFreeRanges(win, [{ start: T('2026-09-20T17:00:00.000Z'), end: T('2026-09-20T18:00:00.000Z') }])
assert(simple.length === 2, 'a single appointment splits the window into two free ranges')
assert(simple[0].end.getTime() === T('2026-09-20T17:00:00.000Z').getTime(), 'first range ends where the appointment begins')

const adjacent = computeFreeRanges(win, [
  { start: T('2026-09-20T15:00:00.000Z'), end: T('2026-09-20T16:00:00.000Z') },
  { start: T('2026-09-20T16:00:00.000Z'), end: T('2026-09-20T17:00:00.000Z') },
])
assert(adjacent.length === 1 && adjacent[0].start.getTime() === T('2026-09-20T17:00:00.000Z').getTime(), 'back-to-back appointments leave no phantom gap')

const overlapping = computeFreeRanges(win, [
  { start: T('2026-09-20T17:00:00.000Z'), end: T('2026-09-20T18:30:00.000Z') },
  { start: T('2026-09-20T18:00:00.000Z'), end: T('2026-09-20T19:00:00.000Z') },
])
assert(overlapping.length === 2, 'overlapping appointments are merged, not double-subtracted')
assert(overlapping[1].start.getTime() === T('2026-09-20T19:00:00.000Z').getTime(), 'merged busy time ends at the latest end')

const clipped = computeFreeRanges(win, [
  { start: T('2026-09-20T13:00:00.000Z'), end: T('2026-09-20T16:00:00.000Z') },
  { start: T('2026-09-20T22:30:00.000Z'), end: T('2026-09-20T23:30:00.000Z') },
])
assert(clipped.length === 1 && clipped[0].start.getTime() === T('2026-09-20T16:00:00.000Z').getTime(), 'busy time before/after the window is clipped')

const withBreak = computeFreeRanges(win, [
  { start: T('2026-09-20T17:00:00.000Z'), end: T('2026-09-20T18:00:00.000Z') }, // appointment
  { start: T('2026-09-20T18:30:00.000Z'), end: T('2026-09-20T19:00:00.000Z') }, // lunch break
])
assert(withBreak.length === 3, 'breaks and appointments both reduce open time')
assert(computeFreeRanges(win, []).length === 1 && computeFreeRanges(win, [])[0].end.getTime() === win.end.getTime(), 'an empty day yields one full-day open range')
assert(computeFreeRanges(win, [{ start: win.start, end: win.end }]).length === 0, 'a fully booked day yields no open ranges')

console.log('\n🧪 Daily operations: minutes accounting')
assert(minutesWithin(win, [{ start: T('2026-09-20T17:00:00.000Z'), end: T('2026-09-20T18:00:00.000Z') }]) === 60, 'minutes are computed correctly inside the window')
assert(
  minutesWithin(win, [{ start: T('2026-09-20T10:00:00.000Z'), end: T('2026-09-20T23:30:00.000Z') }]) === 480,
  'ranges extending past the window are clipped before counting'
)

console.log('\n🧪 Daily operations: utilization')
const util = computeUtilization(
  win,
  [{ start: T('2026-09-20T15:00:00.000Z'), end: T('2026-09-20T18:00:00.000Z') }], // 3h scheduled
  [{ start: T('2026-09-20T18:30:00.000Z'), end: T('2026-09-20T19:00:00.000Z') }], // 30m break
  [] // no blocks
)
assert(util.availableMinutes === 450, 'available minutes = window minus breaks and blocks')
assert(util.scheduledMinutes === 180, 'scheduled minutes count chair-occupying appointments')
assert(Math.round(util.utilizationPct!) === 40, 'utilization = scheduled / available')
const noCapacity = computeUtilization(win, [], [], [])
assert(noCapacity.availableMinutes === 480 && noCapacity.utilizationPct === 0, 'a free day shows 0% utilization, not null')
assert(computeUtilization({ start: win.start, end: win.start }, [], [], []).utilizationPct === null, 'a zero-length window reports null utilization')

console.log('\n🧪 Daily operations: price overrides')
assert(effectivePrice(35, 40) === 40, 'barber price override wins over base service price')
assert(effectivePrice(35, null) === 35, 'null override falls back to base price')
assert(effectivePrice(35, undefined) === 35, 'missing override falls back to base price')
assert(effectivePrice(null, undefined) === 0, 'missing base price does not crash — counts as 0')

console.log('\n🧪 Daily operations: gap threshold sanity')
assert(MIN_OPEN_GAP_MINUTES === 15, 'gaps under 15 minutes are not presented as open slots')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

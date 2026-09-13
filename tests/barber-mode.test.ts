/**
 * Barber Mode Tests
 *
 * Pure-logic tests for the barber-mode schedule derivation:
 *   - current appointment (time-derived, no lifecycle change)
 *   - next / remaining appointments
 *   - completed / cancelled / no-show grouping
 *   - quick-action gating mirrors the canonical status model
 *   - relative "when" labels
 *
 * Tenant isolation and barber scoping for the history route are enforced at
 * the route level via businessId/barberId-scoped queries (see
 * src/app/api/dashboard/barber-mode/history/route.ts); the derivation here
 * receives only already-scoped rows.
 *
 * Run: npx tsx tests/barber-mode.test.ts
 */

import {
  deriveBarberModeDay,
  availableActions,
  formatRelativeWhen,
  BarberModeAppointment,
} from '../src/lib/barber-mode'

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

const NOW = '2026-09-13T18:00:00.000Z' // fixed "now"

function appt(
  id: string,
  startMinutes: number,
  endMinutes: number,
  status: string,
  name = 'Customer'
): BarberModeAppointment {
  const base = new Date('2026-09-13T15:00:00.000Z').getTime() // day start
  return {
    id,
    confirmationNumber: `BRB-${id}`,
    status,
    startTime: new Date(base + startMinutes * 60_000),
    endTime: new Date(base + endMinutes * 60_000),
    customer: { id: `c-${id}`, firstName: name, lastName: 'Test', phone: '+15550000000', notes: null, preferences: null },
    service: { id: `s-${id}`, name: 'Fade', duration: 30, price: 30 },
    customerNotes: null,
  }
}

console.log('\nCurrent appointment (time-derived)')
{
  // 18:00Z: appt B (17:30–18:10) is happening now
  const day = deriveBarberModeDay(
    [appt('A', 0, 30, 'COMPLETED'), appt('B', 150, 190, 'CONFIRMED'), appt('C', 240, 270, 'CONFIRMED')],
    NOW
  )
  assert(day.current?.id === 'B', 'current is the active appointment whose window contains now')
  assert(day.next?.id === 'C', 'next is the first future active appointment')
  assert(day.upcoming.length === 0, 'no remaining after next')
  assert(day.completed.length === 1 && day.completed[0].id === 'A', 'completed grouped')
}

{
  // A cancelled appointment overlapping "now" must NOT be current
  const day = deriveBarberModeDay(
    [appt('X', 150, 190, 'CANCELLED'), appt('Y', 240, 270, 'PENDING')],
    NOW
  )
  assert(day.current === null, 'cancelled appointment is never current')
  assert(day.next?.id === 'Y', 'next skips cancelled')
}

{
  // No active appointments today
  const day = deriveBarberModeDay(
    [appt('A', 0, 30, 'COMPLETED'), appt('N', 60, 90, 'NO_SHOW')],
    NOW
  )
  assert(day.current === null && day.next === null, 'terminal-only day has no current/next')
  assert(day.noShows.length === 1, 'no-shows grouped')
}

console.log('\nChronological ordering')
{
  // Input deliberately out of order
  const day = deriveBarberModeDay(
    [appt('C', 240, 270, 'CONFIRMED'), appt('A', 0, 30, 'COMPLETED'), appt('B', 150, 190, 'CONFIRMED')],
    NOW
  )
  assert(
    day.all.map(a => a.id).join(',') === 'A,B,C',
    'day list is chronological regardless of input order'
  )
}

console.log('\nRESCHEDULED handling')
{
  const day = deriveBarberModeDay([appt('R', 150, 190, 'RESCHEDULED')], NOW)
  assert(day.current === null, 'RESCHEDULED is not current (it moved to another time)')
  assert(day.all.length === 1, 'rescheduled still appears in the day list')
}

console.log('\nQuick-action gating (canonical status model)')
{
  assert(availableActions({ status: 'PENDING' }).complete, 'PENDING can be completed')
  assert(availableActions({ status: 'CONFIRMED' }).complete, 'CONFIRMED can be completed')
  assert(availableActions({ status: 'CONFIRMED' }).markNoShow, 'CONFIRMED can be marked no-show')
  assert(availableActions({ status: 'CONFIRMED' }).cancel, 'CONFIRMED can be cancelled')
  assert(!availableActions({ status: 'COMPLETED' }).complete, 'COMPLETED is terminal')
  assert(!availableActions({ status: 'CANCELLED' }).cancel, 'CANCELLED is terminal')
  assert(!availableActions({ status: 'NO_SHOW' }).markNoShow, 'NO_SHOW is terminal')
  assert(!availableActions({ status: 'RESCHEDULED' }).complete, 'RESCHEDULED offers no barber quick actions')
}

console.log('\nRelative when labels')
{
  assert(formatRelativeWhen('2026-09-13T18:00:00.000Z', NOW) === 'now', 'now label')
  assert(formatRelativeWhen('2026-09-13T19:30:00.000Z', NOW) === 'in 1h 30m', 'future label')
  assert(formatRelativeWhen('2026-09-13T17:00:00.000Z', NOW) === '1h ago', 'past label')
  assert(formatRelativeWhen('2026-09-13T18:20:00.000Z', NOW) === 'in 20m', 'minutes-only label')
}

console.log(`\nBarber Mode tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

/**
 * Section: Concurrent bookings — the double-booking guard, actually exercised.
 *
 * createAppointmentSafely re-checks availability inside a SERIALIZABLE
 * transaction and maps a serialization failure (P2034) to the same friendly
 * "just booked" message as an explicit conflict. That design is only worth
 * anything if two customers pressing Book at the same instant really do end up
 * with one appointment and one clear error, so this suite fires many bookings
 * at the same slot simultaneously instead of trusting the code by reading it.
 *
 * Run: npx tsx tests/booking-concurrency.test.ts
 */

import { prisma } from '../src/lib/prisma'
import { createAppointmentSafely } from '../src/lib/availability'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}

const SLOT_TAKEN_MESSAGE = 'That appointment time was just booked by another customer. Please choose another time.'
// Under heavy contention a request can lose a race, exhaust its retries and be
// told to try again. That is honest, and it is still a sentence a person can act
// on. What must never happen is the raw driver text reaching a customer, so the
// suite asserts plain language rather than one exact wording for the racers, and
// proves the exact conflict wording separately without a race.
const RETRY_MESSAGE = 'We could not complete that booking just now. Please try again in a moment.'
const PLAIN_LANGUAGE = [SLOT_TAKEN_MESSAGE, RETRY_MESSAGE]

function isRawTechnical(message: string | undefined) {
  const text = String(message ?? '')
  return /constraint|Transaction|prisma|P20\d\d|23P01|invalid|ConnectorError/i.test(text)
}

function futureSlot(hoursAhead: number): Date {
  const d = new Date(Date.now() + hoursAhead * 3_600_000)
  d.setUTCMinutes(Math.round(d.getUTCMinutes() / 15) * 15, 0, 0)
  if (d.getUTCHours() === 23) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 10, 0, 0))
  }
  return d
}

async function setupBusiness(barberCount = 1) {
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const business = await prisma.business.create({
    data: {
      name: `Race Shop ${stamp}`,
      slug: `race-shop-${stamp}`.toLowerCase(),
      email: `race${stamp}@example.com`.replace(/[^a-z0-9@.]/gi, ''),
      phone: '555-0101',
      address: '1 Test St',
      city: 'TestCity',
      state: 'CA',
      zipCode: '90001',
      timezone: 'UTC',
      minAdvanceBookingMinutes: 0,
      maxBookingWindowDays: null,
      bufferMinutes: 0,
      cancellationDeadlineHours: 0,
    },
  })
  const barbers = []
  for (let i = 0; i < barberCount; i++) {
    const barber = await prisma.barber.create({ data: { name: `Race Barber ${i}`, businessId: business.id } })
    for (let day = 0; day < 7; day++) {
      await prisma.schedule.create({
        data: { barberId: barber.id, dayOfWeek: day, startTime: '00:00', endTime: '23:45', isOff: false },
      })
    }
    barbers.push(barber)
  }
  const service = await prisma.service.create({
    data: { businessId: business.id, name: `Race Cut ${stamp}`, duration: 60, price: 30, bufferMinutes: 0 },
  })
  return { business, barbers, service }
}

const booking = (businessId: string, barberId: string, serviceId: string, startTime: Date, who: number) => ({
  businessId,
  barberId,
  serviceId,
  startTime,
  customerData: {
    firstName: `Racer${who}`,
    lastName: 'Test',
    phone: `555000${String(who).padStart(4, '0')}`,
    email: `racer${who}.${Date.now()}@example.com`,
  },
})

async function main() {
  console.log('\n📦 Eight customers, one slot, at the same moment')
  {
    const { business, barbers, service } = await setupBusiness()
    const slot = futureSlot(72)
    const attempts = 8
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) =>
        createAppointmentSafely(booking(business.id, barbers[0].id, service.id, slot, i + 1))
          .catch((e) => ({ success: false, error: String(e) }))
      )
    )
    const wins = results.filter((r) => r.success)
    const losses = results.filter((r) => !r.success)
    assert(wins.length === 1, `exactly one booking wins (got ${wins.length} of ${attempts})`)
    assert(losses.length === attempts - 1, 'every other attempt is refused')
    assert(
      losses.every((r) => PLAIN_LANGUAGE.includes(String(r.error))),
      'every loser gets one of the two plain-language messages'
    )
    assert(
      losses.every((r) => !isRawTechnical(r.error)),
      'no loser is shown raw database text (constraint names, transaction errors)'
    )
    // Whether a *given* loser is told the slot went depends on how far it got
    // before losing: one that hit a deadlock and retried reports the conflict,
    // one that exhausted its attempts reports "try again". Both are honest, and
    // which happens is a race. What must always hold is that the customer can
    // find out the slot is gone, so a loser not told during the race is provable
    // by the very next attempt.
    const toldDuringRace = losses.filter((r) => r.error === SLOT_TAKEN_MESSAGE).length
    if (toldDuringRace >= 1) {
      assert(true, `at least one loser is told plainly that the time was just booked (${toldDuringRace} of ${losses.length})`)
    } else {
      const after = await createAppointmentSafely({
        businessId: business.id,
        barberId: barbers[0].id,
        serviceId: service.id,
        startTime: slot,
        customerData: {
          firstName: 'After', lastName: 'Race', phone: '5550199999',
          email: `race-after-${Date.now()}@example.com`,
        },
      })
      assert(
        after.success === false && after.error === SLOT_TAKEN_MESSAGE,
        'when no loser was told during the race, the next attempt is told plainly'
      )
    }
    const rows = await prisma.appointment.count({
      where: { businessId: business.id, barberId: barbers[0].id, startTime: slot },
    })
    assert(rows === 1, `the calendar holds exactly one appointment for that slot (found ${rows})`)
    await prisma.business.delete({ where: { id: business.id } }).catch(() => {})
  }

  console.log('\n📦 Two barbers, the same time — no false conflict between them')
  {
    const { business, barbers, service } = await setupBusiness(2)
    const slot = futureSlot(80)
    const [a, b] = await Promise.all([
      createAppointmentSafely(booking(business.id, barbers[0].id, service.id, slot, 11)),
      createAppointmentSafely(booking(business.id, barbers[1].id, service.id, slot, 12)),
    ])
    assert(a.success === true && b.success === true, 'both barbers can be booked at the same time')
    await prisma.business.delete({ where: { id: business.id } }).catch(() => {})
  }

  console.log('\n📦 A retried submission does not create a second appointment')
  {
    const { business, barbers, service } = await setupBusiness()
    const slot = futureSlot(88)
    const key = `idem-${Date.now()}`
    const first = await createAppointmentSafely({ ...booking(business.id, barbers[0].id, service.id, slot, 21), idempotencyKey: key })
    const second = await createAppointmentSafely({ ...booking(business.id, barbers[0].id, service.id, slot, 21), idempotencyKey: key })
    assert(first.success === true, 'the first submission is accepted')
    const rows = await prisma.appointment.count({ where: { businessId: business.id, barberId: barbers[0].id, startTime: slot } })
    assert(rows === 1, `the same idempotency key inserts one row, not two (found ${rows})`)
    if (second.success) {
      assert(second.appointment?.id === first.appointment?.id, 'the replay returns the original appointment')
    }
    await prisma.business.delete({ where: { id: business.id } }).catch(() => {})
  }

  console.log('\n📦 A second booking on a taken slot says exactly that (no race needed)')
  {
    const { business, barbers, service } = await setupBusiness()
    const slot = futureSlot(96)
    const first = await createAppointmentSafely(booking(business.id, barbers[0].id, service.id, slot, 31))
    const second = await createAppointmentSafely(booking(business.id, barbers[0].id, service.id, slot, 32))
    assert(first.success === true, 'the first booking is accepted')
    assert(second.success === false, 'the second is refused')
    assert(second.error === SLOT_TAKEN_MESSAGE, 'and the refusal is the exact plain-language conflict sentence')
    assert(!isRawTechnical(second.error), 'with no driver detail attached')
    await prisma.business.delete({ where: { id: business.id } }).catch(() => {})
  }

  console.log(`\nBooking concurrency: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

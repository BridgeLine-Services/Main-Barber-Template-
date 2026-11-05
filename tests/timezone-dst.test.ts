/**
 * Section: Timezone — the two days a year that break booking systems.
 *
 * America/Los_Angeles 2027: 14 March loses an hour at 02:00, 7 November repeats
 * 01:00-02:00. A barbershop that gets this wrong shows a slot that does not
 * exist, offers the same hour twice with the same label, or books someone an
 * hour late. This suite pins the day boundaries, the wall-clock conversions, the
 * two genuinely awkward local times, and the invariant that matters most: no two
 * slots on offer can share the same instant, because only one of them is real.
 *
 * Run: npx tsx tests/timezone-dst.test.ts
 */

import { prisma } from '../src/lib/prisma'
import { localTimeToUTCFromYMD, dayBoundsFromYMD, formatTimeInTimezone } from '../src/lib/timezone'
import { getAvailableSlots } from '../src/lib/availability'

const TZ = 'America/Los_Angeles'
let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}
const iso = (t: string, y: number, m: number, d: number) => new Date(localTimeToUTCFromYMD(t, y, m, d, TZ)).toISOString()

/** "1:00 AM" -> "01:00" so a wall-clock label can be turned into an instant. */
function to24h(label: string): string {
  const m = label.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!m) return label
  let h = parseInt(m[1], 10)
  const isPm = m[3].toUpperCase() === 'PM'
  if (isPm && h < 12) h += 12
  if (!isPm && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${m[2]}`
}
const hoursBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 3_600_000)

async function main() {
  console.log('\n📦 Day boundaries are 23 and 25 hours long')
  {
    const spring = dayBoundsFromYMD(TZ, 2027, 3, 14) as unknown as { start: Date; end: Date }
    const fall = dayBoundsFromYMD(TZ, 2027, 11, 7) as unknown as { start: Date; end: Date }
    assert(hoursBetween(new Date(spring.start), new Date(spring.end)) === 23, 'spring-forward day is 23 hours')
    assert(hoursBetween(new Date(fall.start), new Date(fall.end)) === 25, 'fall-back day is 25 hours')
  }

  console.log('\n📦 The same wall clock is an hour apart on either side of each change')
  {
    assert(iso('09:00', 2027, 3, 14) === '2027-03-14T16:00:00.000Z', '09:00 on spring-forward day is 16:00Z (PDT)')
    assert(iso('09:00', 2027, 11, 7) === '2027-11-07T17:00:00.000Z', '09:00 on fall-back day is 17:00Z (PST)')
    assert(iso('09:00', 2027, 3, 13) === '2027-03-13T17:00:00.000Z', '09:00 the day before is still 17:00Z (PST)')
    assert(iso('09:00', 2027, 11, 8) === '2027-11-08T17:00:00.000Z', '09:00 the day after is back to 17:00Z (PST)')
  }

  console.log('\n📦 The hour that does not exist, and the hour that happens twice')
  {
    // 02:30 never happens on 14 March. Normalising it forward is acceptable;
    // silently shifting it backwards (to 01:30) would book the previous hour.
    const skipped = iso('02:30', 2027, 3, 14)
    const at330 = iso('03:30', 2027, 3, 14)
    assert(skipped === at330, 'a non-existent 02:30 resolves to 03:30, never backwards to 01:30')
    assert(
      new Date(skipped) > new Date(iso('01:30', 2027, 3, 14)),
      'and it is later than 01:30, so it cannot silently book an earlier hour'
    )

    // 01:30 happens twice. Either occurrence is defensible; the label must not lie.
    const ambiguous = iso('01:30', 2027, 11, 7)
    assert(
      ambiguous === '2027-11-07T08:30:00.000Z' || ambiguous === '2027-11-07T09:30:00.000Z',
      'an ambiguous 01:30 resolves to one of its two real occurrences'
    )
    assert(
      formatTimeInTimezone(ambiguous, TZ) === '1:30 AM',
      'and still reads back as 1:30 AM in the shop'
    )
  }

  console.log('\n📦 Slots offered on both days are all real and all distinct')
  {
    const stamp = String(Date.now())
    const business = await prisma.business.create({
      data: {
        name: `DST Shop ${stamp}`, slug: `dst-shop-${stamp}`, email: `dst${stamp}@example.com`,
        phone: '555-0102', address: '1 Test St', city: 'TestCity', state: 'CA', zipCode: '90001',
        timezone: TZ, minAdvanceBookingMinutes: 0, bufferMinutes: 0, cancellationDeadlineHours: 0,
      },
    })
    const barber = await prisma.barber.create({ data: { name: 'DST Barber', businessId: business.id } })
    for (let day = 0; day < 7; day++) {
      await prisma.schedule.create({ data: { barberId: barber.id, dayOfWeek: day, startTime: '00:00', endTime: '23:45', isOff: false } })
    }
    const service = await prisma.service.create({ data: { businessId: business.id, name: 'DST Cut', duration: 60, price: 30, bufferMinutes: 0 } })

    for (const [label, m, d] of [['spring-forward', 3, 14], ['fall-back', 11, 7]] as const) {
      const dateStr = `2027-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const out: any = await getAvailableSlots({
        businessId: business.id, barberId: barber.id, serviceId: service.id,
        date: new Date(Date.UTC(2027, m - 1, d, 12, 0, 0)), dateStr,
      })
      const slots: Array<{ time: string; available: boolean }> = Array.isArray(out) ? out : out.slots
      assert(slots.length > 0, `${label}: slots are still generated (${slots.length})`)

      // Slots carry a wall-clock label only, so the instant is derived from it.
      // Two labels that resolve to one instant mean an offer that cannot be
      // booked; one label resolving to two instants is the ambiguous hour.
      const instants = slots.map((s) => new Date(localTimeToUTCFromYMD(to24h(s.time), 2027, m, d, TZ)).toISOString())
      const unique = new Set(instants)
      assert(
        unique.size === instants.length,
        `${label}: every offered slot is a distinct instant (${unique.size} of ${instants.length})`
      )
      const labels = slots.map((s) => s.time)
      const repeatedLabels = [...new Set(labels.filter((t, i) => labels.indexOf(t) !== i))]
      // A label offered twice is an offer the customer cannot act on: the
      // booking path resolves "1:00 AM" to one instant, so the other one is a
      // slot nobody can book. Neither day may repeat a label.
      assert(
        repeatedLabels.length === 0,
        `${label}: no slot label is offered twice${repeatedLabels.length ? ` (repeated: ${repeatedLabels.join(', ')})` : ''}`
      )
      if (label === 'fall-back') {
        assert(slots.length === 92, `fall-back: the repeated hour is offered once, not twice (${slots.length} slots)`)
        const offered = slots.filter((s: { time: string; available: boolean }) => /^1:\d{2} AM$/.test(s.time))
        assert(
          offered.every((s) => s.available !== undefined),
          'fall-back: the single 1 AM hour is still on offer, at the instant a booking resolves to'
        )
      }
    }
    await prisma.business.delete({ where: { id: business.id } }).catch(() => {})
  }

  console.log(`\nTimezone/DST: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

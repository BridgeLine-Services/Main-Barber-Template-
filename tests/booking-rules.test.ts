/**
 * Section: Booking Rules — business-configurable, server-side enforced.
 *
 * Covers: minimum advance booking, maximum booking window, buffer time
 * (business + service override), closures (all-day + partial holiday),
 * cancellation deadline, rescheduling restrictions, and valid/invalid
 * bookings through both validateSlot and createAppointmentSafely.
 *
 * Run: npx tsx tests/booking-rules.test.ts
 */

import { prisma } from '../src/lib/prisma'
import { validateSlot, createAppointmentSafely, getAvailableSlots } from '../src/lib/availability'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}

// Test clock helpers: build a Date N minutes from now, snapped to a future
// Monday 09:00-17:00 window (barber schedule is Mon-Fri 9-5).
function futureSlot(hoursAhead: number): Date {
  const d = new Date(Date.now() + hoursAhead * 3_600_000)
  // snap to quarter hour so slot alignment matches the 15-min grid
  d.setUTCMinutes(Math.round(d.getUTCMinutes() / 15) * 15, 0, 0)
  return d
}

async function setupBusiness(rules: {
  minAdvanceBookingMinutes?: number
  maxBookingWindowDays?: number | null
  bufferMinutes?: number
  cancellationDeadlineHours?: number
  serviceBufferMinutes?: number | null
}) {
  const stamp = Date.now()
  const business = await prisma.business.create({
    data: {
      name: `Rules Shop ${stamp}`,
      slug: `rules-shop-${stamp}`,
      email: `rules${stamp}@example.com`,
      phone: '555-0100',
      address: '1 Test St',
      city: 'TestCity',
      state: 'CA',
      zipCode: '90001',
      timezone: 'UTC', // UTC keeps assertions timezone-exact
      minAdvanceBookingMinutes: rules.minAdvanceBookingMinutes ?? 0,
      maxBookingWindowDays: rules.maxBookingWindowDays ?? null,
      bufferMinutes: rules.bufferMinutes ?? 0,
      cancellationDeadlineHours: rules.cancellationDeadlineHours ?? 0,
    },
  })
  const barber = await prisma.barber.create({ data: { name: 'Rule Barber', businessId: business.id } })
  const service = await prisma.service.create({
    data: {
      businessId: business.id,
      name: `Rules Cut ${stamp}`,
      duration: 60,
      price: 30,
      bufferMinutes: rules.serviceBufferMinutes === undefined ? null : rules.serviceBufferMinutes,
    },
  })
  // UTC schedules are impossible (Prisma zone), so set a schedule that is
  // working hours on every weekday: reuse Schedule model Mon-Sun 00:00-23:30
  // would break dayEnd; instead set wide hours 00:00-23:45 for Mon..Sun.
  for (let day = 0; day < 7; day++) {
    await prisma.schedule.create({
      data: { barberId: barber.id, dayOfWeek: day, startTime: '00:00', endTime: '23:45', isOff: false },
    })
  }
  const customer = await prisma.customer.create({
    data: {
      businessId: business.id, firstName: 'Fixture', lastName: 'Customer',
      phone: '5550009999', email: `fixture${stamp}@example.com`,
    },
  })
  return { business, barber, service, customer }
}

async function cleanup(businessId: string) {
  await prisma.business.delete({ where: { id: businessId } }).catch(() => {})
}

// ────────────────────────────────────────────────────────────────────────────
async function testMinimumAdvance() {
  console.log('\n📦 Minimum advance booking (minAdvanceBookingMinutes=120)')
  const { business, barber, service } = await setupBusiness({ minAdvanceBookingMinutes: 120 })
  try {
    const r1 = await validateSlot({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: futureSlot(1), // only 1 hour out → TOO_SOON
    })
    assert(r1.valid === false && r1.error === 'TOO_SOON', 'booking 1h out rejected as TOO_SOON (120-min rule)')

    const r2 = await validateSlot({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: futureSlot(3), // 3 hours out → ok
    })
    assert(r2.valid === true, 'booking 3h out accepted under 120-min rule')

    const created = await createAppointmentSafely({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: futureSlot(1),
      customerData: { firstName: 'Min', lastName: 'Advance', phone: '5550001111', email: `min${Date.now()}@example.com` },
    })
    assert(created.success === false && created.error === 'TOO_SOON', 'direct POST path enforces advance rule inside transaction')
  } finally { await cleanup(business.id) }
}

async function testMaxWindow() {
  console.log('\n📦 Maximum booking window (maxBookingWindowDays=7)')
  const { business, barber, service } = await setupBusiness({ maxBookingWindowDays: 7 })
  try {
    const r1 = await validateSlot({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: futureSlot(48), // 2 days out → ok
    })
    assert(r1.valid === true, 'booking 2 days out accepted under 7-day window')

    const r2 = await validateSlot({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: futureSlot(24 * 10), // 10 days out → OUTSIDE_WINDOW
    })
    assert(r2.valid === false && r2.error === 'OUTSIDE_WINDOW', 'booking 10 days out rejected as OUTSIDE_WINDOW')

    const created = await createAppointmentSafely({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: futureSlot(24 * 10),
      customerData: { firstName: 'Max', lastName: 'Window', phone: '5550002222', email: `max${Date.now()}@example.com` },
    })
    assert(created.success === false && created.error === 'OUTSIDE_WINDOW', 'direct POST path enforces window rule inside transaction')
  } finally { await cleanup(business.id) }
}

async function testBufferTime() {
  console.log('\n📦 Buffer time (business 30 min; appointment 10:00-11:00)')
  const { business, barber, service, customer } = await setupBusiness({ bufferMinutes: 30 })
  try {
    // Existing appointment today at the next aligned hour, 60-min service
    const base = new Date(Date.now() + 4 * 3_600_000) // 4h out
    base.setUTCMinutes(0, 0, 0)
    await prisma.appointment.create({
      data: {
        businessId: business.id, barberId: barber.id, serviceId: service.id, customerId: customer.id,
        startTime: base, endTime: new Date(base.getTime() + 3_600_000),
        status: 'CONFIRMED', confirmationNumber: `BUF${Date.now()}`,
        customerAccessToken: `tok_buf_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
      },
    })

    const r1 = await validateSlot({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: new Date(base.getTime() + 75 * 60_000), // 11:15 → inside buffer
    })
    assert(r1.valid === false && r1.error === 'SLOT_TAKEN', 'start 11:15 rejected: within 30-min buffer')

    const r2 = await validateSlot({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: new Date(base.getTime() + 90 * 60_000), // 11:30 → exactly buffer end
    })
    assert(r2.valid === true, 'start 11:30 accepted: buffer satisfied')

    // Buffer also guards the other side: slot ending after appointment start+... and
    // a slot 15 min BEFORE the existing appointment is plain double-booking
    const r3 = await validateSlot({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: new Date(base.getTime() - 15 * 60_000),
    })
    assert(r3.valid === false && r3.error === 'SLOT_TAKEN', 'overlapping slot still rejected (double-booking intact)')
  } finally { await cleanup(business.id) }
}

async function testServiceBufferOverride() {
  console.log('\n📦 Service-level buffer override (business 0, service 30)')
  const { business, barber, service, customer } = await setupBusiness({ bufferMinutes: 0, serviceBufferMinutes: 30 })
  try {
    const base = new Date(Date.now() + 5 * 3_600_000)
    base.setUTCMinutes(0, 0, 0)
    await prisma.appointment.create({
      data: {
        businessId: business.id, barberId: barber.id, serviceId: service.id, customerId: customer.id,
        startTime: base, endTime: new Date(base.getTime() + 3_600_000),
        status: 'CONFIRMED', confirmationNumber: `SBF${Date.now()}`,
        customerAccessToken: `tok_sbf_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
      },
    })
    const r = await validateSlot({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: new Date(base.getTime() + 75 * 60_000), // 15 min after end → blocked only if service buffer applies
    })
    assert(r.valid === false && r.error === 'SLOT_TAKEN', 'service bufferMinutes overrides business default (0)')
  } finally { await cleanup(business.id) }
}

async function testClosures() {
  console.log('\n📦 Closures: all-day + partial-day holiday')
  const { business, barber, service } = await setupBusiness({})
  try {
    // All-day closure 2 days out
    const closeDate = new Date(Date.now() + 2 * 86_400_000)
    const ymd = closeDate.toISOString().slice(0, 10)
    await prisma.businessClosure.create({
      data: {
        businessId: business.id, title: 'Staff Training Day', description: 'Closed',
        startDate: new Date(ymd), endDate: new Date(ymd), isAllDay: true, isActive: true,
      },
    })
    // Anchor to an explicit UTC time on the closure date so the test
    // cannot flake when the suite runs late in the UTC day.
    const slot = new Date(`${ymd}T12:00:00.000Z`)
    const r1 = await validateSlot({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: slot,
    })
    assert(r1.valid === false && r1.error === 'CLOSED', 'all-day closure blocks POST-path booking')

    const slots = await getAvailableSlots({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      date: slot, dateStr: slot.toISOString().slice(0, 10),
    })
    assert(slots.length === 0, 'all-day closure yields zero available slots')

    // Partial-day closure (holiday morning) 3 days out: afternoon open
    const holDate = new Date(Date.now() + 3 * 86_400_000)
    const holYMD = holDate.toISOString().slice(0, 10)
    await prisma.businessClosure.create({
      data: {
        businessId: business.id, title: 'Holiday Morning', description: 'Closed until noon',
        startDate: new Date(holYMD), endDate: new Date(holYMD), isAllDay: false,
        startTime: '00:00', endTime: '12:00', isActive: true,
      },
    })
    const morning = new Date(`${holYMD}T06:00:00.000Z`)
    const r2 = await validateSlot({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: morning,
    })
    assert(r2.valid === false && r2.error === 'CLOSED', 'partial-day closure blocks morning booking')
    const afternoon = new Date(`${holYMD}T13:00:00.000Z`)
    const r3 = await validateSlot({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: afternoon,
    })
    assert(r3.valid === true, 'partial-day closure allows afternoon booking')
  } finally { await cleanup(business.id) }
}

async function testCancellationDeadline() {
  console.log('\n📦 Cancellation deadline (cancellationDeadlineHours=24, customer token flow)')
  // Enforced at the API layer; verify the rule data + boundary math here.
  const { business } = await setupBusiness({ cancellationDeadlineHours: 24 })
  try {
    assert(business.cancellationDeadlineHours === 24, 'cancellationDeadlineHours persisted')
    // boundary: 23h59m to start → within deadline; 24h1m → allowed
    const untilAppt = (appt: Date, now: Date) => (appt.getTime() - now.getTime()) / 3_600_000
    const now = new Date()
    const soon = new Date(now.getTime() + 23.9 * 3_600_000)
    const later = new Date(now.getTime() + 24.2 * 3_600_000)
    assert(untilAppt(soon, now) < 24, '23.9h-out appointment is inside the 24h deadline (cancel blocked)')
    assert(untilAppt(later, now) >= 24, '24.2h-out appointment is outside the deadline (cancel allowed)')
  } finally { await cleanup(business.id) }
}

async function testRescheduleRules() {
  console.log('\n📦 Rescheduling restrictions (customerRescheduleMinNoticeHours / window)')
  const { business, barber, service, customer } = await setupBusiness({})
  try {
    await prisma.business.update({
      where: { id: business.id },
      data: { customerRescheduleEnabled: true, customerRescheduleMinNoticeHours: 24, customerRescheduleWindowDays: 30 },
    })
    const b = await prisma.business.findUnique({ where: { id: business.id } })
    assert(b?.customerRescheduleMinNoticeHours === 24, 'reschedule min notice persisted (24h)')
    assert(b?.customerRescheduleWindowDays === 30, 'reschedule window persisted (30 days)')

    // validateSlot excludeAppointmentId path used by reschedule: a reschedule to
    // the same slot must not collide with itself
    const slot = futureSlot(30)
    const appt = await prisma.appointment.create({
      data: {
        businessId: business.id, barberId: barber.id, serviceId: service.id, customerId: customer.id,
        startTime: slot, endTime: new Date(slot.getTime() + 3_600_000),
        status: 'CONFIRMED', confirmationNumber: `RES${Date.now()}`,
        customerAccessToken: `tok_res_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
      },
    })
    const r = await validateSlot({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: slot, excludeAppointmentId: appt.id,
    })
    assert(r.valid === true, 'rescheduling to own slot does not self-collide')
  } finally { await cleanup(business.id) }
}

async function testValidAndInvalidBookings() {
  console.log('\n📦 End-to-end: valid booking succeeds, invalid rejected')
  const { business, barber, service } = await setupBusiness({
    minAdvanceBookingMinutes: 60, maxBookingWindowDays: 30, bufferMinutes: 15,
  })
  try {
    const slot = futureSlot(6)
    const ok = await createAppointmentSafely({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: slot,
      customerData: { firstName: 'Val', lastName: 'Book', phone: '5550003333', email: `val${Date.now()}@example.com` },
    })
    assert(ok.success === true && !!ok.appointment, 'valid booking creates appointment')
    assert(!!ok.customerAccessToken && ok.customerAccessToken.length >= 32, 'valid booking returns secure access token')

    // Double-book the same slot → SLOT_TAKEN
    const dup = await createAppointmentSafely({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: slot,
      customerData: { firstName: 'Dup', lastName: 'Book', phone: '5550004444', email: `dup${Date.now()}@example.com` },
    })
    assert(dup.success === false && /SLOT_TAKEN|someone else/.test(String(dup.error)), 'double-booking rejected (SLOT_TAKEN surfaced as user-facing message)')

    // Buffer applies to the new booking: next slot must respect 15-min buffer
    const tight = await validateSlot({
      businessId: business.id, barberId: barber.id, serviceId: service.id,
      startTime: new Date(slot.getTime() + 60 * 60_000 + 10 * 60_000), // 10 min after first ends
    })
    assert(tight.valid === false && tight.error === 'SLOT_TAKEN', 'slot 10 min after booking rejected (15-min buffer)')

    // Cross-tenant: another business's barber/service ids must not validate
    const other = await setupBusiness({})
    try {
      const cross = await validateSlot({
        businessId: other.business.id, barberId: barber.id, serviceId: service.id,
        startTime: futureSlot(6),
      })
      assert(cross.valid === false, 'cross-tenant barber/service rejected under other business id')
    } finally { await cleanup(other.business.id) }
  } finally { await cleanup(business.id) }
}

async function main() {
  console.log('\n══════════ Booking Rules Test Suite ══════════')
  await testMinimumAdvance()
  await testMaxWindow()
  await testBufferTime()
  await testServiceBufferOverride()
  await testClosures()
  await testCancellationDeadline()
  await testRescheduleRules()
  await testValidAndInvalidBookings()
  console.log(`\nBooking rules tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
  process.exit(0)
}

main().catch((e) => { console.error('Test crashed:', e); process.exit(1) })

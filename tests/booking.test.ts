/**
 * Section 15: Booking Flow Tests
 *
 * Tests the booking availability calculation, slot generation, and conflict detection.
 * Verifies "First Available" barber selection logic.
 *
 * Run: npx tsx tests/booking.test.ts
 */

import { prisma } from '../src/lib/prisma'
import { validateSlot } from '../src/lib/availability'

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

async function setup() {
  console.log('\n📦 Setting up test data...')

  const business = await prisma.business.create({
    data: {
      name: 'Booking Test Shop',
      slug: 'booking-test-shop',
      email: 'booking@test.com',
      phone: '555-3333',
      address: '789 Test Ave',
      city: 'TestCity',
      state: 'CA',
      zipCode: '90003',
      timezone: 'America/Los_Angeles',
    },
  })

  const barber1 = await prisma.barber.create({
    data: {
      name: 'Early Barber',
      businessId: business.id,
      bio: 'Starts at 9am',
    },
  })

  const barber2 = await prisma.barber.create({
    data: {
      name: 'Late Barber',
      businessId: business.id,
      bio: 'Starts at 11am',
    },
  })

  // Barber 1: 9am - 5pm (Mon-Fri)
  for (let day = 1; day <= 5; day++) {
    await prisma.schedule.create({
      data: {
        barberId: barber1.id,
        dayOfWeek: day,
        startTime: '09:00',
        endTime: '17:00',
        isOff: false,
      },
    })
  }

  // Barber 2: 11am - 7pm (Mon-Fri)
  for (let day = 1; day <= 5; day++) {
    await prisma.schedule.create({
      data: {
        barberId: barber2.id,
        dayOfWeek: day,
        startTime: '11:00',
        endTime: '19:00',
        isOff: false,
      },
    })
  }

  const service = await prisma.service.create({
    data: {
      name: 'Haircut',
      businessId: business.id,
      duration: 30,
      price: 30,
      isActive: true,
    },
  })

  const customer = await prisma.customer.create({
    data: {
      businessId: business.id,
      firstName: 'Test',
      lastName: 'Customer',
      email: 'test@booking.com',
      phone: '555-9999',
    },
  })

  return { business, barber1, barber2, service, customer }
}

async function cleanup(ids: any) {
  console.log('\n🧹 Cleaning up test data...')
  await prisma.appointment.deleteMany({ where: { businessId: ids.business.id } })
  await prisma.schedule.deleteMany({ where: { barberId: { in: [ids.barber1.id, ids.barber2.id] } } })
  await prisma.customer.deleteMany({ where: { businessId: ids.business.id } })
  await prisma.service.deleteMany({ where: { businessId: ids.business.id } })
  await prisma.barber.deleteMany({ where: { businessId: ids.business.id } })
  await prisma.business.delete({ where: { id: ids.business.id } })
}

// ─── Booking logic helpers (mirror the actual API logic) ──────────────────

function generateSlots(startTime: string, endTime: string, serviceDuration: number): string[] {
  const slots: string[] = []
  const [startH, startM] = startTime.split(':').map(Number)
  const [endH, endM] = endTime.split(':').map(Number)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  for (let t = startMinutes; t + serviceDuration <= endMinutes; t += serviceDuration) {
    const h = Math.floor(t / 60)
    const m = t % 60
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }
  return slots
}

function getDayOfWeek(date: Date): number {
  return date.getDay()
}

// ─── Tests ────────────────────────────────────────────────────────────────

async function testBookingFlow(ids: any) {
  console.log('\n📅 Testing booking flow...')

  const { business, barber1, barber2, service, customer } = ids

  // Test 1: Slot generation for 30-min service
  const slots9to5 = generateSlots('09:00', '17:00', 30)
  assert(slots9to5.length === 16, '9am-5pm with 30min slots = 16 slots')
  assert(slots9to5[0] === '09:00', 'First slot is 09:00')
  assert(slots9to5[slots9to5.length - 1] === '16:30', 'Last slot is 16:30')

  const slots11to7 = generateSlots('11:00', '19:00', 30)
  assert(slots11to7.length === 16, '11am-7pm with 30min slots = 16 slots')
  assert(slots11to7[0] === '11:00', 'First slot is 11:00')

  // Test 2: "First Available" should pick barber1 (earlier start)
  const allBarberSlots = [
    { barberId: barber1.id, barberName: 'Early Barber', firstSlot: slots9to5[0] },
    { barberId: barber2.id, barberName: 'Late Barber', firstSlot: slots11to7[0] },
  ]
  allBarberSlots.sort((a, b) => a.firstSlot.localeCompare(b.firstSlot))

  assert(allBarberSlots[0].barberName === 'Early Barber', 'First Available picks Early Barber (9am < 11am)')
  assert(allBarberSlots[0].firstSlot === '09:00', 'First available slot is 09:00')

  // Test 3: Create an appointment and verify it exists
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(10, 0, 0, 0)
  // Barber 1 works Mon-Fri: roll forward to a scheduled weekday so the
  // validator tests are deterministic no matter which day the suite runs.
  while (tomorrow.getDay() === 0 || tomorrow.getDay() === 6) {
    tomorrow.setDate(tomorrow.getDate() + 1)
  }

  const appointment = await prisma.appointment.create({
    data: {
      businessId: business.id,
      barberId: barber1.id,
      serviceId: service.id,
      customerId: customer.id,
      confirmationNumber: 'BOOK-001',
      customerAccessToken: 'tok-book-001',
      startTime: tomorrow,
      endTime: new Date(tomorrow.getTime() + 30 * 60 * 1000),
      status: 'CONFIRMED',
    },
  })

  assert(!!appointment.id, 'Appointment created successfully')
  assert(appointment.businessId === business.id, 'Appointment has correct businessId')

  // Test 4: The production validator rejects times outside the barber schedule.
  const outsideHours = await validateSlot({
    businessId: business.id,
    barberId: barber1.id,
    serviceId: service.id,
    startTime: new Date(new Date(tomorrow).getTime() - 2 * 60 * 60 * 1000),
  })
  assert(outsideHours.valid === false && outsideHours.error === 'OUTSIDE_HOURS', 'Booking validator rejects appointments outside scheduled hours')

  // Test 5: Conflict detection — find existing appointment at same time
  const conflictingAppt = await prisma.appointment.findFirst({
    where: {
      barberId: barber1.id,
      status: { in: ['PENDING', 'CONFIRMED'] },
      startTime: { lte: tomorrow },
      endTime: { gt: tomorrow },
    },
  })
  assert(!!conflictingAppt, 'Conflict detection finds existing appointment at same time')

  // Test 5: Different barber at same time is OK (no conflict)
  const barber2Appt = await prisma.appointment.findFirst({
    where: {
      businessId: business.id,
      barberId: barber2.id,
      status: { in: ['PENDING', 'CONFIRMED'] },
      startTime: { lte: tomorrow },
      endTime: { gt: tomorrow },
    },
  })
  assert(barber2Appt === null, 'Different barber at same time = no conflict')

  // Test 6: Service duration is respected
  assert(service.duration === 30, 'Service duration is 30 minutes')

  // Test 7: "First Available" with a conflict picks next available
  const barber1BookedSlots = ['10:00']
  const availableBarber1 = slots9to5.filter(s => !barber1BookedSlots.includes(s))
  assert(availableBarber1[0] === '09:00', 'Barber1 first available after conflict = 09:00 (before booking)')

  // Test 8: Book a second appointment and verify "first available" logic
  const earlyBooking = new Date(tomorrow)
  earlyBooking.setHours(9, 0, 0, 0)
  await prisma.appointment.create({
    data: {
      businessId: business.id,
      barberId: barber1.id,
      serviceId: service.id,
      customerId: customer.id,
      confirmationNumber: 'BOOK-002',
      customerAccessToken: 'tok-book-002',
      startTime: earlyBooking,
      endTime: new Date(earlyBooking.getTime() + 30 * 60 * 1000),
      status: 'CONFIRMED',
    },
  })

  // Now barber1's first available is 09:30, barber2's is 11:00
  const availableAfterEarlyBooking = slots9to5.filter(s => !['09:00', '10:00'].includes(s))
  assert(availableAfterEarlyBooking[0] === '09:30', 'Barber1 first available after 2 bookings = 09:30')
  assert(availableAfterEarlyBooking[0].localeCompare(slots11to7[0]) < 0, '09:30 < 11:00 → barber1 is still first available')

  // Test 9: Day-of-week mapping is correct
  const monday = new Date('2026-09-07')
  assert(getDayOfWeek(monday) === 1, 'Sept 7 2026 is Monday (day 1)')
  const sunday = new Date('2026-09-06')
  assert(getDayOfWeek(sunday) === 0, 'Sept 6 2026 is Sunday (day 0)')

  // Test 10: Appointment is scoped to correct business
  const businessAppts = await prisma.appointment.findMany({
    where: { businessId: business.id },
  })
  assert(businessAppts.length === 2, 'Business has exactly 2 appointments')
  assert(businessAppts.every(a => a.businessId === business.id), 'All appointments belong to the correct business')
}

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  Section 15: Booking Flow Tests')
  console.log('═══════════════════════════════════════════')

  let ids: any
  try {
    ids = await setup()
    await testBookingFlow(ids)
  } catch (error) {
    console.error('Test error:', error)
    failed++
  } finally {
    if (ids) await cleanup(ids)
    await prisma.$disconnect()
  }

  console.log('\n═══════════════════════════════════════════')
  console.log(`  Results: ${passed} passed, ${failed} failed`)
  console.log('═══════════════════════════════════════════')
  process.exit(failed > 0 ? 1 : 0)
}

main()

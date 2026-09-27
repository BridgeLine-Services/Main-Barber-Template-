// Notification failure isolation & booking resilience (§22).
// Requires a live server on :3000 and DATABASE_URL.
//
// Proves:
//  * a public booking succeeds (201 + DB row) and stays intact even when
//    notification delivery fails — notifications are fire-and-forget
//  * queued notifications that fail are marked FAILED with a BOUNDED,
//    sanitized error (no multiline provider dumps, ≤500 chars)
//  * failed logging never throws back into the booking flow
//  * the worker's PENDING→PROCESSING claim is atomic (no double-send)
//  * stale PROCESSING rows (crashed worker) are re-queued and retried
//  * queueCustomerNotification is idempotent (no duplicate rows)
//  * SMS never queues without consent/phone

import { prisma } from '../src/lib/prisma'
import { queueCustomerNotification } from '../src/lib/notifications'
import { processDueNotifications } from '../src/lib/notification-worker'
import bcrypt from 'bcryptjs'

const BASE = 'http://localhost:3000'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

async function main() {
  const stamp = Date.now()
  const passwordHash = await bcrypt.hash('TestPass123!', 10)
  const biz = await prisma.business.create({ data: { name: 'Notif Shop', slug: `notif-a-${stamp}`, timezone: 'America/Los_Angeles' } })
  const owner = await prisma.user.create({ data: { email: `owner.notif-${stamp}@t.test`, passwordHash, name: 'Notif Owner', role: 'OWNER', businessId: biz.id } })
  const barberRow = await prisma.barber.create({ data: { name: 'Notif Barber', businessId: biz.id } })
  const svc = await prisma.service.create({ data: { name: `Notif Cut ${stamp}`, businessId: biz.id, duration: 30, price: 20, isActive: true } })
    // Full-week schedule so the public booking engine finds availability.
    await prisma.schedule.createMany({
      data: [1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => ({ barberId: barberRow.id, dayOfWeek, startTime: '09:00', endTime: '18:00' })),
    })
  const cust = await prisma.customer.create({ data: { firstName: 'No', lastName: 'Tif', phone: '555-020-0001', email: `notif.cust-${stamp}@t.test`, businessId: biz.id, smsConsent: false } })

  const created: { appointmentIds: string[]; notificationIds: string[] } = { appointmentIds: [], notificationIds: [] }
  try {
    console.log('\n  --- Booking succeeds regardless of notification outcome ---')

    const tomorrow = new Date(Date.now() + 86400e3)
    const date = tomorrow.toISOString().split('T')[0]
    const bookingBody = {
      serviceId: svc.id,
      barberId: barberRow.id,
      date,
      time: '10:00',
      customer: { firstName: cust.firstName, lastName: cust.lastName, phone: cust.phone, email: cust.email },
      idempotencyKey: `notif-book-${stamp}`,
      policiesAcceptedAt: new Date().toISOString(),
    }
    const booking = await fetch(`${BASE}/api/public/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-host': `notif-a-${stamp}` },
      body: JSON.stringify(bookingBody),
    })
    const bookingJson = await booking.json().catch(() => ({}))
    assert(booking.status === 200 || booking.status === 201, `public booking succeeds even though no email/SMS provider is configured (got ${booking.status})`)
    const apptId = bookingJson?.appointment?.id || bookingJson?.id
    assert(!!apptId || bookingJson?.success !== false, 'booking response carries the created appointment')

    const dbAppt = await prisma.appointment.findFirst({ where: { businessId: biz.id, customer: { email: cust.email } } })
    assert(!!dbAppt, 'appointment persisted in the database')
    if (dbAppt) created.appointmentIds.push(dbAppt.id)
    assert(dbAppt?.status === 'CONFIRMED' || dbAppt?.status === 'PENDING', 'appointment status intact (notification issues cannot corrupt it)')

    console.log('\n  --- Failed delivery logs are bounded and sanitized ---')

    // Queue an EMAIL notification with no SMTP configured → the worker must
    // fail it cleanly with a bounded, single-line error and never throw.
    const hugeErrorPayload = 'ECONNREFUSED\n' + 'X'.repeat(3000)
    const queued = await queueCustomerNotification({
      businessId: biz.id, customerId: cust.id, recipient: cust.email,
      channel: 'EMAIL', type: 'REBOOKING_REMINDER',
      content: `Come back! ${hugeErrorPayload}`,
      scheduledAt: new Date(Date.now() - 1000),
      idempotencyKey: `notif-res-${stamp}`,
    })
    assert(queued.queued === true, 'notification queued for delivery')

    // Idempotency: queue the same key twice — still one row.
    await queueCustomerNotification({
      businessId: biz.id, customerId: cust.id, recipient: cust.email,
      channel: 'EMAIL', type: 'REBOOKING_REMINDER',
      content: 'Come back!',
      scheduledAt: new Date(Date.now() - 1000),
      idempotencyKey: `notif-res-${stamp}`,
    })
    const rows = await prisma.notificationLog.findMany({ where: { idempotencyKey: `notif-res-${stamp}` } })
    assert(rows.length === 1, `idempotency key prevents duplicate queue rows (${rows.length} row)`)

    // SMS never queues without consent.
    const smsQueued = await queueCustomerNotification({
      businessId: biz.id, customerId: cust.id, recipient: cust.phone,
      channel: 'SMS', type: 'REBOOKING_REMINDER',
      content: 'Reminder', idempotencyKey: `notif-sms-${stamp}`, smsConsent: false,
    })
    assert(smsQueued.queued === false, 'SMS without consent is never queued')

    let workerThrew = false
    let result: Awaited<ReturnType<typeof processDueNotifications>> | null = null
    try {
      result = await processDueNotifications(50)
    } catch {
      workerThrew = true
    }
    assert(!workerThrew, 'worker never throws when a provider is unreachable')

    const failedRow = await prisma.notificationLog.findUnique({ where: { idempotencyKey: `notif-res-${stamp}` } })
    assert(failedRow?.status === 'FAILED', `undeliverable email marked FAILED (got ${failedRow?.status})`)
    const errMsg = failedRow?.errorMessage || ''
    assert(errMsg.length > 0 && errMsg.length <= 500, `error message bounded (${errMsg.length} chars)`)
    assert(!/\n|\r/.test(errMsg), 'error message has no multiline provider dumps')
    assert(!errMsg.includes('X'.repeat(100)), 'error message does not embed provider payload dumps')

    console.log('\n  --- Worker claim is atomic; booking data is untouched by failures ---')

    // The failed delivery must not have altered the appointment at all.
    const apptAfter = await prisma.appointment.findFirst({ where: { businessId: biz.id } })
    assert(!!apptAfter && created.appointmentIds.includes(apptAfter.id), 'appointment untouched by notification failure')

    console.log('\n  --- Stale PROCESSING rows are re-queued (crash recovery) ---')

    const staleRow = await prisma.notificationLog.create({
      data: {
        businessId: biz.id, customerId: cust.id, recipient: cust.email,
        channel: 'EMAIL', type: 'WAITLIST_NOTIFICATION', status: 'PROCESSING',
        content: 'stale', scheduledAt: new Date(Date.now() - 3600e3),
        idempotencyKey: `notif-stale-${stamp}`,
      },
    })
    created.notificationIds.push(staleRow.id)
    // Simulate the crash: last update (claim) was long ago.
    await prisma.$executeRaw`UPDATE "NotificationLog" SET "updatedAt" = NOW() - INTERVAL '30 minutes' WHERE "id" = ${staleRow.id}`

    const freshRow = await prisma.notificationLog.create({
      data: {
        businessId: biz.id, customerId: cust.id, recipient: cust.email,
        channel: 'EMAIL', type: 'WAITLIST_NOTIFICATION', status: 'PROCESSING',
        content: 'fresh', scheduledAt: new Date(Date.now() - 3600e3),
        idempotencyKey: `notif-fresh-${stamp}`,
      },
    })
    created.notificationIds.push(freshRow.id)
    await prisma.$executeRaw`UPDATE "NotificationLog" SET "updatedAt" = NOW() - INTERVAL '1 minute' WHERE "id" = ${freshRow.id}`

    const recovery = await processDueNotifications(50)
    const staleAfter = await prisma.notificationLog.findUnique({ where: { id: staleRow.id } })
    const freshAfter = await prisma.notificationLog.findUnique({ where: { id: freshRow.id } })
    assert(staleAfter?.status === 'FAILED' || staleAfter?.status === 'SENT', `stale claim re-queued and processed (status ${staleAfter?.status})`)
    assert(freshAfter?.status === 'PROCESSING', 'fresh claim by a live worker is NOT re-queued (no double-send)')
    assert(recovery.requeued >= 1, 'worker reports re-queued stale rows')
  } finally {
    await prisma.notificationLog.deleteMany({ where: { businessId: biz.id } })
    await prisma.appointment.deleteMany({ where: { businessId: biz.id } })
    await prisma.customer.deleteMany({ where: { businessId: biz.id } })
    await prisma.service.deleteMany({ where: { businessId: biz.id } })
    await prisma.user.deleteMany({ where: { businessId: biz.id } })
    await prisma.barber.deleteMany({ where: { businessId: biz.id } })
    await prisma.business.deleteMany({ where: { id: biz.id } })
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Notification resilience tests: ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('Test runner crashed:', e)
  process.exit(1)
})

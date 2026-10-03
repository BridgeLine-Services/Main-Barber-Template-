// End-to-end guest booking journey (§6 of the booking product requirements):
// an anonymous visitor books, then manages the appointment purely through
// the confirmation link — no account required.
//
// Requires a live server on :3000 and DATABASE_URL. Run: npm run test:guest-journey
//
// Proves:
//  * anonymous booking via the public API succeeds and returns both the
//    confirmation number and the customer access token
//  * the confirmation page WITHOUT a token shows only limited info
//    (management controls never render, so a shared/stripped link is safe)
//  * the confirmation page WITH the token shows full management controls
//  * a wrong/foreign token still shows only limited info (no detail leak)
//  * cancel via the token endpoint flips the appointment to CANCELLED
//  * reschedule via the token endpoint moves the time and records history
//  * the token is the authorization: a token only ever touches ITS booking

import { prisma } from '../src/lib/prisma'
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
  const biz = await prisma.business.create({ data: { name: 'Guest Journey Shop', slug: `guest-journey-${stamp}`, timezone: 'America/Los_Angeles' } })
  await prisma.user.create({ data: { email: `owner.guest-${stamp}@t.test`, passwordHash, name: 'Guest Owner', role: 'OWNER', businessId: biz.id } })
  const barberRow = await prisma.barber.create({ data: { name: 'Journey Barber', businessId: biz.id } })
  const svc = await prisma.service.create({ data: { name: `Journey Cut ${stamp}`, businessId: biz.id, duration: 30, price: 25, isActive: true } })
  // Full-week schedule so the public booking engine finds availability.
  await prisma.schedule.createMany({
    data: [1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => ({ barberId: barberRow.id, dayOfWeek, startTime: '09:00', endTime: '18:00' })),
  })

  // A future weekday for deterministic booking
  const day = new Date(Date.now() + 3 * 86400e3)
  while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1)
  const date = day.toISOString().split('T')[0]

  const guest = { firstName: 'Guest', lastName: 'Visitor', phone: '555-030-0001', email: `guest.journey-${stamp}@t.test` }
  const createdIds: string[] = []

  try {
    console.log('\n── Anonymous guest books without an account ──')
    const bookRes = await fetch(`${BASE}/api/public/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-host': biz.slug },
      body: JSON.stringify({
        serviceId: svc.id, barberId: barberRow.id, date, time: '10:00',
        customer: guest, policiesAcceptedAt: new Date().toISOString(),
      }),
    })
    const booking = await bookRes.json().catch(() => ({}))
    assert(bookRes.status === 200 && booking?.success === true, `anonymous booking succeeds (got ${bookRes.status})`)
    assert(typeof booking?.confirmationNumber === 'string' && booking.confirmationNumber.length > 0, 'response carries the confirmation number')
    assert(typeof booking?.customerAccessToken === 'string' && booking.customerAccessToken.length >= 32, 'response carries a long customer access token')

    const dbAppt = await prisma.appointment.findFirst({
      where: { businessId: biz.id, customer: { email: guest.email } },
      include: { customer: true },
    })
    assert(!!dbAppt, 'appointment persisted in the database')
    if (dbAppt) createdIds.push(dbAppt.id)
    assert(dbAppt?.confirmationNumber === booking?.confirmationNumber, 'confirmation number matches the database')
    assert(dbAppt?.customerAccessToken === booking?.customerAccessToken, 'token matches the database (the emailed link uses it)')
    assert(dbAppt?.status === 'CONFIRMED', 'guest booking starts CONFIRMED')
    assert(dbAppt?.customer?.email === guest.email, 'guest customer record created from booking info only')

    console.log('\n── Confirmation link without a token: limited info only ──')
    const noTokenPage = await fetch(`${BASE}/appointment/${booking.confirmationNumber}`, {
      headers: { 'x-forwarded-host': biz.slug },
    })
    const noTokenHtml = await noTokenPage.text()
    assert(noTokenPage.status === 200, `confirmation page renders without token (got ${noTokenPage.status})`)
    assert(noTokenHtml.includes('Appointment Found'), 'limited-info page shows the found state')
    assert(!noTokenHtml.includes('Cancel Appointment'), 'cancel control never renders without the token')
    assert(!noTokenHtml.includes(guest.phone), 'guest contact details never leak without the token')

    console.log('\n── Confirmation link with a wrong token: still limited ──')
    const wrongTokenPage = await fetch(`${BASE}/appointment/${booking.confirmationNumber}?token=${'x'.repeat(40)}`, {
      headers: { 'x-forwarded-host': biz.slug },
    })
    const wrongHtml = await wrongTokenPage.text()
    assert(!wrongHtml.includes('Cancel Appointment'), 'wrong token shows no management controls')
    assert(!wrongHtml.includes(guest.phone), 'wrong token leaks no contact details')

    console.log('\n── Confirmation link with the real token: full management ──')
    const tokenPage = await fetch(`${BASE}/appointment/${booking.confirmationNumber}?token=${booking.customerAccessToken}`, {
      headers: { 'x-forwarded-host': biz.slug },
    })
    const tokenHtml = await tokenPage.text()
    assert(tokenPage.status === 200, `token page renders (got ${tokenPage.status})`)
    assert(tokenHtml.includes('Cancel Appointment'), 'cancel control renders with the valid token')
    assert(tokenHtml.includes(svc.name), 'page shows the booked service from real data')

    console.log('\n── Guest cancels through the token endpoint (as the page button does) ──')
    const cancelRes = await fetch(`${BASE}/api/public/appointments/${booking.customerAccessToken}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-host': biz.slug },
      body: JSON.stringify({ reason: 'Guest journey test cancel' }),
    })
    assert(cancelRes.status === 200, `token cancel succeeds (got ${cancelRes.status})`)
    const afterCancel = dbAppt ? await prisma.appointment.findUnique({ where: { id: dbAppt.id } }) : null
    assert(afterCancel?.status === 'CANCELLED', 'appointment is CANCELLED after the token cancel')

    console.log('\n── Guest books again and reschedules through the token endpoint ──')
    const book2Res = await fetch(`${BASE}/api/public/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-host': biz.slug },
      body: JSON.stringify({
        serviceId: svc.id, barberId: barberRow.id, date, time: '11:00',
        customer: guest, policiesAcceptedAt: new Date().toISOString(),
      }),
    })
    const booking2 = await book2Res.json().catch(() => ({}))
    assert(book2Res.status === 200 && booking2?.success === true, `second anonymous booking succeeds (got ${book2Res.status})`)
    const appt2 = await prisma.appointment.findFirst({
      where: { businessId: biz.id, status: 'CONFIRMED' },
      orderBy: { createdAt: 'desc' },
    })
    assert(!!appt2 && appt2.confirmationNumber === booking2?.confirmationNumber, 'second appointment resolves by confirmation number')
    if (appt2) createdIds.push(appt2.id)

    // The page's reschedule flow uses the short-token endpoint. The schema
    // requires a strict UTC ISO instant (z.string().datetime()); 20:00Z is
    // inside the 09:00-18:00 Pacific schedule in both PDT and PST.
    const rescheduleRes = await fetch(`${BASE}/api/public/appointments/${booking2.customerAccessToken}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-host': biz.slug },
      body: JSON.stringify({ startTime: `${date}T20:00:00.000Z` }),
    })
    assert(rescheduleRes.status === 200, `token reschedule succeeds (got ${rescheduleRes.status}, body ${await rescheduleRes.text().catch(() => '')})`)
    const afterReschedule = appt2 ? await prisma.appointment.findUnique({ where: { id: appt2.id } }) : null
    assert(afterReschedule?.status === 'CONFIRMED', 'appointment stays CONFIRMED after rescheduling')
    const rh = appt2 ? await prisma.rescheduleHistory.findFirst({ where: { appointmentId: appt2.id }, orderBy: { createdAt: 'desc' } }) : null
    assert(!!rh && rh.actor === 'CUSTOMER', 'reschedule recorded with actor CUSTOMER')
    assert(afterReschedule?.startTime.toISOString() === `${date}T20:00:00.000Z`, `appointment moved to the requested slot (got ${afterReschedule?.startTime.toISOString()})`)

    console.log('\n── Token capability isolation: one token cannot touch another booking ──')
    // The access token IS the authorization (documented contract), so the
    // isolation property is token-scoped, not host-scoped: cancelling with
    // one guest's token must leave every other booking untouched.
    const otherGuest = { firstName: 'Other', lastName: 'Guest', phone: '555-030-0002', email: `guest.other-${stamp}@t.test` }
    const book3Res = await fetch(`${BASE}/api/public/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-host': biz.slug },
      body: JSON.stringify({
        serviceId: svc.id, barberId: barberRow.id, date, time: '15:00',
        customer: otherGuest, policiesAcceptedAt: new Date().toISOString(),
      }),
    })
    const booking3 = await book3Res.json().catch(() => ({}))
    assert(book3Res.status === 200 && booking3?.success === true, `third guest books (got ${book3Res.status})`)
    const appt3 = await prisma.appointment.findFirst({
      where: { businessId: biz.id, customer: { email: otherGuest.email }, status: 'CONFIRMED' },
    })
    assert(!!appt3 && appt3.confirmationNumber === booking3?.confirmationNumber, 'third booking resolves')
    if (appt3) createdIds.push(appt3.id)
    // Malformed token length is rejected outright
    const shortTok = await fetch(`${BASE}/api/public/appointments/${'x'.repeat(20)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-host': biz.slug },
      body: JSON.stringify({ reason: 'bad token' }),
    })
    assert(shortTok.status === 400, `undersized token rejected (got ${shortTok.status})`)
    // Guest 2's token cancels guest 2's booking only
    const cancel3 = await fetch(`${BASE}/api/public/appointments/${booking3.customerAccessToken}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-host': biz.slug },
      body: JSON.stringify({ reason: 'third guest cancels own booking' }),
    })
    assert(cancel3.status === 200, `third guest cancels own booking (got ${cancel3.status})`)
    const after3 = appt3 ? await prisma.appointment.findUnique({ where: { id: appt3.id } }) : null
    assert(after3?.status === 'CANCELLED', "third guest's booking is CANCELLED")
    const appt2After = appt2 ? await prisma.appointment.findUnique({ where: { id: appt2.id } }) : null
    assert(appt2After?.status === 'CONFIRMED', "other guests' bookings untouched by a different token")

    console.log('\n── Idempotent second cancel is rejected, not duplicated ──')
    const doubleCancel = await fetch(`${BASE}/api/public/appointments/${booking.customerAccessToken}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-host': biz.slug },
      body: JSON.stringify({ reason: 'already cancelled' }),
    })
    assert(doubleCancel.status >= 400, `cancelling an already-cancelled booking is rejected (got ${doubleCancel.status})`)
  } finally {
    // cleanup: cascade removes schedule/barber/service rows with the business
    try {
      if (createdIds.length) await prisma.appointment.deleteMany({ where: { id: { in: createdIds } } })
      await prisma.customer.deleteMany({ where: { businessId: biz.id } })
      await prisma.business.delete({ where: { id: biz.id } })
    } catch (e) {
      console.error('cleanup error (non-fatal):', e instanceof Error ? e.message : e)
    }
    await prisma.$disconnect()
  }

  console.log('\n═════════════════════════════════════════')
  console.log(`  Guest journey tests: ${passed} passed, ${failed} failed`)
  console.log('═════════════════════════════════════════')
  process.exit(failed > 0 ? 1 : 0)
}

main()

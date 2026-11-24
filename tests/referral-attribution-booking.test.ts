/**
 * Referral attribution on a real booking (referral attribution, part B).
 *
 * The promise being tested is narrow and important: a shop that runs a referral programme
 * gets one attribution per customer, for the first visit, from a code that belongs to this
 * shop; and a shop that does not run one sees no change at all. A bad code never costs a
 * booking.
 *
 * Run: npx tsx tests/referral-attribution-booking.test.ts
 */

import { prisma } from '../src/lib/prisma'
import { createAppointmentSafely } from '../src/lib/availability'
import { localTimeToUTCFromYMD } from '../src/lib/timezone'
import { resolveReferralForBooking } from '../src/lib/growth/referral-booking'
import { buildReferralCode } from '../src/lib/growth/referrals'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.log(`  ❌ ${message}`); failed++ }
}

const RUN = Date.now()
const slug = (name: string) => `${name}-${RUN}`

async function makeShop(name: string, opts: { program?: boolean } = {}) {
  const business = await prisma.business.create({
    data: {
      name: `Referral ${name}`,
      slug: slug(`referral-${name}`),
      email: `${name}@referral.test`,
      phone: '555-0100',
      address: '1 Referral Way',
      city: 'TestCity',
      state: 'CA',
      zipCode: '90001',
      timezone: 'America/Los_Angeles',
    },
  })
  const barber = await prisma.barber.create({ data: { name: 'Ref Barber', businessId: business.id } })
  for (let day = 0; day <= 6; day++) {
    await prisma.schedule.create({
      data: { barberId: barber.id, dayOfWeek: day, startTime: '08:00', endTime: '20:00', isOff: false },
    })
  }
  const service = await prisma.service.create({
    data: { businessId: business.id, name: 'Cut', duration: 30, price: 30, isActive: true },
  })
  await prisma.barberService.create({ data: { barberId: barber.id, serviceId: service.id, isActive: true } })
  if (opts.program !== false) {
    await prisma.referralProgram.create({ data: { businessId: business.id, enabled: true, codePrefix: 'REF' } })
  }
  return { business, barber, service }
}

async function makeReferrer(businessId: string, email: string) {
  const customer = await prisma.customer.create({
    data: { businessId, firstName: 'Ref', lastName: 'Errer', phone: '555-0111', email },
  })
  const code = buildReferralCode('REF', customer.id)
  await prisma.referralCode.create({ data: { businessId, customerId: customer.id, code, active: true } })
  return { customer, code }
}

/**
 * A time inside opening hours, tomorrow, in the SHOP's timezone. Building it with
 * setHours() would use the machine's timezone, which is how a booking test ends up
 * asking for 01:00 local and being told the shop is closed.
 */
function slotFor(offsetMinutes: number): Date {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const ymd = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
  const base = new Date(localTimeToUTCFromYMD('10:00', Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), Number(ymd.slice(8, 10)), 'America/Los_Angeles'))
  return new Date(base.getTime() + offsetMinutes * 60_000)
}

async function book(
  shop: Awaited<ReturnType<typeof makeShop>>,
  email: string,
  startTime: Date,
  referral: Awaited<ReturnType<typeof resolveReferralForBooking>> | null,
  key: string
) {
  return createAppointmentSafely({
    businessId: shop.business.id,
    barberId: shop.barber.id,
    serviceId: shop.service.id,
    startTime,
    idempotencyKey: key,
    customerData: { firstName: 'New', lastName: 'Customer', phone: '555-0122', email },
    bookingSource: 'WEBSITE',
    referral,
  })
}

async function main() {
  const A = await makeShop('a')
  const referrer = await makeReferrer(A.business.id, `referrer-${RUN}@ref.test`)

  console.log('\n--- a valid code on a first visit ---')
  const resolved = await resolveReferralForBooking({ businessId: A.business.id, rawCode: referrer.code.toLowerCase() })
  assert(resolved.code === referrer.code, 'a lower-case code is normalised and found')
  assert(resolved.referrerCustomerId === referrer.customer.id, 'the referrer is the code owner')

  const first = await book(A, `friend-${RUN}@ref.test`, slotFor(0), resolved, `ref-1-${RUN}`)
  assert(first.success === true, 'the booking still succeeds')
  const friend = await prisma.customer.findFirst({ where: { businessId: A.business.id, email: `friend-${RUN}@ref.test` } })
  const attribution = await prisma.referralAttribution.findUnique({ where: { customerId: friend!.id } })
  assert(attribution !== null, 'an attribution row exists')
  assert(attribution?.referrerCustomerId === referrer.customer.id, 'the referrer is recorded')
  assert(attribution?.code === referrer.code, 'the code is recorded')
  assert(attribution?.appointmentId === first.appointment?.id, 'the appointment is recorded')
  assert(attribution?.businessId === A.business.id, 'the business is recorded')
  assert(attribution?.source === 'REFERRAL', 'the source says referral, not a marketing channel')

  console.log('\n--- a returning customer is not attributed again ---')
  const second = await book(A, `friend-${RUN}@ref.test`, slotFor(60), resolved, `ref-2-${RUN}`)
  assert(second.success === true, 'the returning booking succeeds')
  const afterSecond = await prisma.referralAttribution.count({ where: { customerId: friend!.id } })
  assert(afterSecond === 1, 'still exactly one attribution')
  const stillFirst = await prisma.referralAttribution.findUnique({ where: { customerId: friend!.id } })
  assert(stillFirst?.appointmentId === first.appointment?.id, 'the first appointment is still the attributed one')

  console.log('\n--- self-referral ---')
  const selfBook = await book(A, `referrer-${RUN}@ref.test`, slotFor(120), resolved, `ref-3-${RUN}`)
  assert(selfBook.success === true, 'the booking itself is allowed')
  const selfCustomer = await prisma.customer.findFirst({ where: { businessId: A.business.id, email: `referrer-${RUN}@ref.test` } })
  const selfAttribution = await prisma.referralAttribution.findUnique({ where: { customerId: selfCustomer!.id } })
  assert(selfAttribution === null, 'a customer cannot refer themselves')

  console.log('\n--- an unknown code never blocks a booking ---')
  const unknown = await resolveReferralForBooking({ businessId: A.business.id, rawCode: 'ZZZZZZ' })
  assert(unknown.code === null, 'an unknown code resolves to nothing')
  const unknownBooking = await book(A, `stranger-${RUN}@ref.test`, slotFor(180), unknown, `ref-4-${RUN}`)
  assert(unknownBooking.success === true, 'the booking succeeds without attribution')

  console.log('\n--- a code from another shop is refused ---')
  const B = await makeShop('b')
  const other = await makeReferrer(B.business.id, `referrer-b-${RUN}@ref.test`)
  const crossResolved = await resolveReferralForBooking({ businessId: A.business.id, rawCode: other.code })
  assert(crossResolved.code === null, "another shop's code does not resolve here")
  const crossBooking = await book(A, `cross-${RUN}@ref.test`, slotFor(240), crossResolved, `ref-5-${RUN}`)
  assert(crossBooking.success === true, 'the booking succeeds')
  const crossCustomer = await prisma.customer.findFirst({ where: { businessId: A.business.id, email: `cross-${RUN}@ref.test` } })
  assert(await prisma.referralAttribution.findUnique({ where: { customerId: crossCustomer!.id } }) === null, 'no attribution was written')

  console.log('\n--- a disabled programme records nothing ---')
  const C = await makeShop('c', { program: false })
  const cReferrer = await makeReferrer(C.business.id, `referrer-c-${RUN}@ref.test`)
  const disabled = await resolveReferralForBooking({ businessId: C.business.id, rawCode: cReferrer.code })
  assert(disabled.code === null, 'the code is ignored when the programme is off')
  const disabledBooking = await book(C, `friend-c-${RUN}@ref.test`, slotFor(0), disabled, `ref-6-${RUN}`)
  assert(disabledBooking.success === true, 'the booking succeeds')
  const disabledCustomer = await prisma.customer.findFirst({ where: { businessId: C.business.id, email: `friend-c-${RUN}@ref.test` } })
  assert(await prisma.referralAttribution.findUnique({ where: { customerId: disabledCustomer!.id } }) === null, 'no attribution was written')

  console.log('\n--- an inactive code is ignored ---')
  await prisma.referralCode.update({ where: { businessId_customerId: { businessId: A.business.id, customerId: referrer.customer.id } }, data: { active: false } })
  const inactive = await resolveReferralForBooking({ businessId: A.business.id, rawCode: referrer.code })
  assert(inactive.code === null, 'a deactivated code resolves to nothing')
  await prisma.referralCode.update({ where: { businessId_customerId: { businessId: A.business.id, customerId: referrer.customer.id } }, data: { active: true } })

  console.log('\n--- two simultaneous first bookings cannot double-attribute ---')
  const race = await makeReferrer(A.business.id, `referrer-race-${RUN}@ref.test`)
  const raceResolved = await resolveReferralForBooking({ businessId: A.business.id, rawCode: race.code })
  const email = `race-${RUN}@ref.test`
  const [r1, r2] = await Promise.all([
    book(A, email, slotFor(300), raceResolved, `ref-race-1-${RUN}`),
    book(A, email, slotFor(360), raceResolved, `ref-race-2-${RUN}`),
  ])
  assert(r1.success && r2.success, 'both distinct valid bookings succeed under serializable retry')
  const raceCustomer = await prisma.customer.findFirst({ where: { businessId: A.business.id, email } })
  const raceCount = await prisma.referralAttribution.count({ where: { customerId: raceCustomer!.id } })
  assert(raceCount === 1, `exactly one attribution exists after simultaneous first bookings (found ${raceCount})`)

  console.log('\n--- a failed booking leaves no attribution behind ---')
  const D = await makeShop('d')
  const dReferrer = await makeReferrer(D.business.id, `referrer-d-${RUN}@ref.test`)
  const dResolved = await resolveReferralForBooking({ businessId: D.business.id, rawCode: dReferrer.code })
  const dEmail = `failed-d-${RUN}@ref.test`
  const failedBooking = await book(D, dEmail, new Date(Date.now() - 86_400_000), dResolved, `ref-fail-${RUN}`)
  assert(failedBooking.success === false, 'a booking in the past is refused')
  const failedCustomer = await prisma.customer.findFirst({ where: { businessId: D.business.id, email: dEmail } })
  assert(failedCustomer === null, 'no customer was created')
  assert(await prisma.referralAttribution.count({ where: { businessId: D.business.id } }) === 0, 'no attribution was written')

  console.log('\n--- a booking with no referral behaves exactly as before ---')
  const E = await makeShop('e')
  const plain = await book(E, `plain-${RUN}@ref.test`, slotFor(0), null, `ref-plain-${RUN}`)
  assert(plain.success === true, 'the booking succeeds')
  assert(typeof plain.appointment?.confirmationNumber === 'string', 'a confirmation number is still issued')
  assert(typeof plain.customerAccessToken === 'string' && plain.customerAccessToken.length > 10, 'an access token is still issued')
  assert(await prisma.referralAttribution.count({ where: { businessId: E.business.id } }) === 0, 'nothing was attributed')

  // Clean up this run only, never anyone else's rows.
  const shops = [A, B, C, D, E].map((s) => s.business.id)
  await prisma.referralAttribution.deleteMany({ where: { businessId: { in: shops } } })
  await prisma.referralCode.deleteMany({ where: { businessId: { in: shops } } })
  await prisma.referralProgram.deleteMany({ where: { businessId: { in: shops } } })
  await prisma.appointment.deleteMany({ where: { businessId: { in: shops } } })
  await prisma.customer.deleteMany({ where: { businessId: { in: shops } } })
  await prisma.barberService.deleteMany({ where: { barberId: A.barber.id } })
  await prisma.business.deleteMany({ where: { id: { in: shops } } })

  console.log(`\nReferral attribution on booking: ${passed} passed, ${failed} failed`)
}

main()
  .catch((error) => { console.error(error); failed++ })
  .finally(async () => {
    await prisma.$disconnect()
    if (failed > 0) process.exit(1)
  })

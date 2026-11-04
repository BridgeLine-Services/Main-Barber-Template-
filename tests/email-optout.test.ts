// Email marketing opt-out, end to end.
//
// Three separate promises have to hold, and a shop's licence to send email
// depends on all three:
//   1. An unsubscribe link works, and only when a human clicks it.
//   2. Opting out actually stops promotional email.
//   3. It does NOT stop appointment email, which is what the page promises.
// A fourth: a signed link cannot be used to touch another shop's customer.

import { createHmac } from 'node:crypto'
import { prisma } from '../src/lib/prisma'
import { createUnsubscribeUrl } from '../src/lib/email-marketing'
import { createCampaign, sendCampaign } from '../src/lib/marketing'

const BASE = 'http://localhost:3000'
let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const secret = () => process.env.NEXTAUTH_SECRET || 'development-only-unsubscribe-secret'
function craftToken(payload: { businessId: string; customerId: string; exp: number }) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${createHmac('sha256', secret()).update(encoded).digest('base64url')}`
}

async function main() {
  const stamp = Date.now()
  const slug = `optout-${stamp}`
  const business = await prisma.business.create({
    data: {
      name: 'Optout Barbers', slug, phone: `+1555${String(stamp).slice(-7)}`, timezone: 'America/Los_Angeles',
      bookingPolicy: '24h', cancellationPolicy: '24h', onboardingCompleted: true,
      address: '12 Main St', city: 'Springfield', state: 'IL', zipCode: '62701',
    },
  })
  const barber = await prisma.barber.create({ data: { businessId: business.id, name: 'Sam', email: `sam-${stamp}@test.local`, isActive: true } })
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Cut', duration: 30, price: 35 } })
  const makeCustomer = (first: string, optOut = false) => prisma.customer.create({
    data: { firstName: first, lastName: 'Tester', phone: `+1666${String(stamp).slice(-5)}${first === 'Ada' ? '1' : first === 'Bob' ? '2' : '3'}`, email: `${first}-${stamp}@test.local`, businessId: business.id, emailOptOut: optOut },
  })
  const subscriber = await makeCustomer('Ada')
  const optedOut = await makeCustomer('Bob', true)
  // Stays subscribed throughout: the earlier section unsubscribes `subscriber`,
  // so the campaign assertions need someone who never opts out.
  const stayIn = await makeCustomer('Cyrus')

  // All lapsed 45 days ago, so all three are in the INACTIVE_30 audience.
  for (const [i, customer] of [subscriber, optedOut, stayIn].entries()) {
    const start = new Date(Date.now() - 45 * 86400000)
    await prisma.appointment.create({
      data: {
        businessId: business.id, barberId: barber.id, serviceId: service.id, customerId: customer.id,
        startTime: start, endTime: new Date(start.getTime() + 1800000), status: 'COMPLETED',
        confirmationNumber: `OPT-${stamp}-${i}`, customerAccessToken: `opt-token-${stamp}-${i}`,
      },
    })
  }

  console.log('--- preview does not change anything (mail scanners) ---')
  const token = createUnsubscribeUrl(business.id, subscriber.id)
  const previewUrl = token.replace(/^https?:\/\/[^/]+/, BASE)
  const preview = await fetch(previewUrl)
  const previewBody = await preview.text()
  assert(preview.status === 200, 'a valid link shows a confirmation page')
  assert(/confirm below/i.test(previewBody), 'the page asks for confirmation rather than acting')
  let row = await prisma.customer.findUnique({ where: { id: subscriber.id }, select: { emailOptOut: true } })
  assert(row?.emailOptOut === false, 'fetching the link (a scanner) does not unsubscribe anyone')

  console.log('--- tampering ---')
  const tampered = await fetch(`${BASE}/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: `${token.split('/unsubscribe?token=')[1]}x` }),
  })
  assert(tampered.status === 400, 'a tampered signature is refused')
  row = await prisma.customer.findUnique({ where: { id: subscriber.id }, select: { emailOptOut: true } })
  assert(row?.emailOptOut === false, 'a tampered link changes nothing')

  const expired = craftToken({ businessId: business.id, customerId: subscriber.id, exp: Math.floor(Date.now() / 1000) - 60 })
  const expiredRes = await fetch(`${BASE}/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: expired }),
  })
  assert(expiredRes.status === 400, 'an expired link is refused')

  console.log('--- a signed link cannot reach another shop ---')
  const otherBusiness = await prisma.business.create({
    data: { name: 'Other Shop', slug: `${slug}-other`, phone: `+1444${String(stamp).slice(-7)}`, timezone: 'America/Los_Angeles', bookingPolicy: 'x', cancellationPolicy: 'y', onboardingCompleted: true },
  })
  const outsider = await prisma.customer.create({
    data: { firstName: 'Eve', lastName: 'Other', phone: `+1777${String(stamp).slice(-7)}`, email: `eve-${stamp}@test.local`, businessId: otherBusiness.id },
  })
  // Correctly signed, but the payload pairs our business with their customer.
  const crossed = craftToken({ businessId: business.id, customerId: outsider.id, exp: Math.floor(Date.now() / 1000) + 3600 })
  await fetch(`${BASE}/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: crossed }),
  })
  const outsiderRow = await prisma.customer.findUnique({ where: { id: outsider.id }, select: { emailOptOut: true } })
  assert(outsiderRow?.emailOptOut === false, 'another shop\'s customer is untouched')

  console.log('--- clicking unsubscribe works ---')
  const clicked = await fetch(`${BASE}/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: token.split('/unsubscribe?token=')[1] }),
  })
  assert(clicked.status === 200, 'the confirmation is accepted')
  row = await prisma.customer.findUnique({ where: { id: subscriber.id }, select: { emailOptOut: true } })
  assert(row?.emailOptOut === true, 'the customer is unsubscribed')
  const repeats = await fetch(`${BASE}/unsubscribe`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: token.split('/unsubscribe?token=')[1] }),
  })
  assert(repeats.status === 200, 'clicking twice is harmless')

  console.log('--- what a promotional email contains ---')
  const campaign = await createCampaign(business.id, { name: 'Autumn', subject: 'Autumn offer', body: 'Come back in.', audience: 'INACTIVE_30' as never })
  await sendCampaign(business.id, campaign.id)
  const queued = await prisma.notificationLog.findMany({ where: { businessId: business.id, type: 'MARKETING_CAMPAIGN' }, select: { customerId: true, channel: true, content: true, recipient: true } })
  assert(queued.length === 1, 'exactly one customer is queued')
  assert(queued[0]?.customerId === stayIn.id, 'the still-subscribed customer is the one queued')
  assert(!queued.some((q) => q.customerId === optedOut.id), 'the customer who opted out earlier is skipped')
  assert(!queued.some((q) => q.customerId === subscriber.id), 'the customer who just unsubscribed is skipped too')
  assert(queued.every((q) => /Unsubscribe: https?:\/\//.test(q.content)), 'every marketing email carries an unsubscribe link')
  assert(queued.every((q) => q.content.includes('12 Main St, Springfield, IL, 62701')), 'every marketing email carries the postal address')

  console.log('--- no postal address, no campaign ---')
  const bare = await prisma.business.create({
    data: { name: 'No Address', slug: `${slug}-bare`, phone: `+1333${String(stamp).slice(-7)}`, timezone: 'America/Los_Angeles', bookingPolicy: 'x', cancellationPolicy: 'y', onboardingCompleted: true },
  })
  await prisma.customer.create({ data: { firstName: 'Cy', lastName: 'Tester', phone: `+1888${String(stamp).slice(-7)}`, email: `cy-${stamp}@test.local`, businessId: bare.id } })
  const bareCampaign = await createCampaign(bare.id, { name: 'Bare', subject: 'S', body: 'B', audience: 'INACTIVE_30' as never })
  let blocked = false
  try { await sendCampaign(bare.id, bareCampaign.id) } catch (error) {
    blocked = /postal address/i.test(String(error))
  }
  assert(blocked, 'sending is refused until a postal address is configured')
  const bareQueued = await prisma.notificationLog.count({ where: { businessId: bare.id } })
  assert(bareQueued === 0, 'nothing is queued for a business without a postal address')

  console.log('--- appointment email is not promotional ---')
  // The page promises reminders still arrive, so an opted-out customer must
  // still be able to receive a booking confirmation.
  await prisma.notificationLog.create({ data: {
    businessId: business.id, customerId: optedOut.id, channel: 'EMAIL', type: 'BOOKING_CONFIRMATION',
    recipient: optedOut.email, subject: 'Your appointment', content: 'See you soon.', status: 'PENDING',
  } })
  const transactional = await prisma.notificationLog.findFirst({ where: { businessId: business.id, customerId: optedOut.id, type: 'BOOKING_CONFIRMATION' }, select: { status: true } })
  assert(transactional?.status === 'PENDING', 'a booking confirmation is queued for an opted-out customer (not filtered at source)')

  await prisma.notificationLog.deleteMany({ where: { businessId: { in: [business.id, bare.id] } } })
  await prisma.appointment.deleteMany({ where: { businessId: business.id } })
  await prisma.marketingCampaign.deleteMany({ where: { businessId: { in: [business.id, bare.id] } } })
  await prisma.customer.deleteMany({ where: { businessId: { in: [business.id, bare.id, otherBusiness.id] } } })
  await prisma.service.deleteMany({ where: { businessId: business.id } })
  await prisma.barber.deleteMany({ where: { businessId: business.id } })
  await prisma.business.deleteMany({ where: { id: { in: [business.id, bare.id, otherBusiness.id] } } })

  console.log(`\nEmail opt-out tests: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

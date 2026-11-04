// Unsubscribe flow: scanners must not be able to opt people out.
//
// Mail gateways and link previews fetch every URL in a message. Before this
// change a GET opted the customer out, so a "you have been unsubscribed" email
// could be produced by a scanner that no human ever touched.

import { prisma } from '../src/lib/prisma'
import { createUnsubscribeUrl } from '../src/lib/email-marketing'

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-unsubscribe-flow'

const BASE = 'http://localhost:3000'
let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

function tokenOf(url: string) { return new URL(url).searchParams.get('token') || '' }

async function optedOut(customerId: string) {
  const row = await prisma.customer.findUnique({ where: { id: customerId }, select: { emailOptOut: true } })
  return row?.emailOptOut === true
}

async function main() {
  const stamp = Date.now()
  const business = await prisma.business.create({
    data: {
      name: `Unsub Shop ${stamp}`, slug: `unsub-${stamp}`, timezone: 'America/Los_Angeles',
      bookingPolicy: '24h notice', cancellationPolicy: 'Free up to 24h before', onboardingCompleted: true,
    },
  })
  const customer = await prisma.customer.create({
    data: { firstName: 'Scanner', lastName: 'Victim', phone: '+15550100', email: `scanner-${stamp}@test.local`, businessId: business.id, emailOptOut: false },
  })
  const url = createUnsubscribeUrl(business.id, customer.id)
  const token = tokenOf(url)

  console.log('--- a preview must not unsubscribe anyone ---')
  const get = await fetch(`${BASE}/unsubscribe?token=${encodeURIComponent(token)}`)
  const getHtml = await get.text()
  assert(get.status === 200, 'the link renders a page')
  assert(!(await optedOut(customer.id)), 'fetching the link changes NOTHING (the bug this fixes)')
  assert(/confirm below/i.test(getHtml), 'the page asks for confirmation')
  assert(/method="post"/i.test(getHtml), 'the page posts back instead of acting on the GET')
  assert(/Appointment confirmations and reminders are separate/i.test(getHtml), 'it explains transactional mail is unaffected')

  console.log('--- a human confirming ---')
  const post = await fetch(`${BASE}/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  })
  const postHtml = await post.text()
  assert(post.status === 200, 'confirming succeeds')
  assert(await optedOut(customer.id), 'the customer is opted out after confirming')
  assert(/no longer receive promotional emails/i.test(postHtml), 'the confirmation says what happened')

  console.log('--- retries and one-click providers ---')
  const again = await fetch(`${BASE}/unsubscribe`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  })
  assert(again.status === 200 && (await optedOut(customer.id)), 'repeating the request is harmless (idempotent)')

  const oneClick = await fetch(`${BASE}/unsubscribe?token=${encodeURIComponent(token)}`, { method: 'POST' })
  assert(oneClick.status === 200, 'a body-less POST with the token in the query works (RFC 8058 one-click shape)')

  console.log('--- bad input ---')
  const customer2 = await prisma.customer.create({
    data: { firstName: 'Un', lastName: 'Touched', phone: '+15550101', email: `untouched-${stamp}@test.local`, businessId: business.id, emailOptOut: false },
  })
  const badGet = await fetch(`${BASE}/unsubscribe?token=not-a-real-token`)
  assert(badGet.status === 400, 'an invalid token is reported as invalid')
  assert(!(await optedOut(customer2.id)), 'an invalid token changes nothing')

  const tampered = token.slice(0, -3) + 'abc'
  const badPost = await fetch(`${BASE}/unsubscribe`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: tampered }),
  })
  assert(badPost.status === 400, 'a tampered token is refused')
  assert(!(await optedOut(customer2.id)), 'a tampered token changes nothing')

  await prisma.customer.deleteMany({ where: { businessId: business.id } })
  await prisma.business.delete({ where: { id: business.id } })

  console.log(`\nUnsubscribe flow tests: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

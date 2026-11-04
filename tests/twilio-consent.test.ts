// Inbound STOP / START consent handling.
//
// The compliance question is not "did STOP work" — it is what START means.
// Someone who replies START wants their appointment reminders back. They have
// not agreed to marketing texts, and a shop that treats the two as the same ends
// up sending promotions to a customer who never consented to them.

import { createHmac } from 'node:crypto'
import { prisma } from '../src/lib/prisma'

const BASE = 'http://localhost:3000'
const AUTH_TOKEN = 'test-twilio-auth-token'
let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

function sign(url: string, params: Record<string, string>) {
  const payload = url + Object.keys(params).sort().map((k) => k + params[k]).join('')
  return createHmac('sha1', AUTH_TOKEN).update(payload).digest('base64')
}

async function inbound(body: string, messageSid: string, shopPhone: string, customerPhone: string) {
  const url = `${BASE}/api/webhooks/twilio`
  const params = { From: customerPhone, To: shopPhone, Body: body, MessageSid: messageSid, SmsSid: messageSid }
  const signature = sign(url, params)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature },
    body: new URLSearchParams(params),
  })
  return { status: res.status, text: await res.text() }
}

async function main() {
  const stamp = Date.now()
  // Unique per run: the webhook resolves the shop by phone with findFirst, so a
  // shared number would match a business left behind by an earlier run.
  const digits = String(stamp).slice(-7)
  const shopPhone = `+1555${digits}`
  const customerPhone = `+1666${digits}`

  // Belt and braces: clear anything already holding these numbers.
  await prisma.customer.deleteMany({ where: { phone: { in: [customerPhone] } } })
  await prisma.business.deleteMany({ where: { phone: shopPhone } })

  const business = await prisma.business.create({
    data: {
      name: 'Consent Shop', slug: `consent-${stamp}`, phone: shopPhone, timezone: 'America/Los_Angeles',
      bookingPolicy: '24h notice', cancellationPolicy: 'Free up to 24h before', onboardingCompleted: true,
    },
  })
  const customer = await prisma.customer.create({
    data: {
      firstName: 'Consent', lastName: 'Tester', phone: customerPhone, businessId: business.id, email: `consent-${stamp}@test.local`,
      smsConsent: true, marketingSmsConsent: true,
    },
  })

  console.log('--- untrusted requests ---')
  const unsigned = await fetch(`${BASE}/api/webhooks/twilio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: customerPhone, To: shopPhone, Body: 'STOP', MessageSid: `nosig-${stamp}` }),
  })
  assert(unsigned.status === 401, 'an unsigned webhook is rejected')

  console.log('--- STOP ---')
  const stopSid = `SM-stop-${stamp}`
  const stopped = await inbound('STOP', stopSid, shopPhone, customerPhone)
  assert(stopped.status === 200, 'STOP is accepted')
  let row = await prisma.customer.findUnique({ where: { id: customer.id }, select: { smsConsent: true, marketingSmsConsent: true } })
  assert(row?.smsConsent === false, 'STOP removes transactional consent')
  assert(row?.marketingSmsConsent === false, 'STOP removes marketing consent')
  const afterStop = await prisma.smsConsentLog.findMany({ where: { customerId: customer.id }, select: { category: true, action: true } })
  assert(afterStop.length === 2, 'STOP records both categories')
  assert(afterStop.every((l) => l.action === 'WITHDRAWN'), 'both are recorded as withdrawals')

  console.log('--- STOP repeated (duplicate delivery) ---')
  await inbound('STOP', stopSid, shopPhone, customerPhone)
  const afterDup = await prisma.smsConsentLog.count({ where: { customerId: customer.id } })
  assert(afterDup === 2, 'a repeated delivery does not duplicate the record')

  console.log('--- START (the finding) ---')
  const startSid = `SM-start-${stamp}`
  const started = await inbound('START', startSid, shopPhone, customerPhone)
  assert(started.status === 200, 'START is accepted')
  row = await prisma.customer.findUnique({ where: { id: customer.id }, select: { smsConsent: true, marketingSmsConsent: true } })
  assert(row?.smsConsent === true, 'START restores appointment messages')
  assert(row?.marketingSmsConsent === false, 'START does NOT grant marketing consent (the bug this replaces)')

  const afterStart = await prisma.smsConsentLog.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'asc' }, select: { category: true, action: true } })
  const startRows = afterStart.slice(2)
  assert(startRows.length === 1, 'START records only the category that changed')
  assert(startRows[0]?.category === 'TRANSACTIONAL' && startRows[0]?.action === 'RE_GRANTED', 'it is recorded as a transactional re-grant')
  assert(!startRows.some((l) => l.category === 'MARKETING'), 'no marketing consent record is created from a START')

  assert(/marketing texts stay off/i.test(started.text), 'the reply tells the customer marketing stays off')
  assert(/appointment messages again/i.test(started.text), 'the reply says what was restored')

  console.log('--- START repeated ---')
  await inbound('START', startSid, shopPhone, customerPhone)
  const afterStartDup = await prisma.smsConsentLog.count({ where: { customerId: customer.id } })
  assert(afterStartDup === 3, 'a repeated START does not duplicate the record')

  console.log('--- previous marketing consent is not destroyed by START ---')
  await prisma.customer.update({ where: { id: customer.id }, data: { smsConsent: false, marketingSmsConsent: true } })
  await inbound('START', `SM-start2-${stamp}`, shopPhone, customerPhone)
  row = await prisma.customer.findUnique({ where: { id: customer.id }, select: { marketingSmsConsent: true, smsConsent: true } })
  assert(row?.marketingSmsConsent === true, 'a customer who had already opted in keeps that consent')

  await prisma.smsConsentLog.deleteMany({ where: { customerId: customer.id } })
  await prisma.customer.deleteMany({ where: { businessId: business.id } })
  await prisma.business.delete({ where: { id: business.id } })

  console.log(`\nTwilio consent tests: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

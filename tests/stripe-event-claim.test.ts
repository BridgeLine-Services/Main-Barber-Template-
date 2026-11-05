// Claiming a Stripe event before processing it.
//
// The claim is what stops two deliveries of the same event both acting. Its
// failure mode matters more than its happy path: if a claim can never be
// released, a single crash mid-handler costs the event permanently, because
// Stripe retries only for so long and every retry would be refused.
//
// These tests drive the real route with real Stripe signatures, so they cover
// the verification, the claim and the response together.

import { createHmac } from 'node:crypto'
import { prisma } from '../src/lib/prisma'
import { POST } from '../src/app/api/webhooks/stripe/route'

const SECRET = 'whsec_test_claim_secret'
process.env.STRIPE_WEBHOOK_SECRET = SECRET

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

function signed(event: unknown) {
  const body = JSON.stringify(event)
  const t = Math.floor(Date.now() / 1000)
  const v1 = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')
  return new Request('http://localhost:3000/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${v1}` },
    body,
  })
}

const event = (id: string) => ({ id, type: 'payment_intent.created', data: { object: { id: `pi_${id}`, metadata: {} } } })

async function main() {
  const stamp = Date.now()
  const ids: string[] = []
  const mk = async (eventId: string, status: 'PROCESSING' | 'FAILED' | 'COMPLETED', ageMinutes = 0) => {
    ids.push(eventId)
    await prisma.stripeEvent.create({
      data: {
        eventId, type: 'payment_intent.created', status,
        processedAt: new Date(Date.now() - ageMinutes * 60000),
      },
    })
  }

  console.log('--- a fresh claim is respected ---')
  const fresh = `evt_fresh_${stamp}`
  await mk(fresh, 'PROCESSING', 0)
  const freshRes = await POST(signed(event(fresh)))
  assert(freshRes.status === 409, 'a delivery whose event is being processed right now is refused')
  const freshRow = await prisma.stripeEvent.findUnique({ where: { eventId: fresh } })
  assert(freshRow?.status === 'PROCESSING', 'the in-flight claim is left alone')

  console.log('--- a crashed claim is taken over, not honoured forever ---')
  const stale = `evt_stale_${stamp}`
  await mk(stale, 'PROCESSING', 10)
  const staleRes = await POST(signed(event(stale)))
  assert(staleRes.status === 200, 'a claim older than five minutes does not block the retry')
  const staleRow = await prisma.stripeEvent.findUnique({ where: { eventId: stale } })
  assert(staleRow?.status === 'COMPLETED', 'the retried event is processed and completed')
  assert(!!staleRow?.processedAt, 'the claim timestamp is refreshed')

  console.log('--- just inside the window is still respected ---')
  const recent = `evt_recent_${stamp}`
  await mk(recent, 'PROCESSING', 4)
  const recentRes = await POST(signed(event(recent)))
  assert(recentRes.status === 409, 'four minutes old is still in flight')

  console.log('--- boundary: five minutes is old enough ---')
  const boundary = `evt_boundary_${stamp}`
  await mk(boundary, 'PROCESSING', 6)
  const boundaryRes = await POST(signed(event(boundary)))
  assert(boundaryRes.status === 200, 'six minutes old can be taken over')

  console.log('--- failed events stay retryable ---')
  const failedId = `evt_failed_${stamp}`
  await mk(failedId, 'FAILED', 1)
  const failedRes = await POST(signed(event(failedId)))
  assert(failedRes.status === 200, 'a FAILED event is reclaimed regardless of age')
  const failedRow = await prisma.stripeEvent.findUnique({ where: { eventId: failedId } })
  assert(failedRow?.status === 'COMPLETED', 'and is completed this time')

  console.log('--- completed events are never re-processed ---')
  const done = `evt_done_${stamp}`
  await mk(done, 'COMPLETED', 30)
  const doneRes = await POST(signed(event(done)))
  const doneBody = await doneRes.json() as { duplicate?: boolean }
  assert(doneRes.status === 200 && doneBody.duplicate === true, 'a completed duplicate is acknowledged as such')

  console.log('--- an unsigned or wrongly signed delivery is still refused ---')
  const unsigned = await POST(new Request('http://localhost:3000/api/webhooks/stripe', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event(`evt_unsigned_${stamp}`)),
  }))
  assert(unsigned.status === 400, 'a request without a signature is rejected')
  const forged = await POST(new Request('http://localhost:3000/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
    body: JSON.stringify(event(`evt_forged_${stamp}`)),
  }))
  assert(forged.status === 400, 'a forged signature is rejected')
  const created = await prisma.stripeEvent.count({ where: { eventId: { in: [`evt_unsigned_${stamp}`, `evt_forged_${stamp}`] } } })
  assert(created === 0, 'a rejected delivery never creates an event row')

  await prisma.stripeEvent.deleteMany({ where: { eventId: { in: ids } } })
  console.log(`\nStripe event claim tests: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

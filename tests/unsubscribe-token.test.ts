// Unsubscribe-token tests.
//
// These links are the legal opt-out path for promotional email, so the token
// has to be unforgeable, expiring, and bound to one business + customer pair.
// Pure functions — no server or database needed.

import { createUnsubscribeUrl, verifyUnsubscribeToken, campaignPostalAddress } from '../src/lib/email-marketing'

process.env.NEXTAUTH_SECRET = 'test-secret-for-unsubscribe-tokens'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

function tokenOf(url: string) {
  return new URL(url).searchParams.get('token') || ''
}

async function main() {
  console.log('--- round trip ---')
  const url = createUnsubscribeUrl('biz_1', 'cust_1')
  const payload = verifyUnsubscribeToken(tokenOf(url))
  assert(payload?.businessId === 'biz_1', 'a fresh link verifies')
  assert(payload?.customerId === 'cust_1', 'the payload keeps the customer it was minted for')
  assert(new URL(url).pathname === '/unsubscribe', 'links point at the unsubscribe page')
  assert(new URL(url).searchParams.get('token') !== null, 'the token travels as a query parameter')

  console.log('--- tampering ---')
  const [encoded, signature] = tokenOf(url).split('.')
  assert(verifyUnsubscribeToken(`${encoded}.${signature.slice(0, -2)}xx`) === null, 'a modified signature is rejected')
  assert(verifyUnsubscribeToken(`garbage.${signature}`) === null, 'a modified payload is rejected')
  assert(verifyUnsubscribeToken(encoded) === null, 'a token with no signature is rejected')
  assert(verifyUnsubscribeToken('') === null, 'an empty token is rejected')

  const otherCustomer = Buffer.from(JSON.stringify({ businessId: 'biz_1', customerId: 'cust_2', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')
  assert(verifyUnsubscribeToken(`${otherCustomer}.${signature}`) === null, 'swapping the customer id inside the payload is rejected')
  const otherBusiness = Buffer.from(JSON.stringify({ businessId: 'biz_2', customerId: 'cust_1', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')
  assert(verifyUnsubscribeToken(`${otherBusiness}.${signature}`) === null, 'swapping the business id inside the payload is rejected')

  console.log('--- expiry ---')
  const old = createUnsubscribeUrl('biz_1', 'cust_1', Date.now() - 181 * 24 * 60 * 60 * 1000)
  assert(verifyUnsubscribeToken(tokenOf(old)) === null, 'a token older than the 180-day window is rejected')
  const recent = createUnsubscribeUrl('biz_1', 'cust_1', Date.now() - 179 * 24 * 60 * 60 * 1000)
  assert(verifyUnsubscribeToken(tokenOf(recent)) !== null, 'a token inside the window still works')

  console.log('--- signing key configuration ---')
  const saved = { nextauth: process.env.NEXTAUTH_SECRET, cron: process.env.CRON_SECRET, nodeEnv: process.env.NODE_ENV, appMode: process.env.APP_MODE }
  const env = process.env as Record<string, string | undefined>
  delete env.NEXTAUTH_SECRET
  delete env.CRON_SECRET

  // Development keeps a working local fallback.
  env.NODE_ENV = 'development'
  delete env.APP_MODE
  const devUrl = createUnsubscribeUrl('biz_1', 'cust_1')
  assert(verifyUnsubscribeToken(tokenOf(devUrl)) !== null, 'development still issues and verifies links')

  // Production must not sign with a predictable key.
  env.NODE_ENV = 'production'
  let threw = false
  try { createUnsubscribeUrl('biz_1', 'cust_1') } catch { threw = true }
  assert(threw, 'production refuses to mint a link without a configured secret')
  assert(verifyUnsubscribeToken(tokenOf(devUrl)) === null, 'production treats a dev-signed token as invalid (fail closed)')

  // APP_MODE alone is enough to trigger the guard.
  env.NODE_ENV = 'development'
  env.APP_MODE = 'production'
  threw = false
  try { createUnsubscribeUrl('biz_1', 'cust_1') } catch { threw = true }
  assert(threw, 'APP_MODE=production also refuses to mint a link without a secret')

  env.NODE_ENV = saved.nodeEnv ?? 'test'
  if (saved.appMode === undefined) delete env.APP_MODE
  else env.APP_MODE = saved.appMode
  if (saved.nextauth) env.NEXTAUTH_SECRET = saved.nextauth
  if (saved.cron) env.CRON_SECRET = saved.cron

  console.log('--- postal address ---')
  assert(campaignPostalAddress({ address: '1 Main St', city: 'Town', state: 'CA', zipCode: '90000' }) === '1 Main St, Town, CA, 90000', 'a complete address renders for the campaign footer')
  assert(campaignPostalAddress({ address: null, city: null, state: null, zipCode: null }) === null, 'a missing address returns null so sending can be blocked')

  console.log(`\nUnsubscribe token tests: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })

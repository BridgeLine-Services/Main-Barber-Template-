// OAuth state signing for the Google Business connection.
//
// The state parameter is what stops an attacker replaying a callback into
// someone else's session, so its signature is a security boundary, not a
// formality. A fixed development key in production would make it forgeable by
// anyone with the source, which binds an attacker's Google profile to a shop
// that never consented.

import { createGBPOAuthState, verifyGBPOAuthState } from '../src/lib/google-business'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

function main() {
  const userId = 'user_123'
  const businessId = 'biz_456'

  console.log('--- round trip ---')
  const state = createGBPOAuthState(userId, businessId)
  assert(verifyGBPOAuthState(state, userId, businessId), 'a state it minted verifies for the same user and business')
  assert(!verifyGBPOAuthState(state, 'someone_else', businessId), 'it does not verify for a different user')
  assert(!verifyGBPOAuthState(state, userId, 'other_biz'), 'it does not verify for a different business')
  assert(!verifyGBPOAuthState('not-a-state', userId, businessId), 'garbage is refused')
  assert(!verifyGBPOAuthState('', userId, businessId), 'an empty state is refused')

  console.log('--- tampering ---')
  const [payloadPart, signaturePart] = state.split('.')
  assert(!verifyGBPOAuthState(`${payloadPart}.${signaturePart}x`, userId, businessId), 'a modified signature is refused')

  const decoded = Buffer.from(state, 'base64url').toString('utf8')
  const [u, b, issuedAt, sig] = decoded.split(':')
  const retargeted = Buffer.from(`${u}:${b}:${issuedAt}:${sig.slice(0, -2)}xx`).toString('base64url')
  assert(!verifyGBPOAuthState(retargeted, userId, businessId), 'a re-signed-looking payload is refused')

  console.log('--- expiry ---')
  const stalePayload = `${userId}:${businessId}:${Date.now() - 11 * 60 * 1000}`
  const { createHmac } = require('node:crypto') as typeof import('node:crypto')
  const staleSig = createHmac('sha256', process.env.NEXTAUTH_SECRET || 'development-only-oauth-state-secret').update(stalePayload).digest('base64url')
  const stale = Buffer.from(`${stalePayload}:${staleSig}`).toString('base64url')
  assert(!verifyGBPOAuthState(stale, userId, businessId), 'a state older than ten minutes is refused')

  console.log('--- the development fallback is not used when a secret is configured ---')
  const devSigned = createHmac('sha256', 'development-only-oauth-state-secret').update(`${userId}:${businessId}:${Date.now()}`).digest('base64url')
  const forged = Buffer.from(`${userId}:${businessId}:${Date.now()}:${devSigned}`).toString('base64url')
  assert(!verifyGBPOAuthState(forged, userId, businessId), 'a state signed with the public development key is refused')

  console.log(`\nOAuth state tests: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main()

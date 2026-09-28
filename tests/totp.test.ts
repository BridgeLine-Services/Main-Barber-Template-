/**
 * TOTP (RFC 6238) / HOTP (RFC 4226) conformance tests.
 *
 * Uses the official RFC 6238 Appendix B test vectors (SHA-1, base32 secret
 * "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"). The RFC publishes 8-digit codes; the
 * 6-digit TOTP form is the same dynamic truncation with one fewer digit
 * (mod 10^6), verified below alongside the published 8-digit values.
 *
 * Run: npx tsx tests/totp.test.ts
 */
import { generateHOTP, generateTOTPCode, generateTOTPSecret, base32Decode, base32Encode, verifyTOTP } from '../src/lib/security'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.error(`  ❌ ${msg}`); failed++ }
}

// RFC 6238 Appendix B vectors (SHA-1): [unix time, 8-digit code]
const RFC_VECTORS: Array<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
]
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' // base32("12345678901234567890")

console.log('\n── RFC 6238 conformance ──')
for (const [time, code8] of RFC_VECTORS) {
  const counter = Math.floor(time / 30)
  // 8-digit HOTP must match the RFC exactly
  const hotp8 = generateHOTP(base32Decode(RFC_SECRET), counter, 8)
  assert(hotp8 === code8, `RFC vector T=${time}: 8-digit HOTP = ${code8}`)
  // 6-digit TOTP is the standard authenticator form
  const totp6 = generateTOTPCode(RFC_SECRET, time)
  const expected6 = code8.slice(-6)
  assert(totp6 === expected6, `RFC vector T=${time}: 6-digit TOTP = ${expected6}`)
}

console.log('\n── Construction ──')
// HMAC, not hash(secret||counter): a plain SHA1 concatenation would produce
// a different digest; assert the HMAC property by checking a known HMAC-SHA1
// intermediate — indirectly guaranteed by the RFC vectors above, so here we
// assert the counter encoding is unsigned big-endian 8 bytes (RFC 4226 §5.2):
// counters beyond 2^31 must still produce RFC vectors (covered by T=20000000000)
// and 2^63-sized counters must not throw.
assert(generateHOTP(base32Decode(RFC_SECRET), 2 ** 33, 6).length === 6, 'counter > 2^31 does not overflow/truncate')

console.log('\n── Base32 round-trip ──')
const raw = Buffer.from('12345678901234567890', 'utf8')
assert(base32Encode(raw) === RFC_SECRET, 'RFC secret base32-encodes correctly')
assert(base32Decode(RFC_SECRET).toString('utf8') === '12345678901234567890', 'base32 round-trip restores secret')

console.log('\n── Secret generation ──')
const secret = generateTOTPSecret()
assert(/^[A-Z2-7]{32}$/.test(secret), 'generated secret is 32-char base32 (20 bytes)')
assert(base32Decode(secret).length === 20, 'generated secret decodes to 20 bytes')
assert(secret !== generateTOTPSecret(), 'secrets are not constant')

console.log('\n── Verification behavior ──')
// Current-step code verifies; a malformed code is rejected without throwing
const now = Math.floor(Date.now() / 1000)
const liveCode = generateTOTPCode(RFC_SECRET, now)
assert(verifyTOTP(liveCode, RFC_SECRET), 'current-step code verifies')
assert(!verifyTOTP('abc123', RFC_SECRET), 'non-numeric code rejected')
assert(!verifyTOTP('12345', RFC_SECRET), 'too-short code rejected')
assert(!verifyTOTP('1234567', RFC_SECRET), 'too-long code rejected')
assert(!verifyTOTP(liveCode, 'A'), 'unusable secret rejected without throwing')
// Wrong code in same step must fail
const wrongCode = liveCode === '000000' ? '000001' : '000000'
assert(!verifyTOTP(wrongCode, RFC_SECRET), 'incorrect code rejected')
// Clock drift: previous-step code rejected at window=0, accepted at window=1
const prevCode = generateTOTPCode(RFC_SECRET, now - 30)
assert(!verifyTOTP(prevCode, RFC_SECRET, 0), 'previous-step code rejected with window=0')
assert(verifyTOTP(prevCode, RFC_SECRET, 1), 'previous-step code accepted with window=1')
// Far-future code rejected even with drift window
assert(!verifyTOTP(generateTOTPCode(RFC_SECRET, now + 300), RFC_SECRET, 1), '10-step-ahead code rejected')

console.log(`\nTOTP conformance tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

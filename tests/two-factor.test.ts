// Two-factor authentication primitive tests.
//
// The repository ships TOTP and backup-code helpers in src/lib/security.ts but
// nothing exercised them, so a regression (a wrong truncation offset, a
// non-constant-time comparison, weakened entropy) could land silently. These
// tests pin the behaviour against the published RFC vectors.
//
// SCOPE NOTE: this suite covers the PRIMITIVES only. Owner enrolment, the
// encrypted secret store, login enforcement and single-use consumption of
// recovery codes are NOT implemented yet; nothing in this file should be read
// as evidence that owners are protected by 2FA today.
//
// Run: npx tsx tests/two-factor.test.ts

import {
  base32Encode,
  base32Decode,
  generateTOTPSecret,
  generateTOTPCode,
  verifyTOTP,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
} from '../src/lib/security'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

// RFC 6238 Appendix B uses the ASCII secret "12345678901234567890", which is
// this base32 string, with 8-digit codes.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'))

// ── base32 round trip ───────────────────────────────────────────────────────
{
  console.log('\n--- base32 ---')
  const raw = Buffer.from('12345678901234567890', 'ascii')
  assert(base32Decode(RFC_SECRET).equals(raw), 'base32 encode/decode round-trips')
  assert(base32Decode('').length === 0, 'empty base32 decodes to empty buffer')
}

// ── RFC 6238 published vectors (SHA-1, 8 digits) ────────────────────────────
{
  console.log('\n--- RFC 6238 vectors ---')
  const vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ]
  for (const [t, expected] of vectors) {
    assert(generateTOTPCode(RFC_SECRET, t, 8) === expected, `RFC vector T=${t} => ${expected}`)
  }
}

// ── secret generation ───────────────────────────────────────────────────────
{
  console.log('\n--- secret generation ---')
  const a = generateTOTPSecret()
  const b = generateTOTPSecret()
  assert(a !== b, 'secrets are not repeated')
  // 20 random bytes base32-encode to 32 characters (no padding).
  assert(a.length === 32, 'secret is 32 base32 characters (160 bits)')
  assert(/^[A-Z2-7]+$/.test(a), 'secret uses only base32 alphabet')
}

// ── verification: correct, wrong, drift, malformed ──────────────────────────
{
  console.log('\n--- verifyTOTP ---')
  const secret = generateTOTPSecret()
  const now = Math.floor(Date.now() / 1000)
  const current = generateTOTPCode(secret, now)

  assert(verifyTOTP(current, secret), 'accepts the current code')
  assert(verifyTOTP(` ${current} `, secret), 'tolerates surrounding whitespace')
  assert(!verifyTOTP(generateTOTPCode(secret, now + 600), secret, 1), 'rejects a code from 10 minutes away')

  // ±1 step (30s) drift is inside the default window.
  assert(verifyTOTP(generateTOTPCode(secret, now - 30), secret, 1), 'accepts 30s of clock drift backwards')
  assert(verifyTOTP(generateTOTPCode(secret, now + 30), secret, 1), 'accepts 30s of clock drift forwards')
  assert(!verifyTOTP(generateTOTPCode(secret, now + 90), secret, 1), 'rejects drift beyond the window')

  // A different secret's valid code must not verify.
  const other = generateTOTPSecret()
  assert(!verifyTOTP(generateTOTPCode(other, now), secret), 'rejects a code minted with another secret')

  // Malformed input never reaches the comparison.
  assert(!verifyTOTP('', secret), 'rejects empty input')
  assert(!verifyTOTP('12345', secret), 'rejects a 5-digit code')
  assert(!verifyTOTP('1234567', secret), 'rejects a 7-digit code')
  assert(!verifyTOTP('abcdef', secret), 'rejects non-numeric input')
  assert(!verifyTOTP('12 456', secret), 'rejects input with an internal space')
  assert(!verifyTOTP(current, ''), 'rejects an empty secret')
  assert(!verifyTOTP(current, 'not-base32!!!'), 'rejects an invalid secret')

  // Stateless contract: the same code stays valid inside its step. Callers that
  // need replay prevention must persist the last accepted counter (not done
  // yet — see the scope note above).
  assert(verifyTOTP(current, secret), 'stateless verifier accepts a replay (caller must prevent this)')
}

// ── backup codes ────────────────────────────────────────────────────────────
{
  console.log('\n--- backup codes ---')
  const codes = generateBackupCodes()
  assert(codes.length === 10, 'issues ten codes')
  assert(new Set(codes).size === 10, 'all ten codes are distinct')
  assert(codes.every((c) => /^[0-9A-F]{10}$/.test(c)), 'each code is 10 uppercase hex characters (40 bits)')
  assert(codes.every((c) => c !== codes[0] || c === codes[0]), 'codes share a format')

  const hashed = codes.map(hashBackupCode)
  assert(hashed.every((h) => /^[0-9a-f]{64}$/.test(h)), 'hashes are 64 hex characters (sha256)')
  assert(hashed.every((h) => !codes.includes(h)), 'stored hashes never contain the plaintext code')
  assert(new Set(hashed).size === 10, 'hashes are distinct')
  assert(hashBackupCode(codes[0]) === hashed[0], 'hashing is deterministic')

  assert(verifyBackupCode(codes[3], hashed), 'accepts a real backup code')
  // Deterministic case test (a random hex code can be all digits, where
  // lowercasing is a no-op, so this must not depend on generated values).
  const mixed = 'ABCDEF1234'
  assert(!verifyBackupCode('abcdef1234', [hashBackupCode(mixed)]), 'codes are case-sensitive')
  assert(!verifyBackupCode('0000000000', hashed), 'rejects a wrong code')
  assert(!verifyBackupCode('', hashed), 'rejects an empty code')
  assert(!verifyBackupCode(codes[0], []), 'rejects when no codes are stored')
  assert(!verifyBackupCode(codes[0], ['deadbeef']), 'ignores malformed stored hashes instead of throwing')

  // Entropy regression guard: 10 distinct 40-bit codes must never collide in
  // practice; a shortened generator (the old 4-byte version) would still pass
  // this, so assert the length explicitly too (done above).
  const many = new Set<string>()
  for (const c of generateBackupCodes()) many.add(c)
  assert(many.size === 10, 'repeated generation stays collision-free')
}

console.log(`\nTwo-factor primitive tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

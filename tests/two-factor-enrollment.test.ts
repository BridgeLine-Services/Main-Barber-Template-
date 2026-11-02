// Two-factor enrollment tests (require a migrated test database).
//
// Covers the storage contract that makes 2FA safe to switch on: the secret is
// encrypted at rest, a tampered ciphertext is rejected, recovery codes are
// single-use and stored only as hashes, and a code cannot be replayed.

import { prisma } from '../src/lib/prisma'
import { generateTOTPCode } from '../src/lib/security'
import {
  beginEnrollment,
  buildOtpauthUrl,
  confirmEnrollment,
  consumeRecoveryCode,
  decryptTwoFactorSecret,
  disableTwoFactor,
  encryptTwoFactorSecret,
  getTwoFactorKey,
  issueRecoveryCodes,
  verifyEnrolledTotp,
} from '../src/lib/two-factor-enrollment'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

function throws(fn: () => unknown): boolean {
  try { fn(); return false } catch { return true }
}

async function main() {
  const stamp = Date.now()
  const business = await prisma.business.create({
    data: {
      name: '2FA Test Shop', slug: `twofactor-${stamp}`, timezone: 'America/Los_Angeles',
      bookingPolicy: '24h', cancellationPolicy: '24h', onboardingCompleted: true,
    },
  })
  const email = `owner-2fa-${stamp}@test.local`
  const user = await prisma.user.create({
    data: { email, name: '2FA Owner', role: 'OWNER', passwordHash: 'x'.repeat(60), businessId: business.id },
  })

  try {
    // ── secret encryption ────────────────────────────────────────────────
    const secret = 'JBSWY3DPEHPK3PXP'
    const enc = encryptTwoFactorSecret(secret)
    assert(enc.startsWith('v1:'), 'ciphertext is versioned')
    assert(!enc.includes(secret), 'ciphertext does not contain the plaintext secret')
    assert(decryptTwoFactorSecret(enc) === secret, 'round-trips to the original secret')
    assert(encryptTwoFactorSecret(secret) !== enc, 'same secret encrypts differently each time (fresh IV)')

    const parts = enc.split(':')
    const tamperedCt = ['v1', parts[1], parts[2], Buffer.from('tampered').toString('base64')].join(':')
    assert(throws(() => decryptTwoFactorSecret(tamperedCt)), 'tampered ciphertext is rejected')
    const tamperedTag = ['v1', parts[1], Buffer.from('0'.repeat(16)).toString('base64'), parts[3]].join(':')
    assert(throws(() => decryptTwoFactorSecret(tamperedTag)), 'tampered auth tag is rejected')
    assert(throws(() => decryptTwoFactorSecret(enc, Buffer.alloc(32, 7))), 'wrong key is rejected')
    assert(throws(() => decryptTwoFactorSecret('v2:a:b:c')), 'unknown version is rejected')
    assert(throws(() => decryptTwoFactorSecret('nonsense')), 'malformed payload is rejected')

    // ── key material ─────────────────────────────────────────────────────
    const originalKey = process.env.TWO_FACTOR_ENCRYPTION_KEY
    const originalSecret = process.env.NEXTAUTH_SECRET
    const originalEnv = process.env.NODE_ENV

    process.env.TWO_FACTOR_ENCRYPTION_KEY = 'a'.repeat(64)
    assert(getTwoFactorKey().length === 32, 'accepts a 64-char hex key')

    process.env.TWO_FACTOR_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64')
    assert(getTwoFactorKey().length === 32, 'accepts a base64 32-byte key')

    process.env.TWO_FACTOR_ENCRYPTION_KEY = 'too-short'
    assert(throws(() => getTwoFactorKey()), 'rejects a key of the wrong length')

    delete process.env.TWO_FACTOR_ENCRYPTION_KEY
    process.env.NEXTAUTH_SECRET = 'a-real-deployment-secret'
    const derived = getTwoFactorKey()
    assert(derived.length === 32, 'derives 32 bytes from NEXTAUTH_SECRET when no dedicated key is set')
    assert(!derived.equals(Buffer.from('a-real-deployment-secret')), 'derived key differs from the source secret')

    delete process.env.NEXTAUTH_SECRET
    ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
    assert(throws(() => getTwoFactorKey()), 'production fails closed when no key material exists')
    ;(process.env as Record<string, string | undefined>).NODE_ENV = originalEnv
    assert(getTwoFactorKey().length === 32, 'development still works without configuration')

    if (originalKey !== undefined) process.env.TWO_FACTOR_ENCRYPTION_KEY = originalKey
    if (originalSecret !== undefined) process.env.NEXTAUTH_SECRET = originalSecret

    // ── otpauth URL ──────────────────────────────────────────────────────
    const url = buildOtpauthUrl(secret, 'owner@shop.test', 'Test Barbershop')
    assert(url.startsWith('otpauth://totp/'), 'produces an otpauth URI')
    assert(url.includes('secret=' + secret), 'URI carries the secret (scanned, never logged)')
    assert(url.includes('issuer=Test+Barbershop') || url.includes('issuer=Test%20Barbershop'), 'URI carries the shop name as issuer')
    assert(decodeURIComponent(url).includes('Test Barbershop:owner@shop.test'), 'label reads Shop:account for the authenticator app')

    // ── enrolment is opt-in and reversible ───────────────────────────────
    const started = await beginEnrollment(user.id)
    assert(started.secret.length >= 16, 'beginEnrollment issues a secret')
    let row = await prisma.user.findUnique({ where: { id: user.id } })
    assert(row?.twoFactorEnabled === false, 'account is NOT enabled until a code is confirmed')
    assert(!!row?.twoFactorSecretEnc && !row.twoFactorSecretEnc.includes(started.secret), 'stored secret is encrypted, not plaintext')

    const wrong = await confirmEnrollment(user.id, '000000')
    assert('error' in wrong, 'a wrong code is rejected')
    row = await prisma.user.findUnique({ where: { id: user.id } })
    assert(row?.twoFactorEnabled === false, 'a failed confirmation leaves the account disabled (cannot lock out)')

    const good = await confirmEnrollment(user.id, generateTOTPCode(started.secret))
    assert('recoveryCodes' in good && good.recoveryCodes.length === 10, 'confirming returns ten recovery codes exactly once')
    row = await prisma.user.findUnique({ where: { id: user.id } })
    assert(row?.twoFactorEnabled === true && !!row.twoFactorEnabledAt, 'account is enabled after a valid code')

    if ('recoveryCodes' in good) {
      const stored = await prisma.twoFactorRecoveryCode.findMany({ where: { userId: user.id } })
      assert(stored.length === 10, 'ten recovery-code rows are stored')
      assert(stored.every((c) => c.usedAt === null), 'none start used')
      const plaintextLeaked = stored.some((c) => good.recoveryCodes.includes(c.codeHash))
      assert(!plaintextLeaked, 'only hashes are stored, never the plaintext codes')

      // ── recovery codes are single-use ─────────────────────────────────
      const first = good.recoveryCodes[0]
      assert(await consumeRecoveryCode(user.id, first), 'a recovery code is accepted once')
      assert(!(await consumeRecoveryCode(user.id, first)), 'the same recovery code is refused the second time')
      assert(!(await consumeRecoveryCode(user.id, 'DEADBEEF00')), 'an unknown recovery code is refused')
      const used = await prisma.twoFactorRecoveryCode.count({ where: { userId: user.id, usedAt: { not: null } } })
      assert(used === 1, 'exactly one code is marked used')
    }

    // ── replay prevention ───────────────────────────────────────────────
    row = await prisma.user.findUnique({ where: { id: user.id } })
    const secretNow = decryptTwoFactorSecret(row!.twoFactorSecretEnc!)
    const stepNow = Math.floor(Date.now() / 1000 / 30)
    const enrolmentCode = generateTOTPCode(secretNow, stepNow * 30)
    assert(!(await verifyEnrolledTotp(user.id, enrolmentCode)), 'the code used to enrol cannot be replayed at login')

    // The next step is inside the ±1 drift window, so it is the first code that
    // may be accepted, and it must then be burned.
    const nextCode = generateTOTPCode(secretNow, (stepNow + 1) * 30)
    assert(await verifyEnrolledTotp(user.id, nextCode), 'the next step code is accepted')
    assert(!(await verifyEnrolledTotp(user.id, nextCode)), 'the same code is refused when replayed')
    assert(!(await verifyEnrolledTotp(user.id, enrolmentCode)), 'the burned enrolment step stays burned')
    assert(!(await verifyEnrolledTotp(user.id, '12345')), 'malformed codes are refused')

    // ── disabling requires proof ────────────────────────────────────────
    assert(!(await disableTwoFactor(user.id, {})), 'disabling without proof is refused')
    assert(!(await disableTwoFactor(user.id, { token: '000000' })), 'disabling with a wrong code is refused')
    const freshForDisable = await prisma.user.findUnique({ where: { id: user.id } })
    assert(freshForDisable?.twoFactorEnabled === true, 'account stays enabled after refused attempts')

    const codes2 = await issueRecoveryCodes(user.id)
    assert(await disableTwoFactor(user.id, { recoveryCode: codes2[0] }), 'a recovery code disables two-factor')
    row = await prisma.user.findUnique({ where: { id: user.id } })
    assert(row?.twoFactorEnabled === false && row.twoFactorSecretEnc === null, 'secret and state are cleared on disable')
    assert((await prisma.twoFactorRecoveryCode.count({ where: { userId: user.id } })) === 0, 'recovery codes are deleted on disable')
  } finally {
    await prisma.business.delete({ where: { id: business.id } }).catch(() => {})
  }

  console.log(`\nTwo-factor enrollment tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

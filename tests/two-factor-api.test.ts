// Two-factor enrolment API tests (requires a live server on :3000).
//
// Requires the SAME NEXTAUTH_SECRET as the server: the fixture secret is
// encrypted with the derived key, so a mismatch would make every code look
// wrong. CI supplies it in the job env.
// Covers: status, enrolment start, confirmation gating, recovery codes,
// disable-requires-proof, and role gating.

import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma'
import { generateTOTPCode, generateTOTPSecret, generateBackupCodes, hashBackupCode } from '../src/lib/security'
import { encryptTwoFactorSecret } from '../src/lib/two-factor-enrollment'

const BASE = 'http://localhost:3000'
let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

async function login(email: string, password: string, twoFactorCode?: string) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  const { csrfToken } = await csrfRes.json()
  const cookie = csrfRes.headers.get('set-cookie') || ''
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ csrfToken, email, password, ...(twoFactorCode ? { twoFactorCode } : {}), json: 'true' }),
    redirect: 'manual',
  })
  const token = /next-auth\.session-token=([^;]+)/.exec(res.headers.get('set-cookie') || '')?.[1]
  return token ? `next-auth.session-token=${token}` : ''
}

async function main() {
  const stamp = Date.now()
  const password = 'TwoFactor!Passw0rd'
  const passwordHash = await bcrypt.hash(password, 10)

  const business = await prisma.business.create({
    data: {
      name: 'Two Factor Shop', slug: `twf-${stamp}`, timezone: 'America/Los_Angeles',
      bookingPolicy: '24h notice', cancellationPolicy: 'Free up to 24h before',
      onboardingCompleted: true,
    },
  })
  const owner = await prisma.user.create({
    data: { email: `twf-owner-${stamp}@test.local`, name: 'Two Factor Owner', role: 'OWNER', passwordHash, businessId: business.id },
  })
  const barber = await prisma.user.create({
    data: { email: `twf-barber-${stamp}@test.local`, name: 'Two Factor Barber', role: 'BARBER', passwordHash, businessId: business.id },
  })

  const ownerCookie = await login(owner.email, password)
  const barberCookie = await login(barber.email, password)
  assert(Boolean(ownerCookie) && Boolean(barberCookie), 'fixtures can sign in')

  const api = (path: string, init: RequestInit = {}, cookie = ownerCookie) =>
    fetch(`${BASE}/api/dashboard/security/2fa${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', cookie, ...(init.headers || {}) },
    })

  // ── guests and barbers cannot touch enrolment ──────────────────────────
  assert((await api('', {}, '')).status === 401, 'signed-out visitor is refused (401)')
  const barberStart = await api('/start', { method: 'POST', body: '{}' }, barberCookie)
  assert(barberStart.status === 403, 'a barber cannot start enrolment for an owner account (403)')

  // ── initial status ─────────────────────────────────────────────────────
  const status0 = await (await api('')).json()
  assert(status0.enabled === false && status0.setupStarted === false, 'new account: two-factor is off')

  // ── start enrolment ────────────────────────────────────────────────────
  const startRes = await api('/start', { method: 'POST', body: '{}' })
  const start = await startRes.json()
  assert(startRes.status === 200 && typeof start.secret === 'string', 'enrolment start returns a setup key')
  assert(String(start.otpauthUrl).startsWith('otpauth://totp/'), 'setup key comes with an authenticator link')

  const stored = await prisma.user.findUnique({
    where: { id: owner.id },
    select: { twoFactorSecretEnc: true, twoFactorEnabled: true },
  })
  assert(stored?.twoFactorEnabled === false, 'starting enrolment does NOT switch two-factor on')
  assert(Boolean(stored?.twoFactorSecretEnc) && !String(stored?.twoFactorSecretEnc).includes(start.secret),
    'the secret is stored encrypted, never in plaintext')

  // ── confirmation gates activation ──────────────────────────────────────
  const wrong = await api('/confirm', { method: 'POST', body: JSON.stringify({ code: '000000' }) })
  assert(wrong.status === 400, 'a wrong code cannot switch two-factor on')
  const stillOff = await prisma.user.findUnique({ where: { id: owner.id }, select: { twoFactorEnabled: true } })
  assert(stillOff?.twoFactorEnabled === false, 'account stays unprotected after a failed confirmation')

  const goodCode = generateTOTPCode(start.secret)
  const confirmRes = await api('/confirm', { method: 'POST', body: JSON.stringify({ code: goodCode }) })
  const confirm = await confirmRes.json()
  assert(confirmRes.status === 200 && confirm.enabled === true, 'a real authenticator code switches two-factor on')
  assert(Array.isArray(confirm.recoveryCodes) && confirm.recoveryCodes.length === 10, 'ten recovery codes are issued once')

  const afterConfirm = await prisma.user.findUnique({
    where: { id: owner.id },
    select: { twoFactorEnabled: true, twoFactorRecoveryCodes: { select: { codeHash: true } } },
  })
  assert(afterConfirm?.twoFactorEnabled === true, 'account is marked protected')
  assert(afterConfirm!.twoFactorRecoveryCodes.every((c) => !confirm.recoveryCodes.includes(c.codeHash)),
    'recovery codes are stored as hashes only')

  const status1 = await (await api('')).json()
  assert(status1.enabled === true && status1.recoveryCodesRemaining === 10, 'status reports protection and unused codes')

  const restart = await api('/start', { method: 'POST', body: '{}' })
  assert(restart.status === 409, 'an enabled account must disable before re-enrolling')

  // ── disable requires the password and a code ───────────────────────────
  const noProof = await api('/disable', { method: 'POST', body: JSON.stringify({}) })
  assert(noProof.status === 400, 'disabling without proof is refused')
  const wrongPassword = await api('/disable', {
    method: 'POST', body: JSON.stringify({ password: 'nope', recoveryCode: confirm.recoveryCodes[0] }),
  })
  assert(wrongPassword.status === 400, 'disabling needs the real account password')
  const wrongRecovery = await api('/disable', {
    method: 'POST', body: JSON.stringify({ password, recoveryCode: 'DEADBEEF00' }),
  })
  assert(wrongRecovery.status === 400, 'an unknown recovery code cannot disable two-factor')

  const disableRes = await api('/disable', {
    method: 'POST', body: JSON.stringify({ password, recoveryCode: confirm.recoveryCodes[0] }),
  })
  assert(disableRes.status === 200, 'password plus an unused recovery code turns two-factor off')
  const afterDisable = await prisma.user.findUnique({
    where: { id: owner.id },
    select: { twoFactorEnabled: true, twoFactorSecretEnc: true, twoFactorRecoveryCodes: { select: { id: true } } },
  })
  assert(afterDisable?.twoFactorEnabled === false && afterDisable?.twoFactorSecretEnc === null,
    'disabling clears the stored secret')
  assert(afterDisable?.twoFactorRecoveryCodes.length === 0, 'disabling deletes the recovery codes')

  // ── cleanup ────────────────────────────────────────────────────────────
  await prisma.user.deleteMany({ where: { businessId: business.id } })
  await prisma.business.delete({ where: { id: business.id } })

  // ── sign-in gating ────────────────────────────────────────────────────
  const gateEmail = `twf-gate-${stamp}@test.local`
  const gatePassword = 'TwoFactor!Passw0rd'
  const gateSecret = generateTOTPSecret()
  const gateCodes = generateBackupCodes()
  // The main fixture is cleaned up earlier in this run, so the gating fixture
  // gets its own shop.
  const gateBusiness = await prisma.business.create({
    data: {
      name: 'Gate Shop', slug: `twf-gate-${stamp}`, timezone: 'America/Los_Angeles',
      bookingPolicy: '24h notice', cancellationPolicy: 'Free up to 24h before',
      onboardingCompleted: true,
    },
  })
  const gateUser = await prisma.user.create({
    data: {
      email: gateEmail, name: 'Gate Owner', role: 'OWNER', businessId: gateBusiness.id,
      passwordHash: await bcrypt.hash(gatePassword, 10),
      twoFactorEnabled: true, twoFactorEnabledAt: new Date(),
      twoFactorSecretEnc: encryptTwoFactorSecret(gateSecret),
      twoFactorRecoveryCodes: { create: gateCodes.map((c) => ({ codeHash: hashBackupCode(c) })) },
    },
  })

  assert((await login(gateEmail, gatePassword)) === '', 'password alone does NOT sign in a protected account')
  assert((await login(gateEmail, gatePassword, '000000')) === '', 'a wrong code does not sign in')

  const withCode = await login(gateEmail, gatePassword, generateTOTPCode(gateSecret))
  assert(Boolean(withCode), 'password plus a live code signs in')

  // Recovery code path: one login attempt (the app allows 10 sign-in attempts
  // per minute per IP, so this suite deliberately stays well under that).
  const freshCodes = await prisma.twoFactorRecoveryCode.findMany({ where: { userId: gateUser.id, usedAt: null } })
  assert(freshCodes.length === gateCodes.length, 'gating fixture starts with all recovery codes unused')
  const recoveryLogin = await login(gateEmail, gatePassword, gateCodes[0])
  assert(Boolean(recoveryLogin), 'a recovery code signs in')
  const usedAfter = await prisma.twoFactorRecoveryCode.count({ where: { userId: gateUser.id, usedAt: { not: null } } })
  assert(usedAfter === 1, 'the recovery code was consumed exactly once')

  // ── the "does this need a code?" question reveals nothing ─────────────
  const ask = (body: Record<string, unknown>) => fetch(`${BASE}/api/auth/2fa/required`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  assert((await ask({ email: gateEmail, password: 'wrong-password' })).status === 401, 'wrong password: no answer either way')
  assert((await ask({ email: 'nobody@test.local', password: 'whatever' })).status === 401, 'unknown account: same 401')
  const askOk = await ask({ email: gateEmail, password: gatePassword })
  const askBody = await askOk.json()
  assert(askOk.status === 200 && askBody.required === true, 'correct password + protected account reports required=true')
  const plainEmail = `twf-plain-${stamp}@test.local`
  await prisma.user.create({
    data: { email: plainEmail, name: 'Plain Owner', role: 'OWNER', passwordHash: await bcrypt.hash(gatePassword, 10), businessId: gateBusiness.id },
  })
  const askPlain = await ask({ email: plainEmail, password: gatePassword })
  const plainBody = await askPlain.json()
  assert(askPlain.status === 200 && plainBody.required === false, 'correct password + unprotected account reports required=false')

  console.log(`\nTwo-factor API tests: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

// Session revocation ("sign out of all devices") — pure logic + live API.
//
// Two sessions are created for the same owner. One presses "sign out of all
// devices"; the other must be dead on its very next request, while the device
// that pressed the button keeps working.

import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma'
import { isSessionRevoked } from '../src/lib/session-security'

const BASE = 'http://localhost:3000'
let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

async function login(email: string, password: string) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  const { csrfToken } = await csrfRes.json()
  const cookie = csrfRes.headers.get('set-cookie') || ''
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ csrfToken, email, password, json: 'true' }),
    redirect: 'manual',
  })
  const token = /next-auth\.session-token=([^;]+)/.exec(res.headers.get('set-cookie') || '')?.[1]
  return token ? `next-auth.session-token=${token}` : ''
}

async function main() {
  // ── pure cutoff logic ────────────────────────────────────────────────
  console.log('--- cutoff comparison ---')
  const cutoff = new Date('2026-11-04T12:00:00Z')
  assert(isSessionRevoked(cutoff, cutoff.getTime() - 1000), 'a session started before the cutoff is revoked')
  assert(!isSessionRevoked(cutoff, cutoff.getTime()), 'a session started exactly at the cutoff survives')
  assert(!isSessionRevoked(cutoff, cutoff.getTime() + 1000), 'a session started after the cutoff survives')
  assert(!isSessionRevoked(null, Date.now() - 10_000), 'no cutoff means nothing is revoked')
  assert(!isSessionRevoked(undefined, Date.now()), 'undefined cutoff is harmless')
  assert(!isSessionRevoked(cutoff, undefined), 'a session without a start stamp is left alone (pre-existing sessions)')
  assert(!isSessionRevoked('not-a-date', Date.now()), 'a corrupt cutoff does not lock anyone out')

  // ── live behaviour ───────────────────────────────────────────────────
  console.log('--- live revocation ---')
  const stamp = Date.now()
  const password = 'RevokeMe!Passw0rd'
  const passwordHash = await bcrypt.hash(password, 10)
  const business = await prisma.business.create({
    data: {
      name: 'Revoke Shop', slug: `revoke-${stamp}`, timezone: 'America/Los_Angeles',
      bookingPolicy: '24h notice', cancellationPolicy: 'Free up to 24h before', onboardingCompleted: true,
    },
  })
  const owner = await prisma.user.create({
    data: { email: `revoke-${stamp}@test.local`, name: 'Revoke Owner', role: 'OWNER', passwordHash, businessId: business.id },
  })

  const deviceA = await login(owner.email, password)
  const deviceB = await login(owner.email, password)
  assert(Boolean(deviceA) && Boolean(deviceB), 'two devices are signed in')

  const status = (cookie: string) =>
    fetch(`${BASE}/api/dashboard/security/2fa`, { headers: { cookie }, cache: 'no-store' })

  assert((await status(deviceA)).status === 200, 'device A works before revocation')
  assert((await status(deviceB)).status === 200, 'device B works before revocation')

  const revoke = (body: Record<string, unknown>, cookie = deviceA) =>
    fetch(`${BASE}/api/dashboard/security/sessions/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(body),
    })

  assert((await revoke({})).status === 400, 'revoking without a password is refused')
  assert((await revoke({ password: 'wrong-password' })).status === 400, 'a wrong password cannot sign devices out')
  assert((await status(deviceB)).status === 200, 'device B is untouched by the refused attempts')

  const ok = await revoke({ password })
  const okBody = await ok.json().catch(() => ({}))
  assert(ok.status === 200, 'the owner can sign out every device')
  assert(/signed out/i.test(String(okBody.message || '')), 'the message says every device was signed out')

  assert((await status(deviceB)).status === 401, 'the other device is signed out on its next request')
  assert(
    (await status(deviceA)).status === 401,
    'the device that pressed the button is signed out too (no "which session is safe" guesswork)',
  )

  const row = await prisma.user.findUnique({ where: { id: owner.id }, select: { sessionsValidAfter: true } })
  assert(row?.sessionsValidAfter instanceof Date, 'the cutoff is stored on the account')

  const audited = await prisma.auditLog.count({ where: { userId: owner.id, action: 'SESSIONS_REVOKED' } })
  assert(audited === 1, 'the revocation is audited')

  // A fresh sign-in after the cutoff must work (the cutoff is not a lockout).
  const deviceC = await login(owner.email, password)
  assert(Boolean(deviceC), 'signing in again after a revocation works')
  assert((await status(deviceC)).status === 200, 'the new session is valid')

  await prisma.auditLog.deleteMany({ where: { userId: owner.id } })
  await prisma.user.deleteMany({ where: { businessId: business.id } })
  await prisma.business.delete({ where: { id: business.id } })

  console.log(`\nSession revocation tests: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

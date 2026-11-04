// Per-device sessions: see them, end one.
//
// The account-wide "sign out everywhere" already existed. This covers ending a
// SINGLE device, which is what an owner wants when they left themselves signed
// in on the shop tablet but want to keep working on their phone.

import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma'
import { describeDevice, maskAddress } from '../src/lib/session-registry'

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
  console.log('--- labels ---')
  assert(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36') === 'Chrome on macOS', 'a desktop browser is labelled plainly')
  assert(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1') === 'Safari on iPhone', 'a phone is labelled plainly')
  assert(describeDevice('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120') === 'Edge on Windows', 'Edge is not confused with Chrome')
  assert(describeDevice('') === 'Unknown device', 'an empty agent degrades gracefully')
  assert(describeDevice(null) === 'Unknown device', 'a missing agent degrades gracefully')
  assert(maskAddress('203.0.113.42') === '203.0.113.x', 'the last octet is dropped')
  assert(maskAddress('unknown') === null, 'the shared bucket is not shown as an address')
  assert(maskAddress(null) === null, 'no address is fine')

  console.log('--- live devices ---')
  const stamp = Date.now()
  const password = 'Device!Passw0rd'
  const passwordHash = await bcrypt.hash(password, 10)
  const business = await prisma.business.create({
    data: {
      name: 'Device Shop', slug: `device-${stamp}`, timezone: 'America/Los_Angeles',
      bookingPolicy: '24h notice', cancellationPolicy: 'Free up to 24h before', onboardingCompleted: true,
    },
  })
  const owner = await prisma.user.create({
    data: { email: `device-${stamp}@test.local`, name: 'Device Owner', role: 'OWNER', passwordHash, businessId: business.id },
  })

  const tablet = await login(owner.email, password)
  const phone = await login(owner.email, password)
  assert(Boolean(tablet) && Boolean(phone), 'two devices sign in')

  const list = async (cookie: string) => {
    const res = await fetch(`${BASE}/api/dashboard/security/sessions`, { headers: { cookie }, cache: 'no-store' })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }

  const listed = await list(tablet)
  assert(listed.status === 200, 'the device list is readable by the owner')
  const sessions = (listed.body?.sessions || []) as Array<{ id: string; current: boolean; device: string }>
  assert(sessions.length >= 2, 'both sign-ins appear')
  assert(sessions.filter((s) => s.current).length === 1, 'exactly one row is marked as this device')

  const other = sessions.find((s) => !s.current)!
  const revoke = await fetch(`${BASE}/api/dashboard/security/sessions/${other.id}/revoke`, {
    method: 'POST', headers: { cookie: tablet },
  })
  assert(revoke.status === 200, 'the owner can sign out a single device')

  const phoneStatus = await fetch(`${BASE}/api/dashboard/security/2fa`, { headers: { cookie: phone }, cache: 'no-store' })
  assert(phoneStatus.status === 401, 'the revoked device is signed out on its next request')

  const tabletStatus = await fetch(`${BASE}/api/dashboard/security/2fa`, { headers: { cookie: tablet }, cache: 'no-store' })
  assert(tabletStatus.status === 200, 'the device that pressed the button keeps working')

  const afterList = await list(tablet)
  const afterIds = ((afterList.body?.sessions || []) as Array<{ id: string }>).map((s) => s.id)
  assert(!afterIds.includes(other.id), 'the revoked device disappears from the list')

  console.log('--- it cannot be used against someone else ---')
  const stranger = await prisma.user.create({
    data: { email: `stranger-${stamp}@test.local`, name: 'Stranger', role: 'OWNER', passwordHash, businessId: business.id },
  })
  const strangerSessions = await prisma.userSession.findMany({ where: { userId: stranger.id }, select: { id: true } })
  const strangerCookie = await login(stranger.email, password)
  assert(Boolean(strangerCookie), 'the second owner can sign in')
  const ownRows = await prisma.userSession.findMany({ where: { userId: stranger.id }, select: { id: true } })
  const foreignId = ownRows.length ? ownRows[ownRows.length - 1].id : (strangerSessions[0]?.id ?? 'nope')
  const cross = await fetch(`${BASE}/api/dashboard/security/sessions/${foreignId}/revoke`, {
    method: 'POST', headers: { cookie: tablet },
  })
  // Either 404 (not theirs) or 200 if it really is theirs; what must never happen
  // is revoking a row belonging to another account.
  assert(cross.status === 404, "another account's session cannot be revoked")
  const stillThere = await prisma.userSession.findUnique({ where: { id: foreignId }, select: { revokedAt: true } })
  assert(stillThere?.revokedAt === null, "the other account's session is untouched")

  await prisma.userSession.deleteMany({ where: { userId: { in: [owner.id, stranger.id] } } })
  await prisma.auditLog.deleteMany({ where: { userId: { in: [owner.id, stranger.id] } } })
  await prisma.user.deleteMany({ where: { businessId: business.id } })
  await prisma.business.delete({ where: { id: business.id } })

  console.log(`\nSession device tests: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

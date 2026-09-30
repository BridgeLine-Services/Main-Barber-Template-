// Ownership transfer + login brute-force protection tests.
// Requires a live server on :3000 and DATABASE_URL. Uses a dedicated
// test business so production-style data is untouched.

import { prisma } from '../src/lib/prisma'

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
    body: new URLSearchParams({
      csrfToken,
      email,
      password,
      json: 'true',
    }),
    redirect: 'manual',
  })
  const setCookie = res.headers.get('set-cookie') || ''
  const session = /next-auth\.session-token=([^;]+)/.exec(setCookie)?.[1]
  return { ok: !!session, sessionCookie: setCookie }
}

function cookiePairs(setCookie: string): string {
  // extract name=value pairs from a set-cookie header string
  return setCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

async function api(path: string, init: RequestInit = {}, cookie: string = ''): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie: cookiePairs(cookie) } : {}), ...(init.headers || {}) },
  })
  let body: Record<string, unknown> | null = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}

async function main() {
  // ── fixture: dedicated test business ──────────────────────────────────
  const stamp = Date.now()
  const business = await prisma.business.create({
    data: { name: 'Transfer Test Shop', slug: `transfer-test-${stamp}`, timezone: 'America/Los_Angeles' },
  })
  const bcrypt = (await import('bcryptjs')).default
  const owner = await prisma.user.create({
    data: {
      email: `owner-${stamp}@transfer-test.local`, name: 'Transfer Owner', role: 'OWNER',
      businessId: business.id, passwordHash: await bcrypt.hash('Password123!', 10), isActive: true,
    },
  })
  const member = await prisma.user.create({
    data: {
      email: `member-${stamp}@transfer-test.local`, name: 'Transfer Member', role: 'BARBER',
      businessId: business.id, passwordHash: await bcrypt.hash('Password123!', 10), isActive: true,
    },
  })
  const foreignBiz = await prisma.business.create({
    data: { name: 'Foreign Transfer Shop', slug: `foreign-transfer-${stamp}`, timezone: 'America/Los_Angeles' },
  })
  const foreignUser = await prisma.user.create({
    data: {
      email: `foreign-${stamp}@transfer-test.local`, name: 'Foreign Member', role: 'BARBER',
      businessId: foreignBiz.id, passwordHash: await bcrypt.hash('Password123!', 10), isActive: true,
    },
  })

  const ownerLogin = await login(owner.email, 'Password123!')
  assert(ownerLogin.ok, 'owner can sign in')
  const memberLogin = await login(member.email, 'Password123!')
  assert(memberLogin.ok, 'member can sign in')
  const ownerCookie = ownerLogin.sessionCookie
  const memberCookie = memberLogin.sessionCookie

  // ── authorization guards ─────────────────────────────────────────────
  const r1 = await api('/api/dashboard/ownership-transfer', { method: 'POST', body: JSON.stringify({ targetUserId: owner.id }) }, memberCookie)
  assert(r1.status === 403, `BARBER cannot transfer ownership (got ${r1.status})`)

  const r2 = await api('/api/dashboard/ownership-transfer', { method: 'POST', body: JSON.stringify({ targetUserId: owner.id }) }, ownerCookie)
  assert(r2.status === 400, 'self-transfer rejected (400)')

  const r3 = await api('/api/dashboard/ownership-transfer', { method: 'POST', body: JSON.stringify({}) }, ownerCookie)
  assert(r3.status === 400, 'missing target rejected (400)')

  const r4 = await api('/api/dashboard/ownership-transfer', { method: 'POST', body: JSON.stringify({ targetUserId: foreignUser.id }) }, ownerCookie)
  assert(r4.status === 404, `cross-business target rejected (got ${r4.status})`)

  // ── happy path ───────────────────────────────────────────────────────
  const r5 = await api('/api/dashboard/ownership-transfer', { method: 'POST', body: JSON.stringify({ targetUserId: member.id }) }, ownerCookie)
  assert(r5.status === 200 && r5.body?.success === true, 'owner can transfer ownership to member')

  const ownerAfter = await prisma.user.findUnique({ where: { id: owner.id } })
  const memberAfter = await prisma.user.findUnique({ where: { id: member.id } })
  assert(ownerAfter?.role === 'BARBER', 'previous owner demoted to BARBER')
  assert(memberAfter?.role === 'OWNER', 'member promoted to OWNER')

  const auditRows = await prisma.auditLog.findMany({
    where: { businessId: business.id, action: 'USER_ROLE_CHANGED' },
  })
  assert(auditRows.length >= 2, 'transfer recorded in audit log')

  // Business data untouched
  const bizAfter = await prisma.business.findUnique({ where: { id: business.id } })
  assert(bizAfter?.id === business.id && bizAfter.name === 'Transfer Test Shop', 'business data preserved')

  // ── session role enforcement on next sign-in ──────────────────────────
  const oldOwnerReLogin = await login(owner.email, 'Password123!')
  assert(oldOwnerReLogin.ok, 'previous owner can still sign in')
  const meRes = await api('/api/dashboard/staff', {}, oldOwnerReLogin.sessionCookie)
  assert(meRes.status === 403, `demoted owner loses owner-only access on fresh login (got ${meRes.status})`)

  const newOwnerLogin = await login(member.email, 'Password123!')
  const newOwnerStaff = await api('/api/dashboard/staff', {}, newOwnerLogin.sessionCookie)
  assert(newOwnerStaff.status === 200, 'new owner has owner access on fresh login')

  // ── login brute-force protection ─────────────────────────────────────
  const victim = `victim-${stamp}@transfer-test.local`
  await prisma.user.create({
    data: {
      email: victim, name: 'Victim', role: 'BARBER',
      businessId: business.id, passwordHash: await bcrypt.hash('Password123!', 10), isActive: true,
    },
  })
  // Successful sign-ins must NOT consume any budget: 6 consecutive
  // correct sign-ins in one minute must all succeed (a count-everything
  // limiter would block the 6th at 5/min).
  let successCount = 0
  for (let i = 0; i < 6; i++) {
    const res = await login(memberAfter.email, 'Password123!')
    if (res.ok) successCount++
  }
  assert(successCount === 6, `successful sign-ins never consume the failure budget (${successCount}/6 succeeded)`)

  // 6 failed attempts exhaust the per-account budget (5/min); a subsequent
  // attempt uses the CORRECT password and must still be blocked.
  for (let i = 0; i < 6; i++) {
    await login(victim, 'wrong-password')
  }
  const blockedLogin = await login(victim, 'Password123!')
  assert(!blockedLogin.ok,
    'correct credentials are rejected after repeated failed attempts (throttle active)')

  // cleanup
  await prisma.auditLog.deleteMany({ where: { businessId: { in: [business.id, foreignBiz.id] } } })
  await prisma.user.deleteMany({ where: { businessId: { in: [business.id, foreignBiz.id] } } })
  await prisma.business.deleteMany({ where: { id: { in: [business.id, foreignBiz.id] } } })

  console.log(`\nOwnership transfer tests: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })

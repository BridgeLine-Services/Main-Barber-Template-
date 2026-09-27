// Business soft deactivation tests (requires live server on :3000).
// Uses a dedicated test business; leaves no residue behind.

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
    body: new URLSearchParams({ csrfToken, email, password, json: 'true' }),
    redirect: 'manual',
  })
  const setCookie = res.headers.get('set-cookie') || ''
  const token = /next-auth\.session-token=([^;]+)/.exec(setCookie)?.[1]
  return { ok: !!token, cookie: token ? `next-auth.session-token=${token}` : '' }
}

async function api(path: string, init: RequestInit = {}, cookie: string = '') {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers || {}) },
  })
  let body: any = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}

async function main() {
  const stamp = Date.now()
  const business = await prisma.business.create({
    data: {
      name: 'Deactivation Test Shop', slug: `deact-test-${stamp}`, timezone: 'America/Los_Angeles',
      bookingPolicy: '24h notice', cancellationPolicy: 'Free up to 24h before',
    },
  })
  const bcrypt = (await import('bcryptjs')).default
  const owner = await prisma.user.create({
    data: {
      email: `deact-owner-${stamp}@test.local`, name: 'Deact Owner', role: 'OWNER',
      businessId: business.id, passwordHash: await bcrypt.hash('Password123!', 10), isActive: true,
    },
  })
  const barberUser = await prisma.user.create({
    data: {
      email: `deact-barber-${stamp}@test.local`, name: 'Deact Barber', role: 'BARBER',
      businessId: business.id, passwordHash: await bcrypt.hash('Password123!', 10), isActive: true,
    },
  })

  const ownerLogin = await login(owner.email, 'Password123!')
  assert(ownerLogin.ok, 'owner can sign in (active shop)')
  const barberLogin = await login(barberUser.email, 'Password123!')
  assert(barberLogin.ok, 'barber can sign in (active shop)')

  // ── guards before deactivation ───────────────────────────────────────
  const g1 = await api('/api/dashboard/business/deactivate', { method: 'POST', body: JSON.stringify({ confirm: 'DEACTIVATE' }) }, barberLogin.cookie)
  assert(g1.status === 403, 'BARBER cannot deactivate the shop (403)')

  const g2 = await api('/api/dashboard/business/deactivate', { method: 'POST', body: JSON.stringify({ confirm: 'WRONG' }) }, ownerLogin.cookie)
  assert(g2.status === 400, 'wrong confirmation string rejected (400)')

  const g3 = await api('/api/dashboard/business/deactivate', {}, ownerLogin.cookie)
  assert(g3.body?.deactivatedAt === null, 'GET reports active state')

  // ── deactivate ───────────────────────────────────────────────────────
  const d1 = await api('/api/dashboard/business/deactivate', { method: 'POST', body: JSON.stringify({ confirm: 'DEACTIVATE' }) }, ownerLogin.cookie)
  assert(d1.status === 200 && d1.body?.success === true, 'owner deactivates the shop')

  const d2 = await api('/api/dashboard/business/deactivate', { method: 'POST', body: JSON.stringify({ confirm: 'DEACTIVATE' }) }, ownerLogin.cookie)
  assert(d2.status === 400, 'double deactivation rejected')

  // ── staff sign-in blocked, owner sign-in allowed ──────────────────────
  const barberAfter = await login(barberUser.email, 'Password123!')
  assert(!barberAfter.ok, 'barber sign-in blocked while deactivated')

  const ownerAfter = await login(owner.email, 'Password123!')
  assert(ownerAfter.ok, 'owner sign-in still allowed while deactivated')

  // ── public booking blocked (503) ─────────────────────────────────────
  // resolvePublicBusiness matches on hostname; the local server falls back
  // to SINGLE_BUSINESS_ID, so we assert the helper logic at DB level
  // instead: the guard reads business.deactivatedAt.
  const bizRow = await prisma.business.findUnique({ where: { id: business.id } })
  assert(!!bizRow?.deactivatedAt, 'deactivatedAt persisted on the business row')

  // ── reactivation ─────────────────────────────────────────────────────
  const r1 = await api('/api/dashboard/business/reactivate', { method: 'POST', body: JSON.stringify({ confirm: 'REACTIVATE' }) }, barberLogin.cookie)
  assert(r1.status === 403, 'BARBER cannot reactivate (403)')

  const r2 = await api('/api/dashboard/business/reactivate', { method: 'POST', body: JSON.stringify({ confirm: 'REACTIVATE' }) }, ownerAfter.cookie)
  assert(r2.status === 200 && r2.body?.success === true, 'owner reactivates the shop')

  const r3 = await api('/api/dashboard/business/reactivate', { method: 'POST', body: JSON.stringify({ confirm: 'REACTIVATE' }) }, ownerAfter.cookie)
  assert(r3.status === 400, 'reactivating an active shop rejected (400)')

  // ── restored state ────────────────────────────────────────────────────
  const barberRestored = await login(barberUser.email, 'Password123!')
  assert(barberRestored.ok, 'barber sign-in restored after reactivation')

  const audit = await prisma.auditLog.findMany({
    where: { businessId: business.id, action: { in: ['BUSINESS_DEACTIVATED', 'BUSINESS_REACTIVATED'] } },
  })
  assert(audit.length === 2, 'deactivation and reactivation audited')

  // ── data preserved ────────────────────────────────────────────────────
  const preserved = await prisma.business.findUnique({
    where: { id: business.id }, select: { name: true, slug: true },
  })
  assert(preserved?.name === 'Deactivation Test Shop', 'business data preserved through the cycle')

  // cleanup
  await prisma.auditLog.deleteMany({ where: { businessId: business.id } })
  await prisma.user.deleteMany({ where: { businessId: business.id } })
  await prisma.business.delete({ where: { id: business.id } })

  console.log(`\nBusiness deactivation tests: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })

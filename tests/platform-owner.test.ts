// Platform owner (§8 / Phase 2) role-architecture tests.
// Requires a live server on :3000 and DATABASE_URL. Uses dedicated test
// businesses/users so production-style data is untouched.
//
// Proves:
//  * Anonymous / owner / barber / customer calls to platform APIs are rejected
//  * Platform owner can list, create, disable, reactivate businesses
//  * Platform owner NEVER loses platform privileges during ownership transfer
//  * Business owner cannot transfer another business's ownership
//  * The centralized permission model denies business caps to non-platform roles
//  * Direct URL access to /platform is gated server-side

import { prisma } from '../src/lib/prisma'
import { can, isPlatformRole, capabilitiesOf } from '../src/lib/permissions'
import bcrypt from 'bcryptjs'

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
  const session = /next-auth\.session-token=([^;]+)/.exec(setCookie)?.[1]
  return { ok: !!session, sessionCookie: setCookie }
}

function cookiePairs(setCookie: string): string {
  return setCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

async function api(path: string, init: RequestInit = {}, cookie: string = ''): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie: cookiePairs(cookie) } : {}), ...(init.headers || {}) },
  })
  let body: any = null
  try { body = await res.json() } catch { /* empty */ }
  return { status: res.status, body }
}

async function main() {
  const stamp = Date.now()
  const password = await bcrypt.hash('TestPass123!', 10)

  // ── fixtures ──────────────────────────────────────────────────────────
  const bizA = await prisma.business.create({
    data: { name: 'Platform Test A', slug: `plat-a-${stamp}`, timezone: 'America/Los_Angeles' },
  })
  const bizB = await prisma.business.create({
    data: { name: 'Platform Test B', slug: `plat-b-${stamp}`, timezone: 'America/Los_Angeles' },
  })
  const ownerA = await prisma.user.create({
    data: { email: `ownera-${stamp}@plat.test`, passwordHash: password, name: 'Owner A', role: 'OWNER', businessId: bizA.id },
  })
  const barberB = await prisma.barber.create({ data: { name: 'B Barber', businessId: bizB.id } })
  const barberUserB = await prisma.user.create({
    data: { email: `barberb-${stamp}@plat.test`, passwordHash: password, name: 'Barber B', role: 'BARBER', businessId: bizB.id, barberId: barberB.id },
  })
  const ownerB = await prisma.user.create({
    data: { email: `ownerb-${stamp}@plat.test`, passwordHash: password, name: 'Owner B', role: 'OWNER', businessId: bizB.id },
  })
  const platformOwner = await prisma.user.create({
    data: { email: `platform-${stamp}@plat.test`, passwordHash: password, name: 'Platform Owner', role: 'PLATFORM_OWNER' },
  })
  const barberA = await prisma.barber.create({ data: { name: 'A Barber', businessId: bizA.id } })
  const barberUserA = await prisma.user.create({
    data: { email: `barbera-${stamp}@plat.test`, passwordHash: password, name: 'Barber A', role: 'BARBER', businessId: bizA.id, barberId: barberA.id },
  })

  try {
    // ── 1. Platform API rejects everyone except PLATFORM_OWNER ─────────
    console.log('\n  --- Platform API authorization ---')

    const anon = await api('/api/platform/businesses')
    assert(anon.status === 401, `anonymous platform list rejected (got ${anon.status})`)

    const ownerLogin = await login(ownerA.email, 'TestPass123!')
    assert(ownerLogin.ok, 'business owner can sign in')
    const ownerRes = await api('/api/platform/businesses', {}, ownerLogin.sessionCookie)
    assert(ownerRes.status === 403, `business owner denied platform list (got ${ownerRes.status})`)

    const barberLogin = await login(barberUserB.email, 'TestPass123!')
    assert(barberLogin.ok, 'barber can sign in')
    const barberRes = await api('/api/platform/businesses', {}, barberLogin.sessionCookie)
    assert(barberRes.status === 403, `barber denied platform list (got ${barberRes.status})`)

    const platformLogin = await login(platformOwner.email, 'TestPass123!')
    assert(platformLogin.ok, 'platform owner can sign in')
    const platformRes = await api('/api/platform/businesses', {}, platformLogin.sessionCookie)
    assert(platformRes.status === 200, `platform owner lists businesses (got ${platformRes.status})`)
    const listed = (platformRes.body?.businesses || []).map((b: any) => b.id)
    assert(listed.includes(bizA.id) && listed.includes(bizB.id), 'platform list includes both test businesses')

    // ── 2. Platform owner creates a business ───────────────────────────
    const created = await api('/api/platform/businesses', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Platform Created Shop',
        slug: `plat-new-${stamp}`,
        timezone: 'America/Los_Angeles',
        ownerEmail: `newowner-${stamp}@plat.test`,
        ownerName: 'New Owner',
      }),
    }, platformLogin.sessionCookie)
    assert(created.status === 201, `platform owner creates business (got ${created.status})`)
    assert(!!created.body?.initialPassword, 'creation returns one-time owner password')

    const newOwner = await prisma.user.findUnique({ where: { email: `newowner-${stamp}@plat.test` } })
    assert(newOwner?.role === 'OWNER', 'created user has OWNER role')
    assert(newOwner?.mustChangePassword === true, 'created owner must change password on first sign-in')

    const dupSlug = await api('/api/platform/businesses', {
      method: 'POST',
      body: JSON.stringify({ name: 'Dup', slug: `plat-new-${stamp}`, ownerEmail: `dup-${stamp}@plat.test`, ownerName: 'Dup' }),
    }, platformLogin.sessionCookie)
    assert(dupSlug.status === 409, `duplicate slug rejected (got ${dupSlug.status})`)

    const ownerCreate = await api('/api/platform/businesses', {
      method: 'POST',
      body: JSON.stringify({ name: 'Nope', slug: `nope-${stamp}`, ownerEmail: `x-${stamp}@plat.test`, ownerName: 'X' }),
    }, ownerLogin.sessionCookie)
    assert(ownerCreate.status === 403, `business owner cannot create businesses (got ${ownerCreate.status})`)

    // ── 3. Deactivate / reactivate lifecycle ──────────────────────────
    const deact = await api('/api/platform/businesses', {
      method: 'PATCH',
      body: JSON.stringify({ businessId: bizB.id, action: 'deactivate' }),
    }, platformLogin.sessionCookie)
    assert(deact.status === 200 && deact.body?.status === 'DEACTIVATED', `platform owner deactivates business (got ${deact.status})`)

    const blockedBarber = await login(barberUserB.email, 'TestPass123!')
    assert(!blockedBarber.ok, 'barber of deactivated business cannot sign in')

    const ownerStillIn = await login(ownerB.email, 'TestPass123!')
    assert(ownerStillIn.ok, 'owner of deactivated business keeps sign-in access (for export/reactivate)')

    const react = await api('/api/platform/businesses', {
      method: 'PATCH',
      body: JSON.stringify({ businessId: bizB.id, action: 'reactivate' }),
    }, platformLogin.sessionCookie)
    assert(react.status === 200 && react.body?.status === 'ACTIVE', `platform owner reactivates business (got ${react.status})`)

    const barberBack = await login(barberUserB.email, 'TestPass123!')
    assert(barberBack.ok, 'barber can sign in again after reactivation')

    const ownerDeact = await api('/api/platform/businesses', {
      method: 'PATCH',
      body: JSON.stringify({ businessId: bizB.id, action: 'deactivate' }),
    }, ownerLogin.sessionCookie)
    assert(ownerDeact.status === 403, `business owner cannot deactivate via platform API (got ${ownerDeact.status})`)

    // ── 4. Ownership transfer: platform privileges are never lost ──────
    console.log('\n  --- Ownership transfer & platform privileges ---')

    // Platform owner initiates a transfer on bizB; caller must keep role.
    const platformTransfer = await api('/api/dashboard/ownership-transfer', {
      method: 'POST',
      body: JSON.stringify({ businessId: bizB.id, targetUserId: barberUserB.id }),
    }, platformLogin.sessionCookie)
    assert(platformTransfer.status === 200, `platform owner can transfer bizB ownership (got ${platformTransfer.status})`)

    const platformAfter = await prisma.user.findUnique({ where: { id: platformOwner.id }, select: { role: true } })
    assert(platformAfter?.role === 'PLATFORM_OWNER', 'platform owner retains PLATFORM_OWNER role after transferring a business')
    const promotedBarber = await prisma.user.findUnique({ where: { id: barberUserB.id }, select: { role: true } })
    assert(promotedBarber?.role === 'OWNER', 'target user was promoted to OWNER')

    // Transfer TO a platform-owner account must be refused.
    // Attached to the business so the lookup finds them and the privilege
    // guard (not just the business-membership check) is what rejects it.
    const platformUserB = await prisma.user.create({
      data: { email: `platform-b-${stamp}@plat.test`, passwordHash: password, name: 'Platform B', role: 'PLATFORM_OWNER', businessId: bizB.id },
    })
    const toPlatform = await api('/api/dashboard/ownership-transfer', {
      method: 'POST',
      body: JSON.stringify({ businessId: bizB.id, targetUserId: platformUserB.id }),
    }, platformLogin.sessionCookie)
    assert(toPlatform.status === 400, `transfer to a platform-owner account rejected (got ${toPlatform.status})`)
    const platformUserBRole = await prisma.user.findUnique({ where: { id: platformUserB.id }, select: { role: true } })
    assert(platformUserBRole?.role === 'PLATFORM_OWNER', 'platform-owner target role untouched')

    // A business owner cannot transfer ANOTHER business's ownership by
    // passing a foreign businessId — the server ignores it for non-platform
    // callers and uses their own business.
    const crossBiz = await api('/api/dashboard/ownership-transfer', {
      method: 'POST',
      body: JSON.stringify({ businessId: bizB.id, targetUserId: barberUserB.id }),
    }, ownerLogin.sessionCookie)
    assert(crossBiz.status >= 400, `business owner cannot transfer another business's ownership (got ${crossBiz.status})`)
    const barberBRoleAfter = await prisma.user.findUnique({ where: { id: barberUserB.id }, select: { role: true } })
    assert(barberBRoleAfter?.role === 'OWNER', 'cross-business transfer attempt made no role change')

    // A barber cannot initiate transfers at all.
    const barberTransfer = await api('/api/dashboard/ownership-transfer', {
      method: 'POST',
      body: JSON.stringify({ businessId: bizB.id, targetUserId: ownerB.id }),
    }, barberLogin.sessionCookie)
    assert(barberTransfer.status === 403, `barber cannot initiate ownership transfer (got ${barberTransfer.status})`)

    // ── 5. Centralized permission model ───────────────────────────────
    console.log('\n  --- Centralized permission model ---')

    assert(can('PLATFORM_OWNER', 'platform.manage-businesses'), 'PLATFORM_OWNER has platform.manage-businesses')
    assert(can('PLATFORM_OWNER', 'platform.transfer-ownership'), 'PLATFORM_OWNER has platform.transfer-ownership')
    assert(!can('OWNER', 'platform.manage-businesses'), 'OWNER lacks platform capabilities')
    assert(!can('BARBER', 'platform.view-operations'), 'BARBER lacks platform capabilities')
    assert(!can('CUSTOMER', 'business.manage'), 'CUSTOMER lacks business management')
    assert(!can('PUBLIC_VISITOR', 'business.manage'), 'anonymous visitor lacks business management')
    assert(!can('BARBER', 'business.manage-staff'), 'barber cannot manage staff')
    assert(!can('BARBER', 'business.publish-website'), 'barber cannot publish website')
    assert(can('BARBER', 'barber.manage-own-schedule'), 'barber manages own schedule')
    assert(can('OWNER', 'business.manage'), 'owner manages business')
    assert(isPlatformRole('PLATFORM_OWNER') && !isPlatformRole('OWNER'), 'isPlatformRole distinguishes platform owner')
    assert(!capabilitiesOf('CUSTOMER').includes('platform.manage-businesses'), 'customer capability list has no platform caps')

    // Unknown roles are never granted anything.
    assert(!can('SUPERUSER_FAKE', 'platform.manage-businesses'), 'unknown role gets no capabilities')

    // ── 6. Direct URL access to /platform is gated server-side ────────
    console.log('\n  --- Direct URL access ---')

    const anonPage = await fetch(`${BASE}/platform`, { redirect: 'manual' })
    assert(anonPage.status >= 300 && anonPage.status < 400, `anonymous /platform redirects (got ${anonPage.status})`)

    const ownerPage = await fetch(`${BASE}/platform`, {
      redirect: 'manual',
      headers: { cookie: cookiePairs(ownerLogin.sessionCookie) },
    })
    assert(ownerPage.status >= 300 && ownerPage.status < 400, `business owner /platform redirects (got ${ownerPage.status})`)

    const platformPage = await fetch(`${BASE}/platform`, {
      redirect: 'manual',
      headers: { cookie: cookiePairs(platformLogin.sessionCookie) },
    })
    assert(platformPage.status === 200, `platform owner sees /platform (got ${platformPage.status})`)

    // Dashboard gate routes platform owners to /platform (not a business dashboard).
    const platformDashboard = await fetch(`${BASE}/dashboard`, {
      redirect: 'manual',
      headers: { cookie: cookiePairs(platformLogin.sessionCookie) },
    })
    assert(
      platformDashboard.status >= 300 && (platformDashboard.headers.get('location') || '').includes('/platform'),
      `platform owner hitting /dashboard is routed to /platform`
    )
  } finally {
    // ── cleanup ──────────────────────────────────────────────────────
    await prisma.user.deleteMany({ where: { email: { contains: `${stamp}@plat.test` } } })
    await prisma.barber.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } })
    const newBiz = await prisma.business.findUnique({ where: { slug: `plat-new-${stamp}` } })
    if (newBiz) await prisma.business.delete({ where: { id: newBiz.id } })
    await prisma.business.deleteMany({ where: { id: { in: [bizA.id, bizB.id] } } })
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Platform owner tests: ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('Test runner crashed:', e)
  process.exit(1)
})

/**
 * Requirement 7: Role boundary tests for the BUSINESS_ADMIN role.
 *
 * Proves, against a live server:
 *  - BUSINESS_ADMIN can manage day-to-day operations (staff barbers, settings,
 *    audit logs, dashboard pages).
 *  - BUSINESS_ADMIN CANNOT: export customer data, access onboarding/factory
 *    tooling, touch platform endpoints, or mint/modify OWNER accounts
 *    (privilege-escalation prevention).
 *  - BARBER cannot access admin/owner APIs.
 *  - Anonymous users get 401 on protected APIs.
 *  - Owner-only actions remain available to OWNER (regression guard).
 *  - A deactivated business blocks admin sign-in while the owner keeps access.
 *  - Staff listings are scoped to the caller's own business (no cross-tenant
 *    leakage through the staff API).
 *
 * Run: npx tsx tests/business-admin-role.test.ts  (server on :3000)
 */
import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma'
import { can, canManageBusiness, isBusinessOwnerRole, capabilitiesOf } from '../src/lib/permissions'

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
  const stamp = Date.now()
  const pw = await bcrypt.hash('Admin-Test-123!', 10)

  const biz = await prisma.business.create({
    data: {
      name: `Role Boundary Shop ${stamp}`, slug: `role-boundary-${stamp}`,
      email: `rb-${stamp}@test.com`, phone: '555-0101', address: '1 Role St',
      city: 'RoleCity', state: 'CA', zipCode: '90001', timezone: 'America/Los_Angeles',
    },
  })
  const otherBiz = await prisma.business.create({
    data: {
      name: `Role Boundary Other ${stamp}`, slug: `role-boundary-other-${stamp}`,
      email: `rbo-${stamp}@test.com`, phone: '555-0102', address: '2 Role St',
      city: 'RoleCity', state: 'CA', zipCode: '90001', timezone: 'America/Los_Angeles',
    },
  })

  const mkUser = (email: string, name: string, role: 'OWNER' | 'BUSINESS_ADMIN' | 'BARBER', businessId: string) =>
    prisma.user.create({ data: { email, name, role, businessId, passwordHash: pw } })

  await mkUser(`owner-rb-${stamp}@test.com`, 'Owner', 'OWNER', biz.id)
  const admin = await mkUser(`admin-rb-${stamp}@test.com`, 'Biz Admin', 'BUSINESS_ADMIN', biz.id)
  const barber = await prisma.barber.create({ data: { name: 'RB Barber', businessId: biz.id, bio: 'b' } })
  await mkUser(`barber-rb-${stamp}@test.com`, 'RB Barber', 'BARBER', biz.id)
  await prisma.user.update({ where: { id: (await prisma.user.findFirst({ where: { email: `barber-rb-${stamp}@test.com` } }))!.id }, data: { barberId: barber.id } })
  await mkUser(`admin-other-${stamp}@test.com`, 'Other Admin', 'BUSINESS_ADMIN', otherBiz.id)
  await mkUser(`owner-other-${stamp}@test.com`, 'Other Owner', 'OWNER', otherBiz.id)

  try {
    console.log('\n── Capability matrix (unit) ──')
    assert(can('BUSINESS_ADMIN', 'business.manage'), 'BUSINESS_ADMIN has business.manage')
    assert(can('BUSINESS_ADMIN', 'business.manage-staff'), 'BUSINESS_ADMIN has business.manage-staff')
    assert(can('BUSINESS_ADMIN', 'appointments.view-all'), 'BUSINESS_ADMIN has appointments.view-all')
    assert(!can('BUSINESS_ADMIN', 'business.export-data'), 'BUSINESS_ADMIN lacks business.export-data (owner-only)')
    assert(!can('BUSINESS_ADMIN', 'business.transfer-ownership'), 'BUSINESS_ADMIN lacks transfer-ownership')
    assert(!can('BUSINESS_ADMIN', 'business.manage-lifecycle'), 'BUSINESS_ADMIN lacks manage-lifecycle')
    assert(!capabilitiesOf('BUSINESS_ADMIN').some((c) => c.startsWith('platform.')), 'BUSINESS_ADMIN has zero platform capabilities')
    assert(canManageBusiness('BUSINESS_ADMIN'), 'canManageBusiness(BUSINESS_ADMIN) is true')
    assert(!isBusinessOwnerRole('BUSINESS_ADMIN'), 'isBusinessOwnerRole(BUSINESS_ADMIN) is false')
    assert(isBusinessOwnerRole('OWNER'), 'isBusinessOwnerRole(OWNER) is true')
    assert(can('OWNER', 'business.export-data'), 'OWNER keeps business.export-data')

    console.log('\n── Live server role boundaries ──')
    const ownerLogin = await login(`owner-rb-${stamp}@test.com`, 'Admin-Test-123!')
    const adminLogin = await login(`admin-rb-${stamp}@test.com`, 'Admin-Test-123!')
    const barberLogin = await login(`barber-rb-${stamp}@test.com`, 'Admin-Test-123!')
    const otherAdminLogin = await login(`admin-other-${stamp}@test.com`, 'Admin-Test-123!')
    assert(ownerLogin.ok && adminLogin.ok && barberLogin.ok && otherAdminLogin.ok, 'owner, admin, barber, other-business admin all sign in')

    // Admin CAN: operational management
    let r = await api('/api/dashboard/staff', {}, adminLogin.sessionCookie)
    assert(r.status === 200, `admin lists staff (got ${r.status})`)
    const listed = (r.body?.staff || r.body || []) as { email?: string }[]
    assert(listed.every((m) => !m.email?.includes('other')), 'staff list contains only own-business members')
    assert(listed.some((m) => m.email === `admin-rb-${stamp}@test.com`), 'staff list includes the admin account')

    r = await api('/api/dashboard/settings', {}, adminLogin.sessionCookie)
    assert(r.status === 200, `admin reads business settings (got ${r.status})`)
    r = await api('/api/dashboard/audit-logs', {}, adminLogin.sessionCookie)
    assert(r.status === 200, `admin reads audit logs (got ${r.status})`)
    r = await api('/api/dashboard/faqs', {}, adminLogin.sessionCookie)
    assert(r.status === 200, `admin reads FAQs (got ${r.status})`)

    // Admin CAN invite a barber
    r = await api('/api/dashboard/staff', {
      method: 'POST',
      body: JSON.stringify({ name: 'Invited Barber', email: `invited-rb-${stamp}@test.com`, role: 'BARBER' }),
    }, adminLogin.sessionCookie)
    assert(r.status === 200 || r.status === 201, `admin invites a barber (got ${r.status})`)

    // Admin CANNOT: owner-only + platform
    r = await api('/api/dashboard/customers/export', {}, adminLogin.sessionCookie)
    assert(r.status === 403, `admin blocked from customer CSV export (got ${r.status})`)
    r = await api('/api/dashboard/staff', {
      method: 'POST',
      body: JSON.stringify({ name: 'Sneaky Owner', email: `sneaky-rb-${stamp}@test.com`, role: 'OWNER' }),
    }, adminLogin.sessionCookie)
    assert(r.status === 403, `admin cannot mint an OWNER account (got ${r.status})`)
    r = await api('/api/dashboard/onboarding', {}, adminLogin.sessionCookie)
    assert(r.status === 403, `admin blocked from onboarding (owner-only) (got ${r.status})`)
    r = await api('/api/dashboard/factory-launch', {}, adminLogin.sessionCookie)
    assert(r.status === 403, `admin blocked from factory-launch (got ${r.status})`)
    r = await api('/api/platform/businesses', {}, adminLogin.sessionCookie)
    assert(r.status === 403, `admin blocked from platform APIs (got ${r.status})`)

    // Owner regression guards: owner still can
    r = await api('/api/dashboard/customers/export', {}, ownerLogin.sessionCookie)
    assert(r.status === 200, `owner can still export customers (got ${r.status})`)
    r = await api('/api/dashboard/staff', {
      method: 'POST',
      body: JSON.stringify({ name: 'Owner Two', email: `owner2-rb-${stamp}@test.com`, role: 'OWNER' }),
    }, ownerLogin.sessionCookie)
    assert(r.status === 200 || r.status === 201, `owner can still invite another owner (got ${r.status})`)
    r = await api('/api/dashboard/onboarding', {}, ownerLogin.sessionCookie)
    assert(r.status === 200, `owner can still access onboarding (got ${r.status})`)

    // Barber boundaries
    r = await api('/api/dashboard/staff', {}, barberLogin.sessionCookie)
    assert(r.status === 403, `barber blocked from staff management (got ${r.status})`)
    r = await api('/api/dashboard/settings', {}, barberLogin.sessionCookie)
    assert(r.status === 403, `barber blocked from settings (got ${r.status})`)
    r = await api('/api/dashboard/audit-logs', {}, barberLogin.sessionCookie)
    assert(r.status === 403, `barber blocked from audit logs (got ${r.status})`)

    // Anonymous boundaries
    r = await api('/api/dashboard/staff')
    assert(r.status === 401, `anonymous blocked from staff API (got ${r.status})`)
    r = await api('/api/dashboard/settings')
    assert(r.status === 401, `anonymous blocked from settings API (got ${r.status})`)

    // Cross-tenant: other-business admin sees only their own business
    r = await api('/api/dashboard/staff', {}, otherAdminLogin.sessionCookie)
    assert(r.status === 200, 'other-business admin lists their own staff')
    const otherList = (r.body?.staff || r.body || []) as { email?: string; businessId?: string }[]
    assert(otherList.every((m) => m.businessId === otherBiz.id || m.email?.includes('other')), 'other-business admin never sees first business staff')

    // Deactivated business: owner keeps access, admin is locked out
    await prisma.business.update({ where: { id: biz.id }, data: { deactivatedAt: new Date() } })
    const adminDeactivated = await login(`admin-rb-${stamp}@test.com`, 'Admin-Test-123!')
    assert(!adminDeactivated.ok, 'deactivated business blocks BUSINESS_ADMIN sign-in')
    const ownerDeactivated = await login(`owner-rb-${stamp}@test.com`, 'Admin-Test-123!')
    assert(ownerDeactivated.ok, 'deactivated business keeps OWNER sign-in (reactivation path)')
    await prisma.business.update({ where: { id: biz.id }, data: { deactivatedAt: null } })

    // Admin staff record integrity: admin user exists with correct role
    const adminRow = await prisma.user.findUnique({ where: { id: admin.id }, select: { role: true, businessId: true } })
    assert(adminRow?.role === 'BUSINESS_ADMIN' && adminRow.businessId === biz.id, 'admin record persists with BUSINESS_ADMIN role')
  } finally {
    const emails = [`owner-rb-${stamp}`, `admin-rb-${stamp}`, `barber-rb-${stamp}`, `admin-other-${stamp}`, `owner-other-${stamp}`, `invited-rb-${stamp}`, `sneaky-rb-${stamp}`, `owner2-rb-${stamp}`].map((e) => `${e}@test.com`)
    await prisma.user.deleteMany({ where: { email: { in: emails } } })
    await prisma.barber.deleteMany({ where: { businessId: { in: [biz.id, otherBiz.id] } } })
    await prisma.business.deleteMany({ where: { id: { in: [biz.id, otherBiz.id] } } })
  }

  console.log(`\nBusiness-admin role boundary tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('Test crashed:', e)
  await prisma.$disconnect()
  process.exit(1)
})

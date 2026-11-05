// Role-by-role authorization probe (Phase 5).
//
// Requires a live server on :3000 and DATABASE_URL. Every dashboard API route
// below is called as each role and the status is recorded, then the invariants
// that must hold for ANY route are asserted:
//
//   1. A signed-out caller never gets a 2xx from a dashboard API.
//   2. A customer never gets a 2xx from a dashboard API.
//   3. A barber never gets a 2xx from an owner-financial route.
//
// The matrix printed at the end is the deliverable: it shows what each role
// actually receives, so a route that drifts from its intended audience is
// visible rather than assumed. Server-side authorization is the security
// boundary; this suite proves it holds at HTTP level for the roles the app
// actually has.

import { prisma } from '../src/lib/prisma'
import bcrypt from 'bcryptjs'

const BASE = process.env.PROBE_BASE_URL || 'http://localhost:3000'
const PASSWORD = 'RoleProbe!2026-ok'

let passed = 0
let failed = 0
function check(condition: boolean, label: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`  ❌ ${label}`)
  }
}

async function login(email: string): Promise<string> {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  const { csrfToken } = await csrfRes.json()
  const csrfCookie = csrfRes.headers.get('set-cookie') || ''
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: csrfCookie },
    body: new URLSearchParams({ csrfToken, email, password: PASSWORD, json: 'true' }),
    redirect: 'manual',
  })
  return res.headers.get('set-cookie') || ''
}

function cookiePairs(setCookie: string): string {
  return setCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

async function probe(path: string, cookie: string): Promise<number> {
  const res = await fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie: cookiePairs(cookie) } : {},
    redirect: 'manual',
  })
  // Drain the body so the connection is reusable.
  await res.text()
  return res.status
}

/** A 2xx means the route served content to this caller. */
const served = (status: number) => status >= 200 && status < 300

/** Owner-only financial and governance surfaces. */
// Only paths that actually serve GET; a guessed path that 404s for everyone
// would pass every invariant while proving nothing.
const OWNER_FINANCIAL = [
  '/api/dashboard/payroll/reports',
  '/api/dashboard/commissions/report',
  '/api/dashboard/analytics',
  '/api/dashboard/audit-logs',
  '/api/dashboard/features',
]

const STAFF_SURFACES = [
  '/api/dashboard/customers',
  '/api/dashboard/appointments',
  '/api/dashboard/waitlist',
  '/api/dashboard/calendar-feed',
  '/api/dashboard/services',
]

async function main() {
  const health = await fetch(`${BASE}/api/health`).catch(() => null)
  if (!health?.ok) {
    console.error(`Server not reachable at ${BASE}. Start it first: npm run build && npm run start`)
    process.exit(1)
  }

  const business = await prisma.business.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!business) {
    console.error('No business found. Seed the database first: npm run db:seed')
    process.exit(1)
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  const stamp = Date.now().toString(36)
  const makeUser = async (role: 'OWNER' | 'BUSINESS_ADMIN' | 'BARBER' | 'CUSTOMER', suffix: string) => {
    const email = `probe-${suffix}-${stamp}@example.test`
    await prisma.user.create({
      data: {
        email,
        name: `Probe ${suffix}`,
        passwordHash,
        role,
        businessId: business.id,
        mustChangePassword: false,
      },
    })
    return email
  }

  const ownerEmail = await makeUser('OWNER', 'owner')
  const adminEmail = await makeUser('BUSINESS_ADMIN', 'admin')
  const barberEmail = await makeUser('BARBER', 'barber')
  const customerEmail = await makeUser('CUSTOMER', 'customer')

  const cookies = {
    owner: await login(ownerEmail),
    admin: await login(adminEmail),
    barber: await login(barberEmail),
    customer: await login(customerEmail),
    anonymous: '',
  }

  check(!!/next-auth\.session-token=/.test(cookies.owner), 'owner can sign in (probe setup)')
  check(!!/next-auth\.session-token=/.test(cookies.barber), 'barber can sign in (probe setup)')
  check(!!/next-auth\.session-token=/.test(cookies.customer), 'customer can sign in (probe setup)')

  const routes = [...OWNER_FINANCIAL, ...STAFF_SURFACES]
  const roles = ['owner', 'admin', 'barber', 'customer', 'anonymous'] as const
  const matrix: Record<string, Record<string, number>> = {}

  for (const route of routes) {
    matrix[route] = {}
    for (const role of roles) {
      const status = await probe(route, cookies[role])
      matrix[route][role] = status

      // Invariant 1: signed-out callers are never served dashboard data.
      if (role === 'anonymous') {
        check(!served(status), `anonymous must not be served ${route} (got ${status})`)
      }
      // Invariant 2: customers are not staff.
      if (role === 'customer') {
        check(!served(status), `customer must not be served ${route} (got ${status})`)
      }
      // Invariant 3: an owner-financial route never serves a barber.
      if (role === 'barber' && OWNER_FINANCIAL.includes(route)) {
        check(!served(status), `barber must not be served owner-financial ${route} (got ${status})`)
      }
    }
  }

  // The owner must actually be able to use their own shop, otherwise a 403
  // everywhere would satisfy every invariant above and prove nothing.
  for (const route of STAFF_SURFACES) {
    check(served(matrix[route].owner), `owner should be served ${route} (got ${matrix[route].owner})`)
  }

  console.log('\nRole matrix (HTTP status per role):')
  const pad = (s: string, n: number) => s.padEnd(n)
  console.log(`${pad('route', 36)}${pad('owner', 8)}${pad('admin', 8)}${pad('barber', 8)}${pad('cust', 8)}anon`)
  for (const route of routes) {
    const row = matrix[route]
    console.log(`${pad(route, 36)}${pad(String(row.owner), 8)}${pad(String(row.admin), 8)}${pad(String(row.barber), 8)}${pad(String(row.customer), 8)}${row.anonymous}`)
  }

  // A barber account with no linked profile has no clients. It must return an
  // empty list rather than every customer in the shop (this was a fail-open).
  const unlinked = await fetch(`${BASE}/api/dashboard/customers`, {
    headers: { cookie: cookiePairs(cookies.barber) },
  })
  const unlinkedBody = (await unlinked.json().catch(() => ({}))) as { customers?: unknown[] }
  check(unlinked.status === 200, `barber customer list responds (got ${unlinked.status})`)
  check(
    Array.isArray(unlinkedBody.customers) && unlinkedBody.customers.length === 0,
    `unlinked barber sees no customers (got ${JSON.stringify(unlinkedBody).slice(0, 120)})`,
  )

  // Clean up the probe accounts; the seeded owner is left alone.
  await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, adminEmail, barberEmail, customerEmail] } } })

  console.log(`\nRole matrix: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('Role matrix crashed:', err)
  await prisma.$disconnect()
  process.exit(1)
})

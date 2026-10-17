/**
 * Owner Registration Journey Tests (live-server dev suite)
 *
 * End-to-end verification of the owner-registration repair (PR #53) beyond
 * the unit tests in owner-registration-mode.test.ts, against the REAL
 * /api/auth/register route and the REAL dashboard access gate:
 *
 *   Phase A — concurrent first-owner registration (ownerless database):
 *     - N parallel registrations race for the first OWNER slot; the
 *       pg_advisory_xact_lock re-check inside the route's transaction must
 *       produce EXACTLY ONE owner (the rest get 409 OWNER_EXISTS).
 *     - The stored password is bcrypt-hashed, never plaintext.
 *     - Duplicate email is rejected (409). Weak passwords rejected (400).
 *
 *   Phase B — first-owner journey:
 *     - The owner can authenticate (credentials provider).
 *     - The dashboard gate redirects an owner with no business to
 *       /dashboard/onboarding (server-side, not client-side).
 *     - The onboarding wizard page is reachable (gate-exempt).
 *
 *   Phase C — owner entry is closed once an owner exists:
 *     - A later registration creates a CUSTOMER, never a second OWNER.
 *     - A customer session is redirected to /portal, never the dashboard.
 *
 *   Seeded databases (owner already exists) skip Phase A/B but still verify
 *   Phase C against the live route — the suite adapts to its database state
 *   and every executed assertion must hold either way.
 *
 * Preconditions:
 *   - Dev server running on http://localhost:3000 (default mode: onboarding)
 *   - RATE_LIMIT_REGISTER_MAX=25 (this suite bursts >3 registrations/min;
 *     the production default of 3/min would 429 the race phase)
 *
 * Run: npx tsx tests/owner-registration-journey.test.ts  (server on :3000)
 */
import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma'

const BASE = 'http://localhost:3000'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}

/** Register a new account via the public endpoint. */
async function register(name: string, email: string, password: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password, ...extra }),
  })
  let body: Record<string, unknown> | null = null
  try { body = await res.json() } catch { /* non-JSON */ }
  return { status: res.status, body }
}

/** NextAuth credentials login; returns the session cookie jar string. */
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

function cookiePairs(setCookie: string): string {
  return setCookie.split(/,(?=[^;]+?=)/).map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ')
}

async function main() {
  const stamp = Date.now()
  const password = 'OwnerJourney-Test-123!'
  const createdEmails: string[] = []
  const emails = (tag: string, n: number) =>
    Array.from({ length: n }, (_, i) => `ownerjourney-${tag}-${stamp}-${i}@t.test`)

  const existingOwners = await prisma.user.count({ where: { role: 'OWNER' } })
  console.log(`\n📦 Owner-registration journey (existing owners in DB: ${existingOwners})`)

  let ownerEmail = ''
  try {
    if (existingOwners === 0) {
      // ─── Phase A: concurrent first-owner registration ──────────────────
      console.log('\n🏁 Phase A — concurrent first-owner registration')
      const racers = emails('race', 4)
      createdEmails.push(...racers)
      const results = await Promise.all(racers.map((e) => register('Race Owner', e, password)))
      const rateLimited = results.find((r) => r.status === 429)
      if (rateLimited) {
        assert(false, 'race hit the register rate limiter — start the dev server with RATE_LIMIT_REGISTER_MAX=25')
      }
      const created = results.filter((r) => r.status === 201)
      const conflicts = results.filter((r) => r.status === 409)
      assert(created.length === 1, `exactly one concurrent racer wins the OWNER slot (got ${created.length}×201)`)
      assert(
        conflicts.length === 3 && conflicts.every((r) => /complete|open/i.test(String(r.body?.error ?? ''))),
        `losers get 409 OWNER_EXISTS (got ${conflicts.length}×409)`
      )

      const ownersNow = await prisma.user.findMany({
        where: { role: 'OWNER', email: { in: racers } },
        select: { email: true, passwordHash: true, role: true, businessId: true },
      })
      assert(ownersNow.length === 1, `exactly one OWNER exists after the race (got ${ownersNow.length})`)
      const owner = ownersNow[0]
      ownerEmail = owner.email
      assert(owner.passwordHash.startsWith('$2'), 'password is bcrypt-hashed, never plaintext')
      assert(owner.passwordHash !== password, 'stored hash is not the raw password')
      assert(await bcrypt.compare(password, owner.passwordHash), 'bcrypt hash verifies against the original password')
      assert(owner.businessId === null, 'first owner starts with no business (onboarding pending)')

      // duplicate email rejected
      const dup = await register('Dup', ownerEmail, password)
      createdEmails.push()
      assert(dup.status === 409, `duplicate email rejected (got ${dup.status})`)

      // weak password rejected by the policy
      const weak = await register('Weak', `ownerjourney-weak-${stamp}@t.test`, 'short')
      assert(weak.status === 400, `weak password rejected by policy (got ${weak.status})`)

      // role forgery is ignored (also asserted in customer-auth-security, kept here for journey completeness)
      const forged = await register('Forged', `ownerjourney-forged-${stamp}@t.test`, password, { role: 'OWNER' })
      createdEmails.push(`ownerjourney-forged-${stamp}@t.test`)
      const forgedUser = await prisma.user.findUnique({ where: { email: `ownerjourney-forged-${stamp}@t.test` } })
      assert(
        forged.status === 201 && forgedUser?.role === 'CUSTOMER',
        `client-supplied role field is ignored (created ${forgedUser?.role})`
      )

      // ─── Phase B: first-owner journey to the onboarding gate ───────────
      console.log('\n🧭 Phase B — owner login and onboarding gate')
      const ownerLogin = await login(ownerEmail, password)
      assert(ownerLogin.ok, 'first owner can authenticate')
      if (ownerLogin.ok) {
        const dash = await fetch(`${BASE}/dashboard`, {
          redirect: 'manual',
          headers: { cookie: cookiePairs(ownerLogin.cookie) },
        })
        const location = dash.headers.get('location') || ''
        assert(
          [307, 308, 302].includes(dash.status) && location.includes('/dashboard/onboarding'),
          `owner without a business is redirected to /dashboard/onboarding (got ${dash.status} → ${location || 'no location'})`
        )
        const wizard = await fetch(`${BASE}/dashboard/onboarding`, {
          redirect: 'manual',
          headers: { cookie: cookiePairs(ownerLogin.cookie) },
        })
        assert(wizard.status === 200, `onboarding wizard is reachable for the gated owner (got ${wizard.status})`)
      }
    } else {
      console.log('\n⏭️  Phase A/B: owner already exists — first-owner race phases not applicable (verified above on a clean DB)')
    }

    // ─── Phase C: owner entry closed once an owner exists ────────────────
    console.log('\n🔒 Phase C — owner entry closed; public registration is customer-only')
    const ownersBefore = await prisma.user.count({ where: { role: 'OWNER' } })
    const custEmail = `ownerjourney-cust-${stamp}@t.test`
    createdEmails.push(custEmail)
    const custRes = await register('Late Customer', custEmail, password)
    const custBody = custRes.body as { user?: { role?: string } } | null
    assert(custRes.status === 201, `public registration still works (got ${custRes.status})`)
    assert(custBody?.user?.role === 'CUSTOMER', `late registration creates a CUSTOMER (got ${custBody?.user?.role})`)
    const ownersAfter = await prisma.user.count({ where: { role: 'OWNER' } })
    assert(ownersAfter === ownersBefore, `no additional OWNER was created (before ${ownersBefore}, after ${ownersAfter})`)

    const custLogin = await login(custEmail, password)
    assert(custLogin.ok, 'the created customer can authenticate')
    if (custLogin.ok) {
      const dash = await fetch(`${BASE}/dashboard`, {
        redirect: 'manual',
        headers: { cookie: cookiePairs(custLogin.cookie) },
      })
      const location = dash.headers.get('location') || ''
      assert(
        [307, 308, 302].includes(dash.status) && location.includes('/portal'),
        `customer session is redirected to /portal, never the dashboard (got ${dash.status} → ${location || 'no location'})`
      )
    }

    // unauthenticated access never reaches the dashboard
    const anon = await fetch(`${BASE}/dashboard`, { redirect: 'manual' })
    const anonLocation = anon.headers.get('location') || ''
    assert(
      [307, 308, 302].includes(anon.status) && anonLocation.includes('/login'),
      `unauthenticated visitor is redirected to /login (got ${anon.status} → ${anonLocation || 'no location'})`
    )
  } finally {
    console.log('\n🧹 Cleaning up test users...')
    if (createdEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } })
    }
  }

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`📊 Owner registration journey: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  if (failed > 0) process.exit(1)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})

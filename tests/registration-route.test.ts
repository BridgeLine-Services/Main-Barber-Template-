/**
 * Registration route — the regression that helper-only tests could not catch.
 *
 * Every rate-limit unit test passed while the registration page still told a
 * first owner "Too many attempts. Please wait a minute and try again." when the
 * truth was that the shared rate-limit store was not configured. The route built
 * its own response instead of using the shared one, so the status said 503 and
 * the words said 429. This suite calls the real POST handler and reads the real
 * response, which is the only way that class of bug shows up.
 *
 * Run: npx tsx tests/registration-route.test.ts
 */

import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'
import { POST as register } from '../src/app/api/auth/register/route'
import { setRateLimitStoreForTest } from '../src/lib/rate-limit'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}

const created = new Set<string>()
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
let ipCounter = 0
const freshIp = () => `198.51.100.${++ipCounter}`

function body(email: string, extra: Record<string, unknown> = {}) {
  return {
    email,
    password: 'A-strong-password-9x',
    confirmPassword: 'A-strong-password-9x',
    name: 'Route Test Owner',
    intent: 'owner',
    ...extra,
  }
}

function request(payload: Record<string, unknown>, ip = freshIp()) {
  return new NextRequest('http://localhost:3000/api/auth/register', {
    method: 'POST',
    // x-real-ip is what this deployment reads when it trusts a proxy; x-forwarded-for
    // is only honoured on Vercel itself.
    headers: { 'content-type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify(payload),
  })
}

async function main() {
  const env = process.env as Record<string, string | undefined>
  const handled = ['CI', 'GITHUB_ACTIONS', 'RATE_LIMIT_CI_IN_MEMORY', 'RATE_LIMIT_TRUST_PROXY'] as const
  const savedCi = Object.fromEntries(handled.map((k) => [k, env[k]]))
  for (const key of ['CI', 'GITHUB_ACTIONS', 'RATE_LIMIT_CI_IN_MEMORY']) delete env[key]
  // The limiter deliberately ignores caller-supplied IPs unless the deployment
  // sits behind a proxy (Vercel sets this for us). Without it every request in
  // this suite shares one key, which is the correct anti-spoofing behaviour and
  // useless for testing per-caller behaviour, so opt in as a deployment would.
  env.RATE_LIMIT_TRUST_PROXY = 'true'
  env.NODE_ENV = 'test'

  await prisma.user.deleteMany({ where: { email: { contains: 'route-test-' } } }).catch(() => {})

  // A fresh client deployment has no owner yet, so this suite needs that state.
  // Any owner left behind by an earlier run is parked as a customer for the
  // duration and restored afterwards, including on failure.
  const parkedOwners = await prisma.user.findMany({ where: { role: 'OWNER' }, select: { id: true } })
  if (parkedOwners.length > 0) {
    await prisma.user.updateMany({ where: { id: { in: parkedOwners.map((o) => o.id) } }, data: { role: 'CUSTOMER' } })
  }
  const restoreOwners = async () => {
    if (parkedOwners.length === 0) return
    await prisma.user.updateMany({ where: { id: { in: parkedOwners.map((o) => o.id) } }, data: { role: 'OWNER' } }).catch(() => {})
  }

  console.log('\n📦 Redis missing or unreachable: 503 and honest words (acceptance 2, 3)')
  {
    setRateLimitStoreForTest({ ping: async () => { throw new Error('ECONNREFUSED https://secret-host.upstash.io') } })
    const res = await register(request(body(`route-test-unreachable-${stamp()}@example.com`)))
    const json: any = await res.json()
    assert(res.status === 503, `unreachable store answers 503 (got ${res.status})`)
    assert(!/too many|tried too many/i.test(json.error), 'the visitor is NOT told they tried too many times')
    assert(/temporarily unable|try again/i.test(json.error), `the words describe a temporary service problem: "${json.error}"`)
    assert(Boolean(res.headers.get('retry-after')), 'Retry-After is preserved')
    assert(!/upstash|redis|secret-host/i.test(json.error), 'no infrastructure detail leaks to the visitor')

    setRateLimitStoreForTest({ ping: async () => { throw new Error('fetch failed') } })
    const res2 = await register(request(body(`route-test-down-${stamp()}@example.com`)))
    assert(res2.status === 503, 'an unreachable store also answers 503 rather than 429')
  }

  console.log('\n📦 A genuine flood: 429 with the wait message (acceptance: real rate limiting)')
  {
    setRateLimitStoreForTest(null) // back to the in-process limiter
    const ip = freshIp()
    const limit = Number(process.env.RATE_LIMIT_REGISTER_MAX ?? 3) || 3
    for (let i = 0; i < limit; i++) {
      const email = `route-test-flood-${stamp()}${i}@example.com`
      created.add(email)
      // Customer intent: a flood test must not create an OWNER, or registration
      // closes and every later section reads 409 instead of what it is testing.
      await register(request(body(email, { intent: 'customer' }), ip))
    }
    const blocked = await register(request(body(`route-test-flood-final-${stamp()}@example.com`, { intent: 'customer' }), ip))
    const json: any = await blocked.json()
    assert(blocked.status === 429, `the request past the limit answers 429 (got ${blocked.status}, limit ${limit})`)
    assert(/wait a minute|too many times/i.test(json.error), 'and says to wait, which is true here')
    assert(Boolean(blocked.headers.get('retry-after')), 'Retry-After is preserved on 429')
  }

  console.log('\n📦 First owner registers normally: 201 (acceptance 1)')
  {
    const email = `route-test-owner-${stamp()}@example.com`
    const res = await register(request(body(email), freshIp()))
    const json: any = await res.json()
    assert(res.status === 201, `owner registration answers 201 (got ${res.status})`)
    assert(json?.user?.role === 'OWNER', 'the account created is an OWNER')
    created.add(email)
  }

  console.log('\n📦 Only one OWNER can exist: the door closes behind them')
  {
    const res = await register(request(body(`route-test-second-${stamp()}@example.com`), freshIp()))
    const json: any = await res.json()
    assert(res.status === 409, `a second owner attempt is refused with 409 (got ${res.status})`)
    assert(json?.code === 'OWNER_REGISTRATION_CLOSED', 'and says registration is closed, not rate limited')
    assert(!/too many/i.test(json.error), 'with no false rate-limit wording')
  }

  console.log('\n📦 A forged role field cannot elevate anyone')
  {
    const email = `route-test-forged-${stamp()}@example.com`
    const res = await register(request(body(email, { intent: 'customer', role: 'PLATFORM_OWNER', isPlatformOwner: true }), freshIp()))
    const json: any = await res.json()
    assert(res.status === 201, 'the sign-up itself is accepted as a customer account')
    assert(json?.user?.role === 'CUSTOMER', `the requested role is ignored (got ${json?.user?.role})`)
    const row = await prisma.user.findUnique({ where: { email }, select: { role: true } })
    assert(row?.role === 'CUSTOMER', 'and the stored row is a CUSTOMER, not an elevated role')
    created.add(email)
  }

  console.log('\n📦 A duplicate email is refused, not silently re-created')
  {
    const email = `route-test-dupe-${stamp()}@example.com`
    const first = await register(request(body(email, { intent: 'customer' }), freshIp()))
    assert(first.status === 201, 'the first sign-up succeeds')
    const second = await register(request(body(email, { intent: 'customer' }), freshIp()))
    const json: any = await second.json()
    assert(second.status === 409, `the second is refused (got ${second.status})`)
    assert(!/unique constraint|P2002/i.test(json.error ?? ''), 'without raw database text')
    const count = await prisma.user.count({ where: { email } })
    assert(count === 1, `exactly one account exists for that email (found ${count})`)
    created.add(email)
  }

  console.log('\n📦 Redis recovery lets registration through again')
  {
    setRateLimitStoreForTest(null)
    const res = await register(request(body(`route-test-recovered-${stamp()}@example.com`, { intent: 'customer' }), freshIp()))
    assert(res.status === 201, 'once the limiter is healthy, registration proceeds')
  }

  await prisma.user.deleteMany({ where: { email: { in: [...created] } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { email: { contains: 'route-test-' } } }).catch(() => {})
  await restoreOwners()
  const leftover = await prisma.user.count({ where: { email: { contains: 'route-test-' } } })
  assert(leftover === 0, 'the suite leaves no test accounts behind')

  for (const key of handled) {
    if (savedCi[key] === undefined) delete env[key]
    else env[key] = savedCi[key]!
  }

  console.log(`\nRegistration route: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.user.deleteMany({ where: { email: { contains: 'route-test-' } } }).catch(() => {})
  await prisma.$disconnect()
  process.exit(1)
})

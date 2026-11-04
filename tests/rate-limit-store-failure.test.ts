// Acceptance cases 4 and 5 from the registration investigation:
//   - the shared store is configured but unreachable (a provider outage)
//   - the limiter recovers once the store answers again
//
// Both matter because the limiter fails CLOSED: a sticky denial after an outage
// would lock every owner out of their shop with a "too many attempts" message.

import { buildRateLimitDenial, checkRateLimit, checkRateLimitStoreHealth, rateLimit, setRateLimitStoreForTest } from '../src/lib/rate-limit'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const config = { windowMs: 60_000, maxRequests: 3 }

/** A store that is present but cannot serve requests. */
const brokenStore = {
  ping: async () => { throw new Error('connect ECONNREFUSED https://secret-host.upstash.io') },
}

async function main() {
  const env = process.env as Record<string, string | undefined>
  const original = env.NODE_ENV
  // CI runs deliberately use the in-memory limiter, which short-circuits the
  // shared store entirely — the very path this suite needs to exercise. Step
  // out of CI-local mode for the duration and put it back afterwards.
  const ciVars = ['CI', 'GITHUB_ACTIONS', 'RATE_LIMIT_CI_IN_MEMORY'] as const
  const savedCi = Object.fromEntries(ciVars.map((k) => [k, env[k]]))
  for (const k of ciVars) delete env[k]
  const restoreCi = () => {
    for (const k of ciVars) {
      if (savedCi[k] === undefined) delete env[k]
      else env[k] = savedCi[k]
    }
  }
  // The seam refuses to run in production; this suite is not production.
  env.NODE_ENV = 'test'

  console.log('--- configured but unreachable (acceptance 4) ---')
  setRateLimitStoreForTest(brokenStore)
  const result = await rateLimit('203.0.113.5:register', config)
  assert(result.allowed === false, 'requests are denied while the store is unreachable (fail closed)')
  assert(result.reason === 'store_unavailable', 'the cause is an outage, not a rate-limit violation')

  const denial = buildRateLimitDenial(result)!
  assert(denial.status === 503, 'the caller receives 503, not 429')
  assert(!/too many|attempt/i.test(denial.body.error), 'the visitor is not blamed')
  assert(!/upstash|secret-host|ECONNREFUSED|token/i.test(JSON.stringify(denial.body)), 'no infrastructure detail leaks to the response')

  const req = new Request('https://shop.test/api/auth/register', { headers: { 'x-real-ip': '203.0.113.5' } })
  const viaEndpoint = await checkRateLimit(req, 'register', config)
  assert(viaEndpoint?.status === 503, 'checkRateLimit surfaces the outage as 503')
  assert(viaEndpoint?.headers['Retry-After'] !== undefined, 'Retry-After is attached to the outage response')

  const health = await checkRateLimitStoreHealth()
  assert(health.state === 'unreachable', 'the readiness probe reports an outage (distinct from missing config)')

  console.log('--- recovery (acceptance 5) ---')
  // Real recovery means the SAME store starts answering again, not that it is
  // removed: in a production-mode process a missing store is "not configured",
  // which is correctly denied. The probe is what proves recovery.
  const healedStore = { ping: async () => 'PONG' }
  setRateLimitStoreForTest(healedStore)
  const healthAfter = await checkRateLimitStoreHealth()
  assert(healthAfter.state === 'ok', 'the readiness probe reports healthy once the store answers again')
  assert(healthAfter.state !== 'unreachable', 'the outage state is not sticky')

  // Request level: with no shared store and no production mode the limiter uses
  // the local window and allows again. This proves a denial is derived per call
  // rather than cached from the earlier outage.
  const savedAppMode = env.APP_MODE
  delete env.APP_MODE
  setRateLimitStoreForTest(null)
  const afterFirst = await rateLimit('203.0.113.5:register', config)
  const afterSecond = await rateLimit('203.0.113.5:register', config)
  assert(afterFirst.allowed === true, 'requests are served again instead of replaying the earlier denial')
  assert(afterFirst.reason === 'ok', 'the reason returns to ok')
  assert(afterSecond.allowed === true, 'the denial was not sticky across calls')
  assert(buildRateLimitDenial(afterFirst) === null, 'no denial is produced for an allowed request')
  if (savedAppMode === undefined) delete env.APP_MODE
  else env.APP_MODE = savedAppMode

  console.log('--- the seam itself is inert in production ---')
  env.NODE_ENV = 'production'
  let refused = false
  try { setRateLimitStoreForTest(brokenStore) } catch { refused = true }
  assert(refused, 'the test seam refuses to run in production')
  env.NODE_ENV = original

  restoreCi()
  console.log(`\nRate limit store failure tests: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })

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
  // Recovery is simulated by removing the broken store: the limiter must not
  // stay stuck in a denied state, and the next calls must be allowed again.
  setRateLimitStoreForTest(null)
  const afterFirst = await rateLimit('203.0.113.5:register', config)
  const afterSecond = await rateLimit('203.0.113.5:register', config)
  assert(afterFirst.allowed === true, 'requests are allowed again once the store is usable')
  assert(afterFirst.reason === 'ok', 'the reason returns to ok')
  assert(afterSecond.allowed === true, 'the denial was not sticky across calls')
  assert(buildRateLimitDenial(afterFirst) === null, 'no denial is produced for an allowed request')

  const healthAfter = await checkRateLimitStoreHealth()
  // With the substitute removed there are no credentials in this environment,
  // so the correct report is 'not_configured'. What matters is that it no longer
  // claims an outage — the failure did not stick to the process.
  assert(healthAfter.state === 'not_configured', 'the readiness probe stops reporting an outage after recovery')
  assert(healthAfter.state !== 'unreachable', 'the outage state is not sticky')

  console.log('--- the seam itself is inert in production ---')
  env.NODE_ENV = 'production'
  let refused = false
  try { setRateLimitStoreForTest(brokenStore) } catch { refused = true }
  assert(refused, 'the test seam refuses to run in production')
  env.NODE_ENV = original

  console.log(`\nRate limit store failure tests: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })

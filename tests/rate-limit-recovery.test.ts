// Redis (shared rate-limit store) outage and recovery behaviour.
//
// The limiter fails CLOSED on purpose: if the shared store cannot be asked, no
// request may be allowed to skip its limit. That is a security decision, and this
// suite pins it. What it must NOT do is stay silent: an outage has to be visible
// to an operator and must clear itself the moment the store answers again.
//
// Existing suites (rate-limit-store-failure / -health / -outcomes / -ip) keep
// their assertions; this one adds the outage lifecycle and alerting.

import {
  buildRateLimitDenial,
  checkRateLimitStoreHealth,
  getRateLimitStoreRuntimeState,
  rateLimit,
  resetRateLimitStoreRuntimeStateForTest,
  setRateLimitStoreForTest,
} from '../src/lib/rate-limit'
import { resetAlertStateForTest } from '../src/lib/alerts'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const config = { windowMs: 60_000, maxRequests: 5 }
const brokenStore = {
  ping: async () => { throw new Error('connect ECONNREFUSED https://secret-host.upstash.io') },
  limit: async () => { throw new Error('connect ECONNREFUSED https://secret-host.upstash.io') },
}
const workingStore = {
  ping: async () => 'PONG',
  limit: async () => ({ success: true, remaining: 4, reset: Date.now() + 60_000 }),
}

const originalFetch = globalThis.fetch
const originalEnv = process.env.NODE_ENV
const alerts: Array<Record<string, unknown>> = []

async function main() {
  // CI mode short-circuits the shared store entirely, which is the path this
  // suite needs to exercise.
  const env = process.env as Record<string, string | undefined>
  const ciVars = ['CI', 'GITHUB_ACTIONS', 'RATE_LIMIT_CI_IN_MEMORY'] as const
  const savedCi = Object.fromEntries(ciVars.map((key) => [key, env[key]]))
  for (const key of ciVars) delete env[key]
  env.NODE_ENV = 'test'
  env.OBSERVABILITY_WEBHOOK_URL = 'https://collector.test/ingest'
  env.ALERT_MIN_SEVERITY = 'warning'

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.body) alerts.push(JSON.parse(String(init.body)) as Record<string, unknown>)
    return new Response('ok', { status: 200 })
  }) as unknown as typeof fetch
  resetAlertStateForTest()
  resetRateLimitStoreRuntimeStateForTest()

  try {
    console.log('--- an outage still fails closed ---')
    setRateLimitStoreForTest(brokenStore)
    const first = await rateLimit('203.0.113.9:booking', config)
    assert(first.allowed === false, 'a request is denied while the store is unreachable')
    assert(first.reason === 'store_unavailable', 'the cause is an outage, not a limit violation')
    const denial = buildRateLimitDenial(first)!
    assert(denial.status === 503, 'the caller gets 503, not 429')
    assert(!/too many|tried/i.test(denial.body.error), 'the visitor is never blamed for the outage')
    assert(!/upstash|secret-host|ECONNREFUSED|token/i.test(JSON.stringify(denial.body)), 'no infrastructure detail reaches the browser')

    console.log('--- the outage is counted and alerted once ---')
    assert(getRateLimitStoreRuntimeState().consecutiveFailures === 1, 'the failure is counted')
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert(alerts.length === 0, 'a single failure does not page anyone yet')
    await rateLimit('203.0.113.9:booking', config)
    await rateLimit('203.0.113.9:booking', config)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const state = getRateLimitStoreRuntimeState()
    assert(state.consecutiveFailures >= 3, 'consecutive failures accumulate')
    assert(state.lastFailureMessage === 'connection failed', 'the recorded cause is a short, credential-free kind')
    assert(JSON.stringify(state).indexOf('upstash') === -1, 'the runtime state carries no provider detail')
    assert(alerts.some((alert) => alert.event === 'rate_limit_store_unavailable'), 'an alert is raised once the outage is real')

    const alertCount = alerts.length
    await rateLimit('203.0.113.9:booking', config)
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert(alerts.length === alertCount, 'a continuing outage does not flood the channel with duplicate alerts')

    console.log('--- the health probe agrees, and is not a rate-limit spend ---')
    const health = await checkRateLimitStoreHealth()
    assert(health.state === 'unreachable', 'the probe reports an outage')
    assert(state.totalSuccesses === 0, 'the failed probe consumed no allowance')

    console.log('--- recovery is detected and announced ---')
    // A real Upstash limiter needs the full command interface, which a hand-made
    // fake cannot honestly provide. Recovery is detected by the first successful
    // call — either a limit() that answers, or the PING the readiness probe sends
    // — so the probe is the honest seam to drive it here.
    setRateLimitStoreForTest(workingStore)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const afterRecoveryProbe = await checkRateLimitStoreHealth()
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert(afterRecoveryProbe.state === 'ok', 'the probe reports the store is answering again')
    const afterState = getRateLimitStoreRuntimeState()
    assert(afterState.consecutiveFailures === 0, 'the failure counter is cleared')
    assert(afterState.degraded === false, 'the store is no longer reported as degraded')
    assert(afterState.lastSuccessAt !== null, 'the recovery time is recorded')
    assert(alerts.some((alert) => alert.event === 'rate_limit_store_unavailable_recovered'), 'a recovery notice is sent')
    assert(alerts.some((alert) => alert.recoveryOf === 'rate_limit_store_unavailable'), 'the notice closes the incident')

    console.log('--- thresholds are untouched by this change ---')
    const { RATE_LIMITS } = await import('../src/lib/rate-limit')
    assert(RATE_LIMITS.BOOKING.maxRequests === 10 && RATE_LIMITS.AUTH.maxRequests === 5, 'the shipped limits are unchanged')
    assert(RATE_LIMITS.PASSWORD_RESET.maxRequests === 3, 'the password-reset limit is unchanged')
  } finally {
    setRateLimitStoreForTest(null)
    delete env.OBSERVABILITY_WEBHOOK_URL
    delete env.ALERT_MIN_SEVERITY
    globalThis.fetch = originalFetch
    env.NODE_ENV = originalEnv
    for (const key of ciVars) {
      if (savedCi[key] === undefined) delete env[key]
      else env[key] = savedCi[key]
    }
  }

  console.log(`\nRate-limit recovery tests: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => { globalThis.fetch = originalFetch; console.error(error); process.exit(1) })

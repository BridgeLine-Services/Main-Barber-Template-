// Launch readiness must not declare a deployment ready when sign-in is broken.
//
// A missing Upstash configuration makes the limiter fail closed, so nobody can
// sign in. That belongs in the launch checks as a blocker, and "not configured"
// (a form to fill in) must read differently from "not answering" (an outage).

import { checkRateLimitStoreHealth } from '../src/lib/rate-limit'
import { verifyFactoryLaunch } from '../src/lib/factory-launch'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

async function main() {
  console.log('--- probe ---')
  const health = await checkRateLimitStoreHealth()
  assert(['ok', 'not_configured', 'unreachable'].includes(health.state), 'the probe returns a known state')

  if (health.state === 'not_configured') {
    assert(health.missing.length > 0, 'it names which variables are missing')
    assert(health.missing.every((name) => name.startsWith('UPSTASH_')), 'it names variables, never values')
  }
  if (health.state === 'unreachable') {
    assert(!/http|token|secret|password/i.test(health.message), 'the outage message carries no credentials or URLs')
  }

  console.log('--- it appears as a required launch check ---')
  const { prisma } = await import('../src/lib/prisma')
  const stamp = Date.now()
  const business = await prisma.business.create({
    data: {
      name: 'Readiness Shop', slug: `readiness-${stamp}`, timezone: 'America/Los_Angeles',
      bookingPolicy: '24h notice', cancellationPolicy: 'Free up to 24h before', onboardingCompleted: true,
    },
  })
  const report = await verifyFactoryLaunch(business.id)
  const check = report.checks.find((c) => c.key === 'rate-limit-store')
  assert(Boolean(check), 'the sign-in protection store is a launch check')
  assert(check!.required === true, 'it is required, not advisory')
  assert(check!.secret === true, 'it is treated as a secret-bearing check')
  assert(check!.status === (health.state === 'ok' ? 'PASS' : 'BLOCKED'), `its status follows the probe (${health.state})`)
  if (health.state !== 'ok') {
    assert(report.overall !== 'READY', 'readiness cannot report READY while sign-in is impossible')
  }
  assert(!/UPSTASH_REDIS_REST_TOKEN=|token:/.test(check!.detail), 'the detail never prints a secret value')

  await prisma.business.delete({ where: { id: business.id } })
  console.log(`\nRate limit store health tests: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); process.exit(1) })

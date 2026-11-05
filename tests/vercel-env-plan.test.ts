/**
 * Planning a Vercel environment sync is the part that must be right, and it is the part
 * that can be tested without a Vercel account.
 *
 * The scenarios below are the ones the directive names: a project with no variables, one
 * with some, one with all, values assigned to the wrong environment, and existing secrets
 * that must survive a rerun. The remote side is described as fixture data, so these tests
 * never touch the network and never need a token.
 *
 * Run: npx tsx tests/vercel-env-plan.test.ts
 */

import { ENV_REGISTRY } from '../src/lib/env-registry'
import { describePlan, planVercelSync, type RemoteVar } from '../src/lib/vercel-env-plan'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}

const REQUIRED_IN_PROD = ENV_REGISTRY.filter((s) => s.requiredIn.includes('production'))
const names = (plan: ReturnType<typeof planVercelSync>, kind: string) =>
  plan.actions.filter((a) => a.kind === kind).map((a) => a.name)

/** A local environment that holds a value for every required variable. */
const localWithEverything: Record<string, string> = Object.fromEntries(
  REQUIRED_IN_PROD.map((s) => [s.name, s.format === 'url' ? 'https://example.com' : 'x'.repeat(40)]),
)

console.log('\n📦 A brand new project with no variables at all')
{
  const plan = planVercelSync({ specs: REQUIRED_IN_PROD, remote: [], local: localWithEverything })
  assert(names(plan, 'ADD').length === REQUIRED_IN_PROD.length, `every required variable is proposed for adding (${REQUIRED_IN_PROD.length})`)
  assert(plan.clean === false, 'the plan is not clean')
  assert(plan.needsValue.length === 0, 'and needs no further input because values are available')
  const adds = plan.actions.filter((a) => a.kind === "ADD") as Array<{ name: string; targets: string[] }>
  assert(adds.every((a) => a.targets.includes('production') && a.targets.includes('preview')), 'each add covers Production and Preview, not just one')
  assert(adds.every((a) => a.name !== 'OWNER_PROVISIONING_TOKEN'), 'a retired variable is never proposed')
}

console.log('\n📦 No values available: asks for them instead of inventing any')
{
  const plan = planVercelSync({ specs: REQUIRED_IN_PROD, remote: [], local: {} })
  assert(plan.needsValue.length === REQUIRED_IN_PROD.length, 'every missing value is requested from the operator')
  assert(names(plan, 'ADD').length === REQUIRED_IN_PROD.length, 'and still listed as work to do')
}

console.log('\n📦 An existing project with some variables')
{
  const present = REQUIRED_IN_PROD.slice(0, 2).map<RemoteVar>((s) => ({ key: s.name, targets: ['production', 'preview'] }))
  const plan = planVercelSync({ specs: REQUIRED_IN_PROD, remote: present, local: localWithEverything })
  assert(names(plan, 'PRESERVE').length === 2, 'the two that exist are preserved, not rewritten')
  assert(names(plan, 'ADD').length === REQUIRED_IN_PROD.length - 2, 'the rest are added')
  const preserve = plan.actions.filter((a) => a.kind === 'PRESERVE') as Array<{ reason: string }>
  assert(preserve.every((a) => /never overwritten/.test(a.reason)), 'and the reason states that loudly')
}

console.log('\n📦 A project that has everything already')
{
  const all = REQUIRED_IN_PROD.map<RemoteVar>((s) => ({ key: s.name, targets: ['production', 'preview'] }))
  const plan = planVercelSync({ specs: REQUIRED_IN_PROD, remote: all, local: {} })
  assert(plan.clean === true, 'the plan is clean, so a rerun writes nothing')
  assert(names(plan, 'PRESERVE').length === REQUIRED_IN_PROD.length, 'every variable is preserved')
  assert(plan.needsValue.length === 0, 'and nothing is demanded, because nothing needs writing')
}

console.log('\n📦 A variable assigned to the wrong environment')
{
  const redis = REQUIRED_IN_PROD.filter((s) => s.name === 'UPSTASH_REDIS_REST_TOKEN')
  const remote: RemoteVar[] = [{ key: 'UPSTASH_REDIS_REST_TOKEN', targets: ['production'] }]
  const plan = planVercelSync({ specs: redis, remote, local: { UPSTASH_REDIS_REST_TOKEN: 'abc' } })
  const fix = plan.actions.find((a) => a.name === 'UPSTASH_REDIS_REST_TOKEN')
  assert(fix?.kind === 'ADD_TARGET', 'a Production-only variable is reported as needing Preview')
  assert(fix?.kind === 'ADD_TARGET' && fix.targets.join() === 'preview', 'and only the missing target is listed')
  assert(/not assigned to preview/.test(fix?.kind === 'ADD_TARGET' ? fix.reason : ''), 'the reason names the missing environment')
}

console.log('\n📦 Optional integrations are not forced on anyone')
{
  const plan = planVercelSync({ specs: ENV_REGISTRY, remote: [], local: {} })
  const added = names(plan, 'ADD')
  for (const optional of ['STRIPE_SECRET_KEY', 'SMTP_HOST', 'TWILIO_AUTH_TOKEN', 'GBP_ACCESS_TOKEN']) {
    assert(!added.includes(optional), `${optional} is not added to a deployment that did not ask for it`)
  }
  assert(!added.includes('DATABASE_ADMIN_URL'), 'the operator-only database credential is never pushed to a shop')
  assert(!added.includes('QA_LOGIN_PASSWORD'), 'and neither is the internal QA password')
}

console.log('\n📦 The summary never prints a value')
{
  const plan = planVercelSync({ specs: REQUIRED_IN_PROD, remote: [], local: { DATABASE_URL: 'postgresql://user:hunter2@host/db' } })
  const text = describePlan(plan).join('\n')
  assert(!text.includes('hunter2'), 'a password inside a URL never appears in the report')
  assert(text.includes('DATABASE_URL'), 'but the variable name does')
  assert(!text.includes('x'.repeat(20)), 'no value of any kind is echoed')
}

console.log('\n📦 Idempotence: planning twice changes nothing')
{
  const all = REQUIRED_IN_PROD.map<RemoteVar>((s) => ({ key: s.name, targets: ['production', 'preview'] }))
  const first = planVercelSync({ specs: REQUIRED_IN_PROD, remote: all, local: localWithEverything })
  const second = planVercelSync({ specs: REQUIRED_IN_PROD, remote: all, local: localWithEverything })
  assert(first.clean && second.clean, 'both runs are clean')
  assert(JSON.stringify(first.actions) === JSON.stringify(second.actions), 'and produce identical plans')
}

console.log(`\nVercel env plan: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1

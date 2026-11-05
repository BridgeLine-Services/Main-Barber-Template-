/**
 * The registry must describe the application as it actually behaves.
 *
 * It did not. `OWNER_REGISTRATION_MODE` advertised open/owner-only/closed while
 * src/lib/owner-registration.ts reads onboarding/invite_only/disabled and treats
 * anything else as `disabled` — so an operator who followed the registry and set
 * `open` would close first-owner registration on a brand new deployment and then be
 * unable to get into the shop at all. `APP_MODE` advertised template/client/development
 * while src/lib/app-config.ts reads production/prod/demo.
 *
 * These tests compare the two directly, and run the application's own parser rather
 * than restating its rules.
 *
 * Run: npx tsx tests/env-enum-contract.test.ts
 */

import { execFileSync } from 'node:child_process'
import { ENV_REGISTRY, evaluateVar } from '../src/lib/env-registry'
import {
  OWNER_REGISTRATION_MODES,
  isCustomerRegistrationOpen,
  isOwnerRegistrationOpen,
  parseOwnerRegistrationMode,
} from '../src/lib/owner-registration'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}

function spec(name: string) {
  const found = ENV_REGISTRY.find((s) => s.name === name)
  if (!found) throw new Error(`${name} is not in the registry`)
  return found
}

function childMode(value: string): string {
  const out = execFileSync(
    'npx',
    ['tsx', '-e', "import { appConfig } from './src/lib/app-config'; console.log(appConfig.mode)"],
    { env: { ...process.env, APP_MODE: value }, encoding: 'utf8' },
  )
  return out.trim().split('\n').pop() ?? ''
}

console.log('\n📦 OWNER_REGISTRATION_MODE: the registry and the application agree')
{
  const values = spec('OWNER_REGISTRATION_MODE').enumValues ?? []
  assert(
    JSON.stringify([...values].sort()) === JSON.stringify([...OWNER_REGISTRATION_MODES].sort()),
    `registry enumValues are exactly the application's accepted values (${values.join(', ')})`,
  )
  for (const value of values) {
    assert(
      parseOwnerRegistrationMode(value) === value,
      `"${value}" is understood, not silently interpreted as disabled`,
    )
    const evaluation = evaluateVar(spec('OWNER_REGISTRATION_MODE'), { env: { OWNER_REGISTRATION_MODE: value } })
    assert(evaluation.status === 'CONFIGURED', `"${value}" passes registry validation`)
  }
  assert(
    parseOwnerRegistrationMode('open') === 'disabled',
    'the value the registry used to advertise ("open") is NOT accepted — proof the old documentation was harmful',
  )
  assert(!values.includes('open'), 'and the registry no longer advertises it')
  assert(
    isOwnerRegistrationOpen(undefined, false),
    'an unset value still admits the first owner on a fresh deployment',
  )
  assert(isCustomerRegistrationOpen(undefined), 'and still admits customers')
}

console.log('\n📦 APP_MODE: every advertised value is a value the application reads')
{
  const values = spec('APP_MODE').enumValues ?? []
  for (const value of values) {
    const effective = childMode(value)
    const expected = value === 'demo' ? 'demo' : 'production'
    assert(effective === expected, `APP_MODE=${value} behaves as ${expected} (got ${effective})`)
    const evaluation = evaluateVar(spec('APP_MODE'), { env: { APP_MODE: value } })
    assert(evaluation.status === 'CONFIGURED', `"${value}" passes registry validation`)
  }
  assert(
    childMode('template') === 'production',
    'the "template" value the registry used to advertise is unknown to the application and falls back to production',
  )
  assert(!values.includes('template') && !values.includes('client'), 'the registry no longer advertises dead values')
  assert(
    spec('APP_MODE').requiredIn.length === 0,
    'APP_MODE is optional: unset means production behaviour, which is what a shop must run',
  )
}

console.log('\n📦 An invalid value is reported, never quietly accepted')
{
  const bogus = evaluateVar(spec('OWNER_REGISTRATION_MODE'), { env: { OWNER_REGISTRATION_MODE: 'whatever' } })
  assert(bogus.status === 'INVALID', 'an unrecognised OWNER_REGISTRATION_MODE is INVALID')
  const spaces = evaluateVar(spec('OWNER_REGISTRATION_MODE'), { env: { OWNER_REGISTRATION_MODE: '   ' } })
  assert(spaces.status !== 'CONFIGURED', 'a whitespace-only value is not configuration')
}

console.log(`\nENV enum contract: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1

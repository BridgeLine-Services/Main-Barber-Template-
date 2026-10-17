import assert from 'node:assert/strict'
import {
  isOwnerRegistrationOpen,
  parseOwnerRegistrationMode,
} from '../src/lib/owner-registration'

const cases = [
  ['onboarding', false, true],
  ['onboarding', true, false],
  ['invite_only', false, false],
  ['disabled', false, false],
  [undefined, false, true],
  ['bogus', false, false],
] as const

for (const [mode, hasOwner, expected] of cases) {
  assert.equal(isOwnerRegistrationOpen(mode ?? null, hasOwner), expected, `${mode ?? 'undefined'}:${hasOwner} => ${expected}`)
}

assert.equal(parseOwnerRegistrationMode('onboarding'), 'onboarding')
assert.equal(parseOwnerRegistrationMode('invite_only'), 'invite_only')
assert.equal(parseOwnerRegistrationMode('disabled'), 'disabled')
assert.equal(parseOwnerRegistrationMode('unknown'), 'disabled')
assert.equal(parseOwnerRegistrationMode(undefined), 'onboarding')

console.log('owner registration mode checks passed')

// Security policy switches (REQUIRE_OWNER_2FA).
//
// The point of these tests is that a policy switch can never lock an owner out:
// it may only send them somewhere they can satisfy it.

import {
  isOwnerTwoFactorRequired,
  needsTwoFactorEnrolment,
  REQUIRE_OWNER_2FA_ENV,
} from '../src/lib/security-policy'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const base = { role: 'OWNER', twoFactorEnabled: false, pathname: '/dashboard', policyEnabled: true }

console.log('--- the switch itself ---')
assert(isOwnerTwoFactorRequired({ [REQUIRE_OWNER_2FA_ENV]: 'true' }), 'the policy is on only when set to true')
assert(!isOwnerTwoFactorRequired({}), 'absent means off')
assert(!isOwnerTwoFactorRequired({ [REQUIRE_OWNER_2FA_ENV]: '1' }), 'only the literal "true" enables it')
assert(!isOwnerTwoFactorRequired({ [REQUIRE_OWNER_2FA_ENV]: 'false' }), '"false" leaves it off')

console.log('--- who is covered ---')
assert(needsTwoFactorEnrolment(base), 'an owner without 2FA is sent to enrol when the policy is on')
assert(needsTwoFactorEnrolment({ ...base, role: 'BUSINESS_ADMIN' }), 'a co-owner is covered too')
assert(!needsTwoFactorEnrolment({ ...base, role: 'BARBER' }), 'barbers are not covered')
assert(!needsTwoFactorEnrolment({ ...base, role: 'PLATFORM_OWNER' }), 'platform owners are not covered')
assert(!needsTwoFactorEnrolment({ ...base, twoFactorEnabled: true }), 'an enrolled owner continues normally')
assert(!needsTwoFactorEnrolment({ ...base, policyEnabled: false }), 'with the policy off nothing changes')
assert(needsTwoFactorEnrolment({ ...base, role: 'owner' }), 'lowercase roles are handled (an owner is an owner)')

console.log('--- no dead ends ---')
const exempt = [
  '/dashboard/settings',
  '/dashboard/settings?tab=security',
  '/change-password',
  '/api/dashboard/settings',
  '/api/dashboard/security/2fa',
]
for (const pathname of exempt) {
  assert(!needsTwoFactorEnrolment({ ...base, pathname }), `requests to ${pathname} are never redirected (the owner can always satisfy the policy)`)
}

console.log(`\nSecurity policy tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

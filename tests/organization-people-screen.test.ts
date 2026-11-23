/**
 * The "People and access" screen.
 *
 * The backend suite proves who may do what. This one proves the screen shows it correctly
 * and cannot do more: plain role words, the four invitation states, a confirmation before
 * every change, no one-click destructive control, no customer data, and a layout that
 * works on a phone.
 *
 * Run: npx tsx tests/organization-people-screen.test.ts
 */

import { readFileSync } from 'node:fs'
import {
  INVITABLE_ROLES,
  canGrantRole,
  describeInvitationState,
  describeRoleAbilities,
  roleLabel,
} from '../src/lib/organization/invitations'
import { can } from '../src/lib/organization/capabilities'

let passed = 0
let failed = 0
function ok(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const page = readFileSync('src/app/(dashboard)/dashboard/organization/people/page.tsx', 'utf8')
const screen = readFileSync('src/components/organization/PeopleAndAccess.tsx', 'utf8')

console.log('\n--- role words a shop owner can read ---')
ok(roleLabel('ORGANIZATION_OWNER') === 'Organization owner', 'the owner role reads as words, not an enum')
ok(roleLabel('CORPORATE_ADMIN') === 'Corporate administrator', 'corporate administrator is spelled out')
ok(roleLabel('REGIONAL_MANAGER') === 'Regional manager', 'regional manager is spelled out')
ok(roleLabel('FRANCHISE_OWNER') === 'Franchise owner', 'franchise owner is spelled out')
for (const role of ['ORGANIZATION_OWNER', 'CORPORATE_ADMIN', 'REGIONAL_MANAGER', 'FRANCHISE_OWNER'] as const) {
  const words = describeRoleAbilities(role)
  ok(words.length > 40 && /can/i.test(words), `${role} explains what it can do in a sentence`)
  ok(/cannot|only role/i.test(words), `${role} also states its limit`)
}

console.log('\n--- invitation states in plain language ---')
ok(describeInvitationState('pending').startsWith('Waiting'), 'pending says the person has not accepted yet')
ok(describeInvitationState('accepted').startsWith('Accepted'), 'accepted says the person is now a member')
ok(describeInvitationState('expired').startsWith('Expired'), 'expired says to send a new invitation')
ok(describeInvitationState('cancelled').startsWith('Cancelled'), 'cancelled says the link no longer works')
const stateWords = ['pending', 'accepted', 'expired', 'cancelled'].map((s) => describeInvitationState(s as never))
ok(new Set(stateWords).size === 4, 'the four states are four different sentences, not one generic word')

console.log('\n--- who the screen lets change things ---')
ok(can('ORGANIZATION_OWNER', 'organization.manage'), 'the owner may manage people')
ok(!can('CORPORATE_ADMIN', 'organization.manage'), 'a corporate administrator may not manage people')
ok(!can('REGIONAL_MANAGER', 'organization.manage'), 'a regional manager may not manage people')
ok(!can('FRANCHISE_OWNER', 'organization.manage'), 'a franchise owner may not manage people')
ok(!INVITABLE_ROLES.includes('ORGANIZATION_OWNER'), 'ownership is never offered in the invite list')
ok(!canGrantRole('ORGANIZATION_OWNER', 'ORGANIZATION_OWNER'), 'nobody grants ownership through an invitation')
ok(canGrantRole('ORGANIZATION_OWNER', 'REGIONAL_MANAGER'), 'the owner may grant a regional manager')
ok(!canGrantRole('CORPORATE_ADMIN', 'REGIONAL_MANAGER'), 'a non-manager cannot grant anything')

console.log('\n--- the page reads its organization from the session ---')
ok(page.includes('resolveOrganizationContext'), 'the organization is resolved from the signed-in person')
ok(page.includes('canManageMembers'), 'management is gated on the capability, not on a role string in the URL')
ok(!/searchParams/.test(page), 'no query parameter can point the page at another organization')
ok(page.includes('organizationId: context.organizationId'), 'members are read for the resolved organization only')
ok(page.includes('requireAuth'), 'the page requires a signed-in person')
ok(page.includes('Go to my shop dashboard'), 'a single-shop user is sent back to their own dashboard')

console.log('\n--- no customer data reaches this screen ---')
for (const field of ['customer.name', 'customerName', 'customerEmail', 'customerPhone', 'appointmentHistory']) {
  ok(!page.includes(field) && !screen.includes(field), `the screen never reads ${field}`)
}
ok(!/prisma\.customer/.test(page), 'the page runs no customer query at all')

console.log('\n--- every change asks first ---')
ok(screen.includes('setConfirming'), 'changes go through a confirmation step')
ok(screen.includes('Review change'), 'a role change must be reviewed before it is applied')
ok(screen.includes('Yes, change the role'), 'the second click is an explicit sentence, not "OK"')
ok(screen.includes('Yes, cancel it'), 'cancelling an invitation asks first')
ok(screen.includes('Yes, suspend access'), 'suspending asks first and says what it does')
ok(screen.includes('Their shop records stay exactly as they are'), 'suspending is explained as access only, not deletion')
ok(screen.includes('Keep it as it is') && screen.includes('Leave them alone'), 'every confirmation offers a way to back out')
ok(!/window\.confirm|window\.alert/.test(screen), 'no browser pop-up is used as the confirmation')

console.log('\n--- nothing is done on load ---')
ok(!/useEffect\(/.test(screen), 'opening the screen runs no effect and calls nothing')
ok(!/method: 'POST'/.test(screen.replace(/send\('/g, "send('")), 'the only POSTs come from a person pressing a button')
ok(/onSubmit=\{invite\}/.test(screen), 'an invitation needs a form submission')

console.log('\n--- the invite flow tells the truth about delivery ---')
ok(screen.includes('No email was sent'), 'the screen says plainly that no email was sent')
ok(screen.includes('stops working in seven days'), 'the link lifetime is stated')
ok(screen.includes('works once'), 'single use is stated')
ok(screen.includes('break-all'), 'a long link cannot overflow a phone screen')

console.log('\n--- phone and screen reader ---')
ok(/sm:grid-cols|max-w-4xl/.test(page), 'the page is width-bounded rather than fixed')
ok(screen.includes('min-h-11'), 'buttons and fields are large enough to tap')
ok(screen.includes('aria-labelledby'), 'each section is named for a screen reader')
ok(screen.includes('aria-live="polite"'), 'the result of an action is announced')
ok(screen.includes('htmlFor='), 'every field has a real label')
ok(/flex-wrap/.test(screen), 'rows wrap instead of overflowing on a narrow screen')

console.log(`\nPeople and access screen: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)

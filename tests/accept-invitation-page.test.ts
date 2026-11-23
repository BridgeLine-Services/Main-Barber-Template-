/**
 * The page an invitation link lands on.
 *
 * It carries no authorization of its own: the server decides, from the token and the
 * signed-in email. What this checks is that the page does not quietly decide for it, and
 * that the words a person sees are usable when the link is wrong, expired or forwarded.
 *
 * Run: npx tsx tests/accept-invitation-page.test.ts
 */
import { readFileSync } from 'node:fs'

const page = readFileSync('src/app/accept-organization-invitation/page.tsx', 'utf8')
const route = readFileSync('src/app/api/auth/accept-organization-invitation/route.ts', 'utf8')
const lib = readFileSync('src/lib/organization/invitations.ts', 'utf8')

let passed = 0
let failed = 0
function ok(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

console.log('--- the page asks, it does not decide ---')
ok(page.includes("fetch('/api/auth/accept-organization-invitation'"), 'acceptance goes through the server route')
ok(/onClick=\{accept\}/.test(page), 'accepting needs a press, not a page load')
ok(!/useEffect\([^)]*accept\(/.test(page), 'the effect never accepts on its own')
ok(!/organizationId/.test(page), 'the page never sends an organization id')

console.log('--- the server is the authority ---')
ok(route.includes('requireAuth()'), 'the route needs a signed-in person')
ok(route.includes('userEmail: auth.user.email'), 'the invited address comes from the session')
ok(lib.includes('normaliseEmail(invitation.email) !== normaliseEmail(userEmail)') || /wrong-email/.test(lib), 'a mismatch is refused by email, not by hope')
ok(/acceptedAt: null|acceptedAt: row\.acceptedAt/.test(lib) || lib.includes('single-use'), 'single use is enforced in the store')

console.log('--- the words a person sees ---')
ok(page.includes('missing its invitation code'), 'an incomplete link is explained')
ok(page.includes('It may have expired'), 'an expired invitation is explained')
ok(page.includes('Sign in with the invited address'), 'a forwarded link offers the right way out')
ok(page.includes('Your own shop and its records are unchanged'), 'accepting says what it did not change')

console.log('--- usable on a phone ---')
ok(/min-h-11/.test(page), 'the control is a comfortable touch target')
ok(/max-w-lg/.test(page) && /px-4/.test(page), 'the layout fits a narrow screen')
ok(/role="status"/.test(page), 'the result is announced to a screen reader')

console.log(`\nAccept invitation page: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)

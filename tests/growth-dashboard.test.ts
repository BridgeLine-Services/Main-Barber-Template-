/**
 * The growth screens: referrals on the existing Growth page, and one barber's numbers.
 *
 * The rule under test is the one that matters to a shop owner reading a number: an
 * unknown is never shown as zero, and every figure says what it means.
 *
 * Run: npx tsx tests/growth-dashboard.test.ts
 */

import { readFileSync } from 'node:fs'
import {
  UNKNOWN,
  answerRows,
  describeProgramState,
  formatCount,
  formatMoney,
  formatPercent,
  referralEmptyState,
  referralMetricRows,
  revenueRows,
  whatTheProgramDoes,
} from '../src/lib/growth/dashboard-view'
import { summariseReferrals, type ReferralRow } from '../src/lib/growth/referrals'

let passed = 0
let failed = 0
function ok(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const growthPage = readFileSync('src/app/(dashboard)/dashboard/growth/page.tsx', 'utf8')
const performancePage = readFileSync('src/app/(dashboard)/dashboard/growth/performance/page.tsx', 'utf8')

console.log('\n--- an unknown is never zero ---')
ok(formatMoney(null) === UNKNOWN, 'unknown money says so')
ok(formatMoney(0) === '$0.00', 'real zero is still zero')
ok(formatCount(null) === UNKNOWN, 'unknown count says so')
ok(formatPercent(null) === UNKNOWN, 'unknown percent says so')
ok(!/^0/.test(formatMoney(null)), 'unknown money does not begin with a zero')

console.log('\n--- the program state is never assumed ---')
const off = describeProgramState(false)
const on = describeProgramState(true)
const unread = describeProgramState(null)
ok(off.label === 'Off' && on.label === 'On', 'on and off are stated plainly')
ok(unread.label === UNKNOWN && unread.unknown, 'an unread program state is unknown, not off')
ok(/Nothing has been changed/i.test(unread.meaning), 'and it says nothing was changed')
ok(/Existing codes and past results stay/i.test(off.meaning), 'turning it off does not imply deletion')
ok(/does not change any existing booking/i.test(whatTheProgramDoes()), 'enabling explains what it will do first')

console.log('\n--- referral metrics carry meaning ---')
const metrics = summariseReferrals([
  { customerId: 'c1', referrerCustomerId: 'r1', source: 'link', revenueCents: 4500, bookings: 2 },
  { customerId: 'c2', referrerCustomerId: 'r1', source: 'link', revenueCents: 2000, bookings: 0 },
], 100000)
const rows = referralMetricRows(metrics)
ok(rows.length === 6, 'six figures are shown')
ok(rows.every((row) => row.meaning.length > 10), 'every figure explains what it means')
ok(rows.some((row) => row.id === 'revenue' && row.value === '$65.00'), 'revenue is the real total')
const partial = summariseReferrals([
  { customerId: 'c1', referrerCustomerId: 'r1', source: 'link', revenueCents: null, bookings: 1 },
], 100000)
const partialRevenue = referralMetricRows(partial).find((row) => row.id === 'revenue')!
ok(partialRevenue.unknown && partialRevenue.value === UNKNOWN, 'a partially unknown revenue is unknown, never a smaller sum')

console.log('\n--- empty states explain what to do next ---')
const empty = summariseReferrals([], 0)
ok(/No referrals yet/.test(referralEmptyState(true, empty)), 'an empty program that is on says so')
ok(/Turn it on when you are ready/.test(referralEmptyState(false, empty)), 'an empty program that is off says what to do')
ok(/could not read/i.test(referralEmptyState(null, empty)), 'an unreadable result is not called empty')

console.log('\n--- money, without a profit figure ---')
const revenue = revenueRows({
  grossCents: 10000, refundsCents: 1000, netCents: 9000, tipsCents: null, commissionsCents: 3000,
  recordedExpensesCents: null, labels: {}, note: 'x',
})
ok(revenue.some((row) => row.id === 'net' && row.label === 'Money after refunds'), 'net is labelled in plain words')
ok(revenue.find((row) => row.id === 'tips')!.unknown, 'unknown tips are not zero')
ok(revenue.find((row) => row.id === 'expenses')!.value === UNKNOWN, 'expenses are unknown, not zero')
ok(!revenue.some((row) => /profit/i.test(row.label)), 'no profit row exists')
ok(/No profit figure is shown/i.test(performancePage), 'the page says why no profit is shown')

console.log('\n--- answers stay honest ---')
const answers = answerRows({
  answers: [
    { id: 'a', question: 'Money taken?', answer: '$120.00', value: 12000, unit: 'money', basis: 'From payments', unknown: false },
    { id: 'b', question: 'Quietest day?', answer: null, value: null, unit: 'time', basis: 'Not enough bookings', unknown: true },
  ],
  revenue: { grossCents: null, refundsCents: null, netCents: null, tipsCents: null, commissionsCents: null, recordedExpensesCents: null, labels: {}, note: '' },
  notes: [],
  allRead: false,
})
ok(answers[0].answer === '$120.00' && !answers[0].unknown, 'a known answer is shown as given')
ok(answers[1].unknown && answers[1].answer.includes(UNKNOWN), 'an unknown answer says it is unknown')
ok(answers[1].answer.includes('Not enough bookings'), 'and it says how it was worked out')

console.log('\n--- permissions are enforced on the page, not only the API ---')
ok(/user\.role === 'CUSTOMER'/.test(performancePage) && /redirect\('\/dashboard'\)/.test(performancePage), 'a customer is sent away')
ok(/requested !== user\.barberId/.test(performancePage), 'a barber is pinned to their own profile')
ok(/You can only see your own numbers/.test(performancePage), 'and told so in plain words')
ok(/businessId \}/.test(performancePage) && /id: requested, businessId/.test(performancePage), 'a barber id is proven to belong to this shop')
ok(/That barber is not one of yours/.test(performancePage), 'another shop’s barber is refused, not shown')
ok(/where: \{ businessId, barberId/.test(performancePage), 'every query is scoped to the shop and the barber')
ok(!/customerName|customerEmail|customerPhone/.test(performancePage), 'no customer identity is read or shown')
ok(!/profit/i.test(performancePage.split('No profit figure is shown')[0] ?? ''), 'no profit figure appears before the disclaimer')

console.log('\n--- read-only, and nothing runs on load ---')
ok(!/prisma\.[a-zA-Z]+\.(create|update|delete|upsert)/.test(performancePage), 'the performance page writes nothing')
ok(!/prisma\.[a-zA-Z]+\.(create|update|delete|upsert)/.test(growthPage), 'the growth page writes nothing')
ok(!/use client/.test(performancePage), 'the performance page is a server component')
ok(!/enabled:\s*true|enabled:\s*false/.test(growthPage), 'the growth page never sets the program flag itself')
ok(/referrals screen/.test(growthPage), 'and it says where turning it on lives')

console.log('\n--- mobile and accessibility ---')
ok(/sm:grid-cols-2/.test(performancePage) && /lg:grid-cols-3/.test(performancePage), 'the layout stacks on a phone and spreads on a desktop')
ok(/sm:grid-cols-2/.test(growthPage), 'the referral figures do the same')
ok(/min-h-11/.test(performancePage), 'controls are big enough to tap')
ok(/aria-current/.test(performancePage), 'the chosen period is announced')
ok(/aria-labelledby/.test(performancePage) && /aria-labelledby/.test(growthPage), 'each section is labelled for a screen reader')
ok(/<dl/.test(performancePage) && /<dt/.test(performancePage) && /<dd/.test(performancePage), 'figures use description-list semantics')
ok(!/w-\[9[0-9][0-9]px\]|min-w-\[9[0-9][0-9]px\]/.test(performancePage), 'nothing is pinned to a desktop width')

console.log(`\nGrowth dashboard: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)

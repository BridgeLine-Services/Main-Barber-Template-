/**
 * Priority 5: referral attribution and a barber's own growth numbers.
 *
 * The two things this suite protects are the ones that go wrong quietly: counting the same
 * customer twice, and turning "could not read" into a zero that looks like a fact.
 */

import { buildReferralCode, decideAttribution, normaliseReferralCode, parseReferralParams, referralLink, summariseReferrals } from '../src/lib/growth/referrals'
import { buildBarberAnalytics, type AppointmentFact, type PaymentFact, type ReferralFact, type ScheduleFact } from '../src/lib/growth/barber-analytics'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; return }
  failed++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

// ─── Codes and links ───────────────────────────────────────────────────────

ok('a code is uppercased', normaliseReferralCode('ab-12') === 'AB12')
ok('spaces and symbols are stripped', normaliseReferralCode(' a b!c ') === 'ABC')
ok('an empty code stays empty', normaliseReferralCode(null) === '')
ok('a code is capped in length', normaliseReferralCode('ABCDEFGHIJKLMNOP') === 'ABCDEFGHIJKL')
ok('ambiguous characters are never generated', !/[IO01]/.test(buildReferralCode('REF', 'customer-1').slice(3)))
ok('a code is stable for the same customer', buildReferralCode('REF', 'c1') === buildReferralCode('REF', 'c1'))
ok('a different customer gets a different code', buildReferralCode('REF', 'c1') !== buildReferralCode('REF', 'c2'))
ok('an attempt salt changes the code', buildReferralCode('REF', 'c1', 1) !== buildReferralCode('REF', 'c1', 0))
ok('the prefix is kept', buildReferralCode('shop', 'c1').startsWith('SHOP'))
ok('an empty prefix falls back to REF', buildReferralCode('', 'c1').startsWith('REF'))

ok('a link carries the code', referralLink('https://shop.example/book', 'ab12').includes('ref=AB12'))
ok('a link keeps its existing query', referralLink('https://shop.example/book?x=1', 'AB12').includes('x=1'))
ok('an empty code leaves the link alone', referralLink('https://shop.example/book', '') === 'https://shop.example/book')

const parsed = parseReferralParams(new URLSearchParams('ref=ab-12&source=Instagram!&campaign=fall'))
ok('a referral parameter is read and normalised', parsed.code === 'AB12')
ok('a source is lowercased and cleaned', parsed.source === 'instagram')
ok('a campaign is carried', parsed.campaign === 'fall')
ok('a missing parameter is null, not a guess', parseReferralParams(new URLSearchParams('')).code === '')
const hostile = parseReferralParams(new URLSearchParams('ref=%3Cscript%3E&source=../../Instagram%3F&campaign=%3Cimg%20src=x%20onerror=alert(1)%3E'))
ok('hostile referral text cannot become executable markup', !/[<>]/.test(hostile.code) && !/[<>]/.test(hostile.campaign ?? ''))
ok('hostile source text is reduced to the safe source alphabet', hostile.source === 'instagram')

// ─── Attribution ───────────────────────────────────────────────────────────

const base = {
  businessId: 'b1', customerId: 'new-1', existing: null, referrerCustomerId: 'ref-1',
  code: 'REFABC', source: null, campaign: null, appointmentId: 'a1', isFirstVisit: true,
}
const attributed = decideAttribution(base)
ok('a code on a first visit is attributed', attributed.attribute === true)
ok('the attribution records the referrer', attributed.record?.referrerCustomerId === 'ref-1')
ok('the attribution explains itself', /first visit/i.test(attributed.reason))

ok('a second attribution is refused', decideAttribution({ ...base, existing: { customerId: 'new-1', referrerCustomerId: 'ref-1' } }).attribute === false)
ok('the refusal names double counting', /double counting/i.test(decideAttribution({ ...base, existing: { customerId: 'new-1', referrerCustomerId: 'ref-1' } }).reason))
ok('self referral is refused', decideAttribution({ ...base, referrerCustomerId: 'new-1' }).attribute === false)
ok('a returning visit is not attributed', decideAttribution({ ...base, isFirstVisit: false }).attribute === false)
ok('no code and no source means nothing to attribute', decideAttribution({ ...base, code: null, referrerCustomerId: null, source: null }).attribute === false)
const sourceOnly = decideAttribution({ ...base, code: null, referrerCustomerId: null, source: 'instagram' })
ok('a marketing source alone is attributed', sourceOnly.attribute === true)
ok('a source-only attribution records no referrer', sourceOnly.record?.referrerCustomerId === null)

// ─── Referral summary ──────────────────────────────────────────────────────

const unknownSummary = summariseReferrals(null, null)
ok('an unreadable referral list says so', /could not be read/i.test(unknownSummary.note))
ok('an unreadable referral list has no rate', unknownSummary.conversionRate === null)

const rows = [
  { customerId: 'c1', referrerCustomerId: 'r1', source: null, campaign: 'summer', revenueCents: 5000, bookings: 2 },
  { customerId: 'c2', referrerCustomerId: 'r2', source: null, campaign: 'summer', revenueCents: 3000, bookings: 1 },
  { customerId: 'c3', referrerCustomerId: null, source: 'instagram', revenueCents: 2000, bookings: 0 },
]
const summary = summariseReferrals(rows, 100000)
ok('every referred customer is counted', summary.referredCustomers === 3)
ok('converted counts only customers who booked', summary.converted === 2)
ok('completed bookings are counted separately from customers', summary.completedBookings === 3)
ok('the conversion rate is a percentage', summary.conversionRate === 66.7)
ok('repeat bookings count bookings after the first', summary.repeatBookings === 1)
ok('campaign customers are grouped', summary.byCampaign[0].campaign === 'summer' && summary.byCampaign[0].customers === 2)
ok('referral revenue is summed', summary.referralRevenueCents === 10000)
ok('the share of total revenue is a percentage', summary.shareOfRevenuePercent === 10)
ok('customer referrals are named as a channel', summary.byChannel[0].channel === 'Customer referral')
ok('the largest channel comes first', summary.byChannel[0].customers === 2)

const partial = summariseReferrals([{ ...rows[0], revenueCents: null }], 100000)
ok('one unknown revenue makes the total unknown', partial.referralRevenueCents === null)
ok('the unknown total is explained', /unknown/i.test(partial.note))
ok('an unknown total has no share', partial.shareOfRevenuePercent === null)

// ─── Barber analytics ──────────────────────────────────────────────────────

const at = (day: number, hour: number) => new Date(2026, 10, 1 + day, hour, 0, 0)
const appointments: AppointmentFact[] = [
  { id: 'a1', startTime: at(2, 10), status: 'COMPLETED', serviceName: 'Skin fade', servicePriceCents: 4000, source: 'WALK_IN', customerId: 'c1' },
  { id: 'a2', startTime: at(2, 12), status: 'COMPLETED', serviceName: 'Skin fade', servicePriceCents: 4000, source: 'WALK_IN', customerId: 'c1' },
  { id: 'a3', startTime: at(3, 11), status: 'COMPLETED', serviceName: 'Beard trim', servicePriceCents: 2000, source: 'INSTAGRAM', customerId: 'c2' },
  { id: 'a4', startTime: at(4, 15), status: 'CANCELLED', serviceName: 'Beard trim', servicePriceCents: 2000, source: 'WALK_IN', customerId: 'c3' },
  { id: 'a5', startTime: at(5, 16), status: 'NO_SHOW', serviceName: 'Cut', servicePriceCents: null, source: 'WALK_IN', customerId: 'c4' },
]
const payments: PaymentFact[] = [{ grossCents: 10000, refundCents: 1000, tipCents: 1500, commissionCents: 4000 }]
const referrals: ReferralFact[] = [
  { customerId: 'c2', referrerCustomerId: 'c1', source: null },
  { customerId: 'c3', referrerCustomerId: null, source: 'instagram' },
]
const schedules: ScheduleFact[] = [2, 3, 4, 5, 6].map((day) => ({ dayOfWeek: day, startTime: '09:00', endTime: '18:00', isOff: false }))

const analytics = buildBarberAnalytics({ appointments, payments, referrals, schedules, rangeDays: 30 })
ok('the six list questions are answered, with revenue as the seventh block', analytics.answers.length === 6)
ok('every question has a basis', analytics.answers.every((a) => a.basis.length > 0))
ok('the channel answer names the winning channel', /Customer referral/.test(analytics.answers[0].answer ?? ''))
ok('the services answer names the top earner', /Skin fade/.test(analytics.answers[1].answer ?? ''))
ok('the top service value is its revenue', analytics.answers[1].value === 8000)
ok('returning customers counts repeat visits only', analytics.answers[2].value === 1)
ok('referrals count only customer referrals', analytics.answers[3].value === 1)
ok('the quietest day is a weekday name', /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/.test((analytics.answers[4].answer ?? '').split(' is ')[0]))
ok('the lost-money answer counts cancelled and missed work', analytics.answers[5].value === 2000)
ok('the lost-money basis admits an unpriced appointment', /no recorded price/i.test(analytics.answers[5].basis))
ok('the lost-money answer separates cancellations from no-shows', /1 cancelled, 1 no-show/.test(analytics.answers[5].answer ?? ''))

ok('gross revenue is summed', analytics.revenue.grossCents === 10000)
ok('refunds are summed', analytics.revenue.refundsCents === 1000)
ok('net revenue is gross minus refunds', analytics.revenue.netCents === 9000)
ok('tips are labelled as belonging to the barber', /belong to the barber/i.test(analytics.revenue.labels.tipsCents))
ok('expenses are unknown, not zero', analytics.revenue.recordedExpensesCents === null)
ok('there is no profit figure', !JSON.stringify(analytics).toLowerCase().includes('profitcents":'))
ok('the report says why there is no profit figure', /no profit figure/i.test(analytics.revenue.note))
ok('a fully read report says so', analytics.allRead === true)

const unreadable = buildBarberAnalytics({ appointments: null, payments: null, referrals: null, schedules: null, rangeDays: 30 })
ok('unreadable sources produce unknown answers, not zeros', unreadable.answers.every((a) => a.unknown === true))
ok('unreadable answers have no value', unreadable.answers.every((a) => a.value === null))
ok('an unreadable report is not reported as read', unreadable.allRead === false)
ok('an unreadable report still labels its money rows', Object.keys(unreadable.revenue.labels).length >= 5)
ok('an unreadable report says payments could not be read', /could not be read/i.test(unreadable.revenue.note))

const noSchedules = buildBarberAnalytics({ appointments, payments, referrals, schedules: null, rangeDays: 30 })
ok('a missing schedule leaves only the quiet-time answer unknown', noSchedules.answers.filter((a) => a.unknown).length === 1)
ok('the other answers survive a missing schedule', noSchedules.answers[1].unknown === false)

console.log(`\nGrowth and referrals: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

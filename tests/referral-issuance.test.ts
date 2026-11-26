/**
 * Referral reward issuance (Section 10): the decision that decides whether money moves.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REFERRAL_REWARD_RULE, decideRewardIssuance, sourceKeyFor } from '../src/lib/growth/referral-rewards'

let passed = 0
const failures: string[] = []
function ok(name: string, condition: boolean) {
  if (condition) passed += 1
  else failures.push(name)
}
const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const businessId = 'biz_123456789'
const base = {
  businessId,
  referredCustomerId: 'cust_referred',
  appointmentStatus: 'COMPLETED',
  existingSourceKeys: [] as string[],
}
const referred = { id: 'attr_1', referrerCustomerId: 'cust_referrer' }

const issued = decideRewardIssuance({ ...base, attribution: referred })
ok('a completed referred visit earns the referrer a reward', issued.issue)
ok('the reason says why', /completed their first visit/.test(issued.reason))
ok('the key is the attribution, not the visit', issued.sourceKey === sourceKeyFor(businessId, 'attr_1'))

ok('no attribution means no reward', !decideRewardIssuance({ ...base, attribution: null }).issue)
ok(
  'no attribution says so plainly',
  /not referred/.test(decideRewardIssuance({ ...base, attribution: null }).reason),
)
ok(
  'an attribution with no referrer pays nobody',
  !decideRewardIssuance({ ...base, attribution: { id: 'attr_2', referrerCustomerId: null } }).issue,
)
ok(
  'self referral is refused',
  !decideRewardIssuance({
    ...base,
    attribution: { id: 'attr_3', referrerCustomerId: 'cust_referred' },
  }).issue,
)
ok(
  'a visit that is not completed pays nothing',
  !decideRewardIssuance({ ...base, appointmentStatus: 'CONFIRMED', attribution: referred }).issue,
)
ok(
  'a no-show pays nothing',
  !decideRewardIssuance({ ...base, appointmentStatus: 'NO_SHOW', attribution: referred }).issue,
)
const repeat = decideRewardIssuance({
  ...base,
  attribution: referred,
  existingSourceKeys: [sourceKeyFor(businessId, 'attr_1')],
})
ok('the same referral never pays twice', !repeat.issue)
ok('a repeat is reported as already rewarded', /already been rewarded/.test(repeat.reason))
ok(
  'the key is scoped to the shop, so two shops cannot collide',
  sourceKeyFor('biz_aaaaaaaa1', 'attr_1') !== sourceKeyFor('biz_bbbbbbbb2', 'attr_1'),
)
ok('the rule is fixed and auditable', REFERRAL_REWARD_RULE.amount === 10 && REFERRAL_REWARD_RULE.expiresInDays === 90)

// --- the wiring ---
const route = read('src/app/api/dashboard/appointments/[id]/route.ts')
ok('completion calls the reward path', /issueRewardForCompletedVisit/.test(route))
ok('the reward is granted on COMPLETED', /status === 'COMPLETED'[\s\S]{0,900}issueRewardForCompletedVisit/.test(route))
ok('a reward failure cannot fail the appointment update', /referral reward hook failed/.test(route))

const ledger = read('src/lib/growth/referral-ledger.ts')
ok('every ledger read and write is tenant-bound', (ledger.match(/withTenant\(/g) ?? []).length >= 3)
ok('the ledger records an event when it issues', /type: 'ISSUED'/.test(ledger))
ok('the ledger records an event when it redeems', /type: 'REDEEMED'/.test(ledger))
ok('the ledger records an event when it reverses', /type: 'REVERSED'/.test(ledger))
ok('a concurrent duplicate is caught by the unique key', /P2002/.test(ledger))
ok('no ledger query omits the shop', !/where: \{ id: input\.rewardId \}/.test(ledger))

console.log(`\nReferral issuance: ${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL', f)
if (failures.length > 0) process.exit(1)

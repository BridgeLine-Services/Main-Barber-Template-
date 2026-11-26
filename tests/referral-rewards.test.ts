/**
 * Referral reward lifecycle (Section 10 of the platform brief).
 *
 * The rules that protect money: a reward pays once, an expired or already-redeemed reward
 * cannot be spent, a reversal records whether the value was already used, and the balance
 * the customer sees never includes credit they cannot use.
 */
import {
  availableBalance, canRedeem, computeRewardAmount, describeReward, expire, isExpired,
  redeem, reverse, sourceKeyFor, type RewardState,
} from '../src/lib/growth/referral-rewards'

let pass = 0
let fail = 0
function ok(name: string, condition: boolean) {
  if (condition) pass++
  else {
    fail++
    console.error('  FAIL', name)
  }
}

const NOW = '2026-11-26T12:00:00.000Z'
const base = (over: Partial<RewardState> = {}): RewardState => ({ status: 'ISSUED', amount: 5, expiresAt: null, ...over })

// --- idempotency key ---
const key = sourceKeyFor('shop_a', 'ref_1')
ok('the key is stable for the same event', key === sourceKeyFor('shop_a', 'ref_1'))
ok('the key differs per shop', key !== sourceKeyFor('shop_b', 'ref_1'))
ok('the key differs per referral', key !== sourceKeyFor('shop_a', 'ref_2'))
ok('the key carries the shop prefix', key.startsWith('shop_a:'))
let keyThrew = false
try { sourceKeyFor('', 'ref_1') } catch { keyThrew = true }
ok('a key without a shop is refused', keyThrew)

// --- expiry ---
ok('no expiry never expires', !isExpired(base(), NOW))
ok('a future expiry has not expired', !isExpired(base({ expiresAt: '2026-12-01T00:00:00.000Z' }), NOW))
ok('a past expiry has expired', isExpired(base({ expiresAt: '2026-11-01T00:00:00.000Z' }), NOW))
ok('the expiry instant itself counts as expired', isExpired(base({ expiresAt: NOW }), NOW))
ok('an unreadable expiry is treated as expired', isExpired(base({ expiresAt: 'not-a-date' }), NOW))

// --- redemption ---
ok('an issued reward can be redeemed', canRedeem(base(), NOW).ok)
ok('an expired reward cannot be redeemed', !canRedeem(base({ expiresAt: '2026-11-01T00:00:00.000Z' }), NOW).ok)
ok('a redeemed reward cannot be redeemed again', !canRedeem(base({ status: 'REDEEMED' }), NOW).ok)
ok('a reversed reward cannot be redeemed', !canRedeem(base({ status: 'REVERSED' }), NOW).ok)
ok('a zero-value reward cannot be redeemed', !canRedeem(base({ amount: 0 }), NOW).ok)
const firstRedeem = redeem(base(), NOW)
ok('redeeming succeeds once', firstRedeem.ok && firstRedeem.next?.status === 'REDEEMED')
ok('redeeming appends a REDEEMED event', firstRedeem.event?.type === 'REDEEMED' && firstRedeem.event?.amount === 5)
const secondRedeem = redeem(firstRedeem.next!, NOW)
ok('redeeming twice is refused', !secondRedeem.ok && secondRedeem.event === undefined)

// --- reversal ---
const reverseIssued = reverse(base(), 'Visit refunded', NOW)
ok('an issued reward can be reversed', reverseIssued.ok && reverseIssued.next?.status === 'REVERSED')
ok('reversing before use says so', /before redemption/i.test(reverseIssued.event?.note ?? ''))
const reverseRedeemed = reverse(base({ status: 'REDEEMED' }), 'Visit refunded', NOW)
ok('a redeemed reward can be reversed', reverseRedeemed.ok)
ok('reversing after use says the value was used', /already used/i.test(reverseRedeemed.event?.note ?? ''))
ok('reversing twice is refused', !reverse(base({ status: 'REVERSED' }), 'again', NOW).ok)
ok('an expired reward cannot be reversed', !reverse(base({ status: 'EXPIRED' }), 'late', NOW).ok)

// --- expiry transition ---
ok('a lapsed reward can be expired', expire(base({ expiresAt: '2026-11-01T00:00:00.000Z' }), NOW).ok)
ok('a live reward cannot be expired', !expire(base({ expiresAt: '2026-12-01T00:00:00.000Z' }), NOW).ok)
ok('a redeemed reward cannot expire', !expire(base({ status: 'REDEEMED', expiresAt: '2026-11-01T00:00:00.000Z' }), NOW).ok)

// --- balance ---
const wallet = [
  base({ amount: 5 }),
  base({ amount: 10, status: 'REDEEMED' }),
  base({ amount: 7, status: 'REVERSED' }),
  base({ amount: 3, expiresAt: '2026-11-01T00:00:00.000Z' }),
  base({ amount: 2.5 }),
]
ok('balance counts only spendable credit', availableBalance(wallet, NOW) === 7.5)
ok('an empty wallet is zero', availableBalance([], NOW) === 0)

// --- amounts ---
ok('a fixed reward is its value', computeRewardAmount({ type: 'FIXED', value: 5 }, 40) === 5)
ok('a percentage reward follows the spend', computeRewardAmount({ type: 'PERCENT', value: 10 }, 40) === 4)
ok('a cap holds', computeRewardAmount({ type: 'PERCENT', value: 50, maxAmount: 8 }, 40) === 8)
ok('a refunded visit earns nothing', computeRewardAmount({ type: 'PERCENT', value: 10 }, 0) === 0)
ok('a negative total earns nothing', computeRewardAmount({ type: 'FIXED', value: 5 }, -10) === 0)
ok('amounts are rounded to cents', computeRewardAmount({ type: 'PERCENT', value: 33 }, 10.01) === 3.3)

// --- plain words ---
ok('an open reward reads plainly', /no expiry/.test(describeReward(base())))
ok('an expiring reward names the date', /use it by 2026-12-01/.test(describeReward(base({ expiresAt: '2026-12-01T00:00:00.000Z' }))))
ok('a used reward says so', /already used/.test(describeReward(base({ status: 'REDEEMED' }))))

console.log(`Referral rewards: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exitCode = 1

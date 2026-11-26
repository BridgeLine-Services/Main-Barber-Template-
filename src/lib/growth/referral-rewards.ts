/**
 * Referral reward lifecycle (Section 10 of the platform brief).
 *
 * Pure rules, no database. A reward moves ISSUED to REDEEMED, or to REVERSED when the
 * qualifying visit is refunded or invalidated, or to EXPIRED when its window closes. Every
 * transition returns the event to append, so the balance and the history cannot drift apart.
 */
export type RewardStatus = 'ISSUED' | 'REDEEMED' | 'REVERSED' | 'EXPIRED'

export interface RewardState {
  status: RewardStatus
  amount: number
  expiresAt: string | null
}

export interface RewardEventDraft {
  type: RewardStatus
  amount: number
  note: string
}

export interface Transition {
  ok: boolean
  reason: string
  next?: RewardState
  event?: RewardEventDraft
}

/** One reward per referral event, per shop. The shop prefix is what stops cross-shop collisions. */
export function sourceKeyFor(businessId: string, referralId: string): string {
  const shop = (businessId ?? '').trim()
  const referral = (referralId ?? '').trim()
  if (!shop || !referral) throw new Error('A reward needs both a shop and the referral it came from.')
  return `${shop}:${referral}`
}

export function isExpired(reward: RewardState, nowIso: string): boolean {
  if (!reward.expiresAt) return false
  const expires = new Date(reward.expiresAt).getTime()
  if (Number.isNaN(expires)) return true
  return expires <= new Date(nowIso).getTime()
}

export function canRedeem(reward: RewardState, nowIso: string): { ok: boolean; reason: string } {
  if (reward.status !== 'ISSUED') return { ok: false, reason: `A ${reward.status.toLowerCase()} reward cannot be redeemed.` }
  if (reward.amount <= 0) return { ok: false, reason: 'This reward has no value left to redeem.' }
  if (isExpired(reward, nowIso)) return { ok: false, reason: 'This reward has expired.' }
  return { ok: true, reason: 'Ready to redeem.' }
}

export function redeem(reward: RewardState, nowIso: string): Transition {
  const verdict = canRedeem(reward, nowIso)
  if (!verdict.ok) return { ok: false, reason: verdict.reason }
  return {
    ok: true,
    reason: 'Reward redeemed.',
    next: { ...reward, status: 'REDEEMED' },
    event: { type: 'REDEEMED', amount: reward.amount, note: `Redeemed on ${nowIso.slice(0, 10)}.` },
  }
}

export function reverse(reward: RewardState, reason: string, nowIso: string): Transition {
  if (reward.status === 'REVERSED') return { ok: false, reason: 'This reward has already been reversed.' }
  if (reward.status === 'EXPIRED') return { ok: false, reason: 'An expired reward has nothing to claw back.' }
  const note = reward.status === 'REDEEMED'
    ? `Reversed after redemption: the value was already used. ${reason}`
    : `Reversed before redemption. ${reason}`
  return {
    ok: true,
    reason: note,
    next: { ...reward, status: 'REVERSED' },
    event: { type: 'REVERSED', amount: reward.amount, note: `${note} (${nowIso.slice(0, 10)})` },
  }
}

export function expire(reward: RewardState, nowIso: string): Transition {
  if (reward.status !== 'ISSUED') return { ok: false, reason: 'Only an unredeemed reward can expire.' }
  if (!isExpired(reward, nowIso)) return { ok: false, reason: 'This reward has not expired yet.' }
  return {
    ok: true,
    reason: 'Reward expired.',
    next: { ...reward, status: 'EXPIRED' },
    event: { type: 'EXPIRED', amount: reward.amount, note: `Expired on ${nowIso.slice(0, 10)}.` },
  }
}

/** What the customer can actually spend right now. */
export function availableBalance(rewards: RewardState[], nowIso: string): number {
  const total = rewards
    .filter((reward) => reward.status === 'ISSUED' && !isExpired(reward, nowIso))
    .reduce((sum, reward) => sum + reward.amount, 0)
  return Math.round(total * 100) / 100
}

export interface RewardRule {
  type: 'FIXED' | 'PERCENT'
  value: number
  maxAmount?: number | null
}

export function computeRewardAmount(rule: RewardRule, qualifyingTotal: number): number {
  if (!Number.isFinite(qualifyingTotal) || qualifyingTotal <= 0) return 0
  const raw = rule.type === 'FIXED' ? rule.value : (qualifyingTotal * rule.value) / 100
  const capped = rule.maxAmount != null ? Math.min(raw, rule.maxAmount) : raw
  return Math.max(0, Math.round(capped * 100) / 100)
}

export function describeReward(reward: RewardState): string {
  const money = `$${reward.amount.toFixed(2)}`
  if (reward.status === 'ISSUED') {
    return reward.expiresAt ? `${money} credit, use it by ${reward.expiresAt.slice(0, 10)}.` : `${money} credit, no expiry.`
  }
  if (reward.status === 'REDEEMED') return `${money} credit, already used.`
  if (reward.status === 'REVERSED') return `${money} credit, withdrawn.`
  return `${money} credit, expired.`
}

/** What a shop grants for a qualifying referral, in one place so the amount and the expiry
 *  cannot drift apart between the service and the screen that shows them. */
export const REFERRAL_REWARD_RULE = { amount: 10, currency: 'USD', expiresInDays: 90 } as const

export interface IssuanceInput {
  attribution: { id: string; referrerCustomerId: string | null } | null
  businessId: string
  referredCustomerId: string
  appointmentStatus: string | null
  existingSourceKeys: string[]
}

export interface IssuanceDecision {
  issue: boolean
  reason: string
  sourceKey: string | null
}

/**
 * Whether a completed visit earns the referrer a reward. Pure, so the reasons stay distinct
 * instead of collapsing into one silent `false`.
 */
export function decideRewardIssuance(input: IssuanceInput): IssuanceDecision {
  if (!input.attribution) return { issue: false, reason: 'This customer was not referred.', sourceKey: null }
  if (!input.attribution.referrerCustomerId) {
    return { issue: false, reason: 'The referral has no referrer recorded.', sourceKey: null }
  }
  if (input.attribution.referrerCustomerId === input.referredCustomerId) {
    return { issue: false, reason: 'A customer cannot earn a reward for referring themselves.', sourceKey: null }
  }
  if (input.appointmentStatus !== 'COMPLETED') {
    return { issue: false, reason: 'The visit is not completed yet.', sourceKey: null }
  }
  const sourceKey = sourceKeyFor(input.businessId, input.attribution.id)
  if (input.existingSourceKeys.includes(sourceKey)) {
    return { issue: false, reason: 'This referral has already been rewarded.', sourceKey }
  }
  return { issue: true, reason: 'The referred customer completed their first visit.', sourceKey }
}

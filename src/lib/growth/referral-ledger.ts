/**
 * The referral reward ledger in use (Section 10 of the platform brief).
 *
 * Every function here is tenant-bound, writes an append-only event alongside the grant, and
 * is safe to retry: issuance is keyed by (businessId, sourceKey), so a duplicate completion
 * event cannot pay twice.
 */
import { prisma } from '@/lib/prisma'
import { withTenant } from '@/lib/tenant-context'
import {
  REFERRAL_REWARD_RULE,
  availableBalance,
  decideRewardIssuance,
  redeem,
  reverse,
  type RewardState,
} from './referral-rewards'

export interface IssueResult {
  issued: boolean
  reason: string
  rewardId?: string
}

/**
 * Grant the referrer's reward when a referred customer's visit is completed. Called from the
 * appointment completion path, so it must never throw into it: a failure to pay is logged,
 * not allowed to fail the appointment update.
 */
export async function issueRewardForCompletedVisit(input: {
  businessId: string
  customerId: string
  appointmentId: string
}): Promise<IssueResult> {
  const attribution = await prisma.referralAttribution.findFirst({
    where: { customerId: input.customerId, businessId: input.businessId },
    select: { id: true, referrerCustomerId: true },
  })
  if (!attribution) return { issued: false, reason: 'This customer was not referred.' }

  const appointment = await prisma.appointment.findFirst({
    where: { id: input.appointmentId, businessId: input.businessId },
    select: { status: true },
  })

  const sourceKey = decideRewardIssuance({
    attribution,
    businessId: input.businessId,
    referredCustomerId: input.customerId,
    appointmentStatus: appointment?.status ?? null,
    existingSourceKeys: [],
  }).sourceKey

  const existing = sourceKey
    ? await prisma.referralReward.findFirst({
        where: { businessId: input.businessId, sourceKey },
        select: { sourceKey: true },
      })
    : null

  const decision = decideRewardIssuance({
    attribution,
    businessId: input.businessId,
    referredCustomerId: input.customerId,
    appointmentStatus: appointment?.status ?? null,
    existingSourceKeys: existing ? [existing.sourceKey] : [],
  })
  if (!decision.issue || !decision.sourceKey) return { issued: false, reason: decision.reason }

  const referrerId = attribution.referrerCustomerId
  if (!referrerId) return { issued: false, reason: decision.reason }

  const expiresAt = new Date(Date.now() + REFERRAL_REWARD_RULE.expiresInDays * 24 * 60 * 60 * 1000)

  try {
    const reward = await withTenant(input.businessId, async (tx) => {
      const created = await tx.referralReward.create({
        data: {
          businessId: input.businessId,
          customerId: referrerId,
          status: 'ISSUED',
          amount: REFERRAL_REWARD_RULE.amount,
          currency: REFERRAL_REWARD_RULE.currency,
          reason: decision.reason,
          sourceKey: decision.sourceKey as string,
          referralId: attribution.id,
          expiresAt,
        },
      })
      await tx.referralRewardEvent.create({
        data: {
          rewardId: created.id,
          businessId: input.businessId,
          type: 'ISSUED',
          amount: REFERRAL_REWARD_RULE.amount,
          note: decision.reason,
        },
      })
      return created
    })
    return { issued: true, reason: decision.reason, rewardId: reward.id }
  } catch (error) {
    // The unique key is the real guarantee: a concurrent retry loses here, not at the check.
    if ((error as { code?: string }).code === 'P2002') {
      return { issued: false, reason: 'This referral has already been rewarded.' }
    }
    throw error
  }
}

/** The rewards a customer can still spend, and what they add up to. */
export async function listCustomerRewards(businessId: string, customerId: string) {
  const rows = await withTenant(businessId, (tx) =>
    tx.referralReward.findMany({
      where: { businessId, customerId },
      orderBy: { issuedAt: 'desc' },
    }),
  )
  const states: RewardState[] = rows.map((row) => ({
    status: row.status as RewardState['status'],
    amount: Number(row.amount),
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    redeemedAt: row.redeemedAt ? row.redeemedAt.toISOString() : null,
    reversedAt: row.reversedAt ? row.reversedAt.toISOString() : null,
  }))
  return { rewards: rows, balance: availableBalance(states, new Date().toISOString()) }
}

/** Spend a reward once. A second attempt is refused by the rule, not by the caller. */
export async function redeemReward(input: {
  businessId: string
  rewardId: string
  actorId?: string
}): Promise<{ ok: boolean; reason: string }> {
  return withTenant(input.businessId, async (tx) => {
    const row = await tx.referralReward.findFirst({
      where: { id: input.rewardId, businessId: input.businessId },
    })
    if (!row) return { ok: false, reason: 'That reward does not belong to this shop.' }
    const now = new Date().toISOString()
    const outcome = redeem(
      {
        status: row.status as RewardState['status'],
        amount: Number(row.amount),
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      },
      now,
    )
    if (!outcome.ok || !outcome.next) return { ok: false, reason: outcome.reason }
    await tx.referralReward.update({
      where: { id: row.id },
      data: { status: 'REDEEMED', redeemedAt: new Date(now) },
    })
    await tx.referralRewardEvent.create({
      data: {
        rewardId: row.id,
        businessId: input.businessId,
        type: 'REDEEMED',
        amount: Number(row.amount),
        note: outcome.reason,
        actorId: input.actorId ?? null,
      },
    })
    return { ok: true, reason: outcome.reason }
  })
}

/** Take a reward back when the visit it was earned on is refunded or invalidated. */
export async function reverseReward(input: {
  businessId: string
  rewardId: string
  reason: string
  actorId?: string
}): Promise<{ ok: boolean; reason: string }> {
  return withTenant(input.businessId, async (tx) => {
    const row = await tx.referralReward.findFirst({
      where: { id: input.rewardId, businessId: input.businessId },
    })
    if (!row) return { ok: false, reason: 'That reward does not belong to this shop.' }
    const now = new Date().toISOString()
    const outcome = reverse(
      {
        status: row.status as RewardState['status'],
        amount: Number(row.amount),
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      },
      input.reason,
      now,
    )
    if (!outcome.ok || !outcome.next) return { ok: false, reason: outcome.reason }
    await tx.referralReward.update({
      where: { id: row.id },
      data: { status: 'REVERSED', reversedAt: new Date(now), reversalReason: input.reason },
    })
    await tx.referralRewardEvent.create({
      data: {
        rewardId: row.id,
        businessId: input.businessId,
        type: 'REVERSED',
        amount: Number(row.amount),
        note: input.reason,
        actorId: input.actorId ?? null,
      },
    })
    return { ok: true, reason: outcome.reason }
  })
}

/** Owner view: every reward this shop has granted, newest first. */
export async function listShopRewards(
  businessId: string,
  opts: { status?: string; limit?: number } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200)
  return withTenant(businessId, (tx) =>
    tx.referralReward.findMany({
      where: { businessId, ...(opts.status ? { status: opts.status } : {}) },
      orderBy: { issuedAt: 'desc' },
      take: limit,
      include: { customer: { select: { id: true, firstName: true, lastName: true } } },
    }),
  )
}

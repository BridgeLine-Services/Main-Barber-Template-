export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { logAudit } from '@/lib/auth-helpers'
import { listShopRewards, redeemReward, reverseReward } from '@/lib/growth/referral-ledger'

const MONEY_ROLES = ['OWNER', 'BUSINESS_ADMIN']

/**
 * GET /api/dashboard/referrals/rewards
 * POST /api/dashboard/referrals/rewards { rewardId, action: 'REDEEM' | 'REVERSE', reason? }
 *
 * Rewards are money, so this is owner-level. The shop comes from the session, never from the
 * request, and the ledger re-checks ownership of the reward inside the tenant transaction.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!MONEY_ROLES.includes(session.user.role as string)) {
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
    }
    const status = new URL(req.url).searchParams.get('status') || undefined
    const rewards = await listShopRewards(session.user.businessId, { status })
    return NextResponse.json({ rewards })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/referrals/rewards')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!MONEY_ROLES.includes(session.user.role as string)) {
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
    }
    const body = (await req.json().catch(() => null)) as
      | { rewardId?: string; action?: string; reason?: string }
      | null
    if (!body?.rewardId) return NextResponse.json({ error: 'A reward is required.' }, { status: 400 })

    const businessId = session.user.businessId
    const outcome =
      body.action === 'REVERSE'
        ? await reverseReward({
            businessId,
            rewardId: body.rewardId,
            reason: (body.reason || 'Reversed by the owner').slice(0, 200),
            actorId: session.user.id,
          })
        : await redeemReward({ businessId, rewardId: body.rewardId, actorId: session.user.id })

    if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 409 })

    await logAudit({
      userId: session.user.id,
      businessId,
      action: 'SETTINGS_UPDATED',
      entityType: 'ReferralReward',
      entityId: body.rewardId,
      newValues: { action: body.action === 'REVERSE' ? 'REVERSE' : 'REDEEM', reason: outcome.reason },
    })
    return NextResponse.json({ success: true, reason: outcome.reason })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/referrals/rewards')
  }
}

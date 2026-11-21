/**
 * Resolving a referral code for a public booking (referral attribution).
 *
 * Everything here is server-side and business-scoped, because the browser is not a source
 * of truth about who referred whom. A code is accepted only when all of these hold:
 *
 *   1. it normalises to something that could be a code at all;
 *   2. the referral programme for THIS business exists and is switched on;
 *   3. the code exists for THIS business and is still active.
 *
 * Anything else returns "no referral" rather than an error. A mistyped or expired code must
 * never cost a shop a booking, and it must never be attributed to the wrong shop.
 */

import { prisma } from '@/lib/prisma'
import { normaliseReferralCode } from './referrals'

export interface ReferralResolution {
  code: string | null
  referrerCustomerId: string | null
  source: string | null
  campaign: string | null
}

const NONE: ReferralResolution = { code: null, referrerCustomerId: null, source: null, campaign: null }

/**
 * Never throws. A database problem here means "no referral", not "no booking".
 */
export async function resolveReferralForBooking(input: {
  businessId: string
  rawCode?: string | null
  campaign?: string | null
}): Promise<ReferralResolution> {
  const code = normaliseReferralCode(input.rawCode)
  if (!code) return NONE

  try {
    const program = await prisma.referralProgram.findUnique({
      where: { businessId: input.businessId },
      select: { enabled: true },
    })
    if (!program?.enabled) return NONE

    // Scoped by businessId, so a code that belongs to another shop cannot match even if
    // the same six characters were generated there.
    const row = await prisma.referralCode.findFirst({
      where: { businessId: input.businessId, code, active: true },
      select: { code: true, customerId: true },
    })
    if (!row) return NONE

    return {
      code: row.code,
      referrerCustomerId: row.customerId,
      source: 'REFERRAL',
      campaign: input.campaign ? input.campaign.slice(0, 64) : null,
    }
  } catch {
    return NONE
  }
}

// Shared, real shop open/closed calculation — single source of truth used by
// the customer ShopStatus card, the hero status indicator, and any other
// surface that needs the live state. Pure: no DB, no clock reads beyond the
// supplied `now`. Never invent hours — no configured hours means no verdict.

import { DateTime } from 'luxon'
import { resolveBusinessTimezone } from '@/lib/timezone'
import type { BusinessHours } from '@/lib/business-hours'

type ShopBusiness = {
  hours?: unknown
  deactivatedAt?: Date | string | null
  timezone?: string | null
}

export interface ShopStatusComputation {
  /** Soft-deactivated shops keep marketing pages but report closed. */
  deactivated: boolean
  /** True when the business has hours configured for the current local day. */
  hasHours: boolean
  /** Open right now, computed from real weekly hours in the shop's timezone. */
  openNow: boolean
}

/**
 * Compute the live open/closed state for a business at a given instant
 * (defaults to now, in the business's own timezone).
 */
export function computeShopStatus(
  business: ShopBusiness,
  now: DateTime = DateTime.now().setZone(resolveBusinessTimezone(business))
): ShopStatusComputation {
  const deactivated = business.deactivatedAt != null
  const dayKey = (now.weekdayLong || '').toLowerCase() // 'monday' … 'sunday'
  const todayHours =
    business.hours && typeof business.hours === 'object'
      ? (business.hours as BusinessHours)[dayKey]
      : undefined
  const hasHours = Boolean(todayHours)

  const minutesNow = now.hour * 60 + now.minute
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
  }
  const openNow =
    !deactivated &&
    hasHours &&
    !todayHours!.isOff &&
    minutesNow >= toMinutes(todayHours!.open || '09:00') &&
    minutesNow < toMinutes(todayHours!.close || '18:00')

  return { deactivated, hasHours, openNow }
}

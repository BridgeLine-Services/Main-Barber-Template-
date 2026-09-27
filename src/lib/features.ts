/**
 * Centralized, tenant-aware feature configuration (Requirement 27).
 *
 * ONE registry resolves every feature check in the app. Existing
 * business-level boolean columns (e.g. `paymentInPerson`) remain the
 * authoritative source for their feature; `Business.featureOverrides`
 * (migration 20260927170000) can enable/disable the rest without code
 * changes. Disabled features are enforced at the API layer, not just
 * hidden in the UI.
 *
 * Rules:
 *   - defaults are SAFE and match current template behavior
 *   - unknown override keys are rejected by validation, ignored on read
 *   - `onlinePayments` can only become true via a registered provider
 *     (src/lib/payments fails closed — see docs/PAYMENTS.md)
 *   - resolution is always per-business (tenant-aware by construction)
 */
import { prisma } from '@/lib/prisma'

export const FEATURE_KEYS = [
  'onlineBooking',      // public booking flow + POST /api/public/appointments
  'customerPortal',     // token-based customer portal
  'reviews',            // public review display/submission
  'gallery',            // public gallery
  'promotions',         // marketing campaigns
  'loyalty',            // reward programs
  'waitlist',           // waitlist entries
  'queue',              // walk-in queue
  'inventory',          // inventory management
  'marketing',          // marketing features
  'analytics',          // dashboard analytics
  'multipleBarbers',    // more than one barber
  'barberProfiles',     // public barber profile pages
  'deposits',           // deposit-based booking rules
  'pwa',                // installable PWA behavior
  'emailNotifications',
  'smsNotifications',
  'onlinePayments',     // online settlement (requires a registered provider)
] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]

export const FEATURE_DEFAULTS: Record<FeatureKey, boolean> = {
  onlineBooking: true,
  customerPortal: true,
  reviews: true,
  gallery: true,
  promotions: true,
  loyalty: true,
  waitlist: true,
  queue: true,
  inventory: true,
  marketing: true,
  analytics: true,
  multipleBarbers: true,
  barberProfiles: true,
  deposits: true,
  pwa: true,
  emailNotifications: true,
  smsNotifications: true,
  onlinePayments: false, // fail closed: no online provider ships with the template
}

export class FeatureDisabledError extends Error {
  constructor(public feature: FeatureKey) {
    super(`Feature '${feature}' is disabled for this business`)
    this.name = 'FeatureDisabledError'
  }
}

type BusinessFeatureRow = {
  featureOverrides: PrismaJson | null
}

type PrismaJson = unknown

function coerceOverrides(raw: PrismaJson): Partial<Record<FeatureKey, boolean>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Partial<Record<FeatureKey, boolean>> = {}
  for (const key of FEATURE_KEYS) {
    const v = (raw as Record<string, unknown>)[key]
    if (typeof v === 'boolean') out[key] = v
  }
  return out
}

/** Resolve the full feature map for a business row. */
export function resolveFeatures(business: BusinessFeatureRow): Record<FeatureKey, boolean> {
  const resolved = { ...FEATURE_DEFAULTS, ...coerceOverrides(business.featureOverrides) }
  // onlinePayments stays fail-closed unless a provider is registered AND
  // explicitly enabled — provider resolution throws otherwise.
  return resolved
}

export function isFeatureEnabled(business: BusinessFeatureRow, feature: FeatureKey): boolean {
  return resolveFeatures(business)[feature] ?? false
}

export async function isFeatureEnabledForBusiness(businessId: string, feature: FeatureKey): Promise<boolean> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { featureOverrides: true },
  })
  if (!business) return false
  return isFeatureEnabled(business, feature)
}

/** Throws FeatureDisabledError when the feature is off — for API routes. */
export async function assertFeatureEnabled(businessId: string, feature: FeatureKey): Promise<void> {
  if (!(await isFeatureEnabledForBusiness(businessId, feature))) {
    throw new FeatureDisabledError(feature)
  }
}

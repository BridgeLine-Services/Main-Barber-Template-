// ============================================================================
// ONBOARDING — persistent white-label setup status + dashboard access gate.
//
// Server-side enforcement priority (checked in this exact order):
//   1. Not authenticated            → /login
//   2. mustChangePassword = true    → /change-password
//   3. Onboarding incomplete        → /dashboard/onboarding
//   4. Otherwise                    → dashboard access allowed
//
// Enforcement lives in the dashboard layout (server component) so it cannot
// be bypassed by client-side navigation. Middleware additionally stamps the
// request path into `x-pathname` so the gate can exempt its own redirect
// targets (the onboarding page) without infinite redirect loops.
// ============================================================================

import { prisma } from '@/lib/prisma'

export type DashboardAccessReason = 'unauthenticated' | 'password' | 'onboarding'

/**
 * Access decision for the dashboard gate.
 * `redirectTo` is present only when `allowed` is false.
 */
export type DashboardAccess = {
  allowed: boolean
  redirectTo?: string
  reason?: DashboardAccessReason
}

/** Onboarding wizard step keys (persisted in Business.onboardingStep). */
export const ONBOARDING_STEPS = ['business', 'branding', 'services', 'team', 'booking', 'review', 'done'] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

/**
 * Resolve the authenticated owner's businessId from the DATABASE user record.
 *
 * The session JWT can be stale — it is minted at login and does not refresh
 * when a business is later created/linked — so every onboarding API resolves
 * the business from the DB, never from the token claim.
 *
 * Returns null when the user cannot be found or has no business linked.
 */
export async function resolveOwnerBusinessId(
  user: { id?: string | null; email?: string | null }
): Promise<string | null> {
  if (!user.id && !user.email) return null
  const dbUser = await prisma.user.findUnique({
    where: user.id ? { id: user.id } : { email: user.email! },
    select: { businessId: true },
  })
  return dbUser?.businessId ?? null
}

/**
 * Whether the given business has completed onboarding.
 * A missing business (null id) counts as incomplete.
 */
export async function hasCompletedOnboarding(businessId: string | null | undefined): Promise<boolean> {
  if (!businessId) return false
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { onboardingCompleted: true },
  })
  return business?.onboardingCompleted ?? false
}

/** Paths whose entire purpose is satisfying the gate — never redirect away FROM them. */
function isGateExemptPath(pathname: string): boolean {
  return (
    pathname.startsWith('/dashboard/onboarding') ||
    pathname.startsWith('/change-password') ||
    pathname.startsWith('/api/dashboard/onboarding') ||
    pathname.startsWith('/api/auth')
  )
}

/**
 * Central server-side dashboard access gate.
 *
 * @param session   NextAuth session (or null when unauthenticated).
 * @param pathname  Current request path (from the x-pathname header stamped
 *                  by middleware). Used to exempt the gate's own redirect
 *                  targets so users can actually complete the password change
 *                  or the onboarding wizard.
 */
export async function checkDashboardAccess(
  session: { user?: any } | null,
  pathname: string
): Promise<DashboardAccess> {
  // Priority 1 — authentication
  if (!session?.user) {
    return { allowed: false, redirectTo: '/login', reason: 'unauthenticated' }
  }

  const user = session.user as { id?: string; email?: string }

  // Resolve mutable authorization state from the database. The JWT is a
  // session cache and cannot be the source of truth after onboarding links the
  // first Business during the same authenticated session.
  let dbUser: { role: string; businessId: string | null; mustChangePassword: boolean } | null = null
  try {
    dbUser = await prisma.user.findUnique({
      where: user.id ? { id: user.id } : user.email ? { email: user.email } : undefined,
      select: { role: true, businessId: true, mustChangePassword: true },
    })
  } catch (error) {
    // If the DB is unreachable, fail safe: block dashboard access.
    console.error('[onboarding] Failed to load user for access gate:', error)
    return { allowed: false, redirectTo: '/login', reason: 'unauthenticated' }
  }

  if (!dbUser) {
    return { allowed: false, redirectTo: '/login', reason: 'unauthenticated' }
  }

  if (dbUser.mustChangePassword && !pathname.startsWith('/change-password')) {
    return { allowed: false, redirectTo: '/change-password', reason: 'password' }
  }

  // Priority 3 — onboarding incomplete (owners only; barbers belong to a
  // business by definition, so onboarding only gates owners)
  const businessId = dbUser.businessId
  const role = dbUser.role.toUpperCase()

  if (role === 'OWNER') {
    if (!businessId) {
      // Owner with no business at all — onboarding not started.
      if (!isGateExemptPath(pathname)) {
        return { allowed: false, redirectTo: '/dashboard/onboarding', reason: 'onboarding' }
      }
    } else if (!(await hasCompletedOnboarding(businessId))) {
      // Business exists but setup not finished.
      if (!isGateExemptPath(pathname)) {
        return { allowed: false, redirectTo: '/dashboard/onboarding', reason: 'onboarding' }
      }
    }
  }

  // Priority 4 — access allowed
  return { allowed: true }
}

// ============================================================================
// ONBOARDING REQUIREMENTS — the single server-side definition of what makes
// a shop "bookable". Checked before onboarding can be marked complete and
// surfaced in the Review step so the owner sees exactly what is missing and
// which wizard step fixes it.
// ============================================================================

import { validateSlug } from '@/lib/onboarding-constants'

export interface OnboardingRequirement {
  /** Stable code, safe to match on. */
  code:
    | 'business_name'
    | 'business_slug'
    | 'timezone'
    | 'active_service'
    | 'active_barber'
    | 'barber_schedule'
  /** Human label shown to the owner. */
  label: string
  /** Wizard step that satisfies this requirement. */
  step: 'business' | 'services' | 'team'
}

/** A requirement that is not yet satisfied. */
export interface MissingRequirement extends OnboardingRequirement {
  /** Short, actionable hint. */
  hint: string
}

export const ONBOARDING_REQUIREMENTS: OnboardingRequirement[] = [
  { code: 'business_name', label: 'Business name', step: 'business' },
  { code: 'business_slug', label: 'Web address (slug)', step: 'business' },
  { code: 'timezone', label: 'Timezone', step: 'business' },
  { code: 'active_service', label: 'At least one active service', step: 'services' },
  { code: 'active_barber', label: 'At least one active barber', step: 'team' },
  { code: 'barber_schedule', label: 'Weekly schedule for every active barber', step: 'team' },
]

const REQUIREMENT_HINTS: Record<OnboardingRequirement['code'], string> = {
  business_name: 'Add your shop name in Business Basics.',
  business_slug: 'Set your web address in Business Basics.',
  timezone: 'Choose your timezone in Business Basics.',
  active_service: 'Add at least one service customers can book.',
  active_barber: 'Add at least one barber who takes appointments.',
  barber_schedule: 'Set working hours for every active barber in the Team step.',
}

export interface OnboardingRequirementsResult {
  ok: boolean
  /** Requirements not yet satisfied (empty when ok). */
  missing: MissingRequirement[]
}

/**
 * Evaluate ALL server-side completion requirements for a business:
 *   - business name, valid slug, and timezone exist
 *   - at least one ACTIVE service
 *   - at least one ACTIVE barber
 *   - every active barber has schedule information (bookable hours)
 *
 * This is the authoritative check — the PATCH completion gate and the
 * Review step both use it, so they can never disagree.
 */
export async function checkOnboardingRequirements(
  businessId: string
): Promise<OnboardingRequirementsResult> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true, slug: true, timezone: true },
  })

  const missing: MissingRequirement[] = []

  const push = (code: OnboardingRequirement['code']) => {
    const req = ONBOARDING_REQUIREMENTS.find((r) => r.code === code)!
    missing.push({ ...req, hint: REQUIREMENT_HINTS[code] })
  }

  if (business) {
    if (!business.name || !business.name.trim()) push('business_name')
    if (!business.slug || validateSlug(business.slug) !== null) push('business_slug')
    if (!business.timezone) push('timezone')
  } else {
    // No business record at all — every requirement is missing.
    push('business_name')
    push('business_slug')
    push('timezone')
  }

  const [activeServices, activeBarbers] = await Promise.all([
    prisma.service.count({ where: { businessId, isActive: true } }),
    prisma.barber.findMany({
      where: { businessId, isActive: true },
      select: { id: true, schedules: { select: { id: true } } },
    }),
  ])

  if (activeServices === 0) push('active_service')
  if (activeBarbers.length === 0) push('active_barber')
  // Required schedule information: every active barber must have at least
  // one schedule entry (working hours) so the booking engine can produce slots.
  if (activeBarbers.length > 0 && activeBarbers.some((b) => b.schedules.length === 0)) {
    push('barber_schedule')
  }

  return { ok: missing.length === 0, missing }
}

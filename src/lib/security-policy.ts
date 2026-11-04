// ============================================================================
// Security policy switches.
//
// These are deliberately configuration, not hard-coded behaviour: a shop that
// wants to require two-factor authentication can, and a shop that does not is
// left alone. Nothing here can lock an owner out — the policy sends them to the
// page where they enrol, which is reachable while signed in.
// ============================================================================

export const REQUIRE_OWNER_2FA_ENV = 'REQUIRE_OWNER_2FA'

/** Off unless the deployment explicitly asks for it. */
export function isOwnerTwoFactorRequired(env: Record<string, string | undefined> = process.env): boolean {
  return env[REQUIRE_OWNER_2FA_ENV] === 'true'
}

/** The Security tab, where enrolment happens. Exempt from the redirect. */
export const SECURITY_SETTINGS_PATH = '/dashboard/settings?tab=security'
const SECURITY_SETTINGS_PREFIX = '/dashboard/settings'

export interface TwoFactorPolicyInput {
  role: string
  twoFactorEnabled: boolean
  pathname: string
  /** Result of isOwnerTwoFactorRequired(). */
  policyEnabled: boolean
}

/**
 * Should this request be sent to the Security tab instead of continuing?
 *
 * Only management roles are covered (owners and business admins); barbers and
 * customers never see the dashboard's security surface, and a barber's account
 * is provisioned by the shop. Any request already inside settings is allowed so
 * the owner can actually enrol, and API routes are never redirected — blocking
 * them would leave the UI half-working instead of guiding the owner.
 */
export function needsTwoFactorEnrolment(input: TwoFactorPolicyInput): boolean {
  const { role, twoFactorEnabled, pathname, policyEnabled } = input
  if (!policyEnabled) return false
  if (twoFactorEnabled) return false
  const normalized = role.toUpperCase()
  if (normalized !== 'OWNER' && normalized !== 'BUSINESS_ADMIN') return false
  if (pathname.startsWith('/api/')) return false
  if (pathname.startsWith(SECURITY_SETTINGS_PREFIX)) return false
  if (pathname.startsWith('/change-password')) return false
  return true
}

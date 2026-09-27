// ============================================================================
// Permissions — the single centralized role → capability model.
//
// Every authorization decision in the app must resolve through this module
// (directly or via the auth-helpers guards). Do not scatter `role === 'X'`
// checks across routes: add the capability here and call `can()`.
//
// Server-side enforcement only. The browser can never assert a role.
// ============================================================================

export type AppRole =
  | 'PLATFORM_OWNER'
  | 'OWNER'
  | 'BUSINESS_ADMIN'
  | 'BARBER'
  | 'CUSTOMER'
  | 'PUBLIC_VISITOR'

/**
 * Granular capabilities. Naming: `domain.action`.
 * Platform capabilities are prefixed `platform.`; business capabilities
 * `business.`; appointment/customer scopes `appointments.` / `customers.`.
 */
export type Capability =
  // Platform-level
  | 'platform.manage-businesses' // create / disable / reactivate businesses
  | 'platform.transfer-ownership' // transfer ownership of any business
  | 'platform.view-operations' // platform-level operational info

// Business-level (owner) — the last three are OWNER-only and are NOT
// granted to BUSINESS_ADMIN (ownership actions, see BUSINESS_ADMIN_CAPABILITIES)
  | 'business.transfer-ownership' // OWNER-only
  | 'business.export-data' // OWNER-only
  | 'business.manage-lifecycle' // OWNER-only
  | 'business.manage' // umbrella: owner of a business
  | 'business.manage-staff'
  | 'business.manage-services'
  | 'business.manage-customers'
  | 'business.manage-appointments'
  | 'business.manage-branding'
  | 'business.manage-content'
  | 'business.manage-settings'
  | 'business.manage-schedule'
  | 'business.view-audit-log'
  | 'business.publish-website'

// Barber (scoped to own profile/schedule; sees business calendar)
  | 'appointments.view-own'
  | 'appointments.view-all'
  | 'barber.manage-own-profile'
  | 'barber.manage-own-schedule'
  | 'media.upload-barber'

// Customer
  | 'customer.view-own-appointments'
  | 'customer.manage-own-profile'

export const PLATFORM_CAPABILITIES: readonly Capability[] = [
  'platform.manage-businesses',
  'platform.transfer-ownership',
  'platform.view-operations',
]

export const OWNER_CAPABILITIES: readonly Capability[] = [
  'business.manage',
  'business.transfer-ownership', // OWNER-only: hand the business to someone else
  'business.export-data', // OWNER-only: full business data export (CSV/JSON)
  'business.manage-lifecycle', // OWNER-only: deletion, reset, deactivation
  'business.manage-staff',
  'business.manage-services',
  'business.manage-customers',
  'business.manage-appointments',
  'business.manage-branding',
  'business.manage-content',
  'business.manage-settings',
  'business.manage-schedule',
  'business.view-audit-log',
  'business.publish-website',
  'appointments.view-all',
  'media.upload-barber',
]

/**
 * BUSINESS_ADMIN (Requirement 7): manages day-to-day business operations —
 * staff, services, customers, appointments, branding, content, settings,
 * schedule, audit log, publishing. Explicitly EXCLUDED (owner-only):
 * transferring ownership, full data export, deletion/reset/deactivation,
 * and every platform.* capability.
 */
export const BUSINESS_ADMIN_CAPABILITIES: readonly Capability[] = [
  'business.manage',
  'business.manage-staff',
  'business.manage-services',
  'business.manage-customers',
  'business.manage-appointments',
  'business.manage-branding',
  'business.manage-content',
  'business.manage-settings',
  'business.manage-schedule',
  'business.view-audit-log',
  'business.publish-website',
  'appointments.view-all',
  'media.upload-barber',
]

export const BARBER_CAPABILITIES: readonly Capability[] = [
  'appointments.view-own',
  'barber.manage-own-profile',
  'barber.manage-own-schedule',
  'media.upload-barber',
]

export const CUSTOMER_CAPABILITIES: readonly Capability[] = [
  'customer.view-own-appointments',
  'customer.manage-own-profile',
]

export const PUBLIC_VISITOR_CAPABILITIES: readonly Capability[] = []

const ROLE_CAPABILITIES: Record<AppRole, readonly Capability[]> = {
  // The platform owner holds every platform capability, plus the business
  // management capabilities for businesses it operates — but those are
  // exercised through the platform console, never through another
  // business's dashboard.
  PLATFORM_OWNER: [...PLATFORM_CAPABILITIES, ...OWNER_CAPABILITIES],
  OWNER: OWNER_CAPABILITIES,
  BUSINESS_ADMIN: BUSINESS_ADMIN_CAPABILITIES,
  BARBER: BARBER_CAPABILITIES,
  CUSTOMER: CUSTOMER_CAPABILITIES,
  PUBLIC_VISITOR: PUBLIC_VISITOR_CAPABILITIES,
}

/** Central capability check. The ONLY way to answer "may this role do X?" */
export function can(role: AppRole | string, capability: Capability): boolean {
  const caps = ROLE_CAPABILITIES[role as AppRole]
  if (!caps) return false
  return caps.includes(capability)
}

/** Roles allowed to manage a business's operation (OWNER or BUSINESS_ADMIN). */
export function canManageBusiness(role: AppRole | string | null | undefined): boolean {
  return role === 'OWNER' || role === 'BUSINESS_ADMIN'
}

/** True only for the OWNER of a business (ownership/destructive actions). */
export function isBusinessOwnerRole(role: AppRole | string | null | undefined): boolean {
  return role === 'OWNER'
}

/** Platform owners are business-independent staff of the platform itself. */
export function isPlatformRole(role: AppRole | string | null | undefined): boolean {
  return role === 'PLATFORM_OWNER'
}

/** Capabilities granted to a role (useful for debugging and tests). */
export function capabilitiesOf(role: AppRole | string): readonly Capability[] {
  return ROLE_CAPABILITIES[role as AppRole] ?? []
}

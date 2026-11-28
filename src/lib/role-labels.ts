// ============================================================================
// Role labels — the single place that maps internal role identifiers to
// human-facing names.
//
// The database role BUSINESS_ADMIN implements the co-owner experience: a
// staff member with delegated operational access (staff, services,
// appointments, schedule, settings, publishing) and NO ownership actions
// (transfer, export, lifecycle, billing). The UI presents it as "Co-owner".
//
// Keep this the only source of display names; never hardcode role strings
// in components.
// ============================================================================

export const ROLE_LABEL: Record<string, string> = {
  PLATFORM_OWNER: 'Platform Owner',
  OWNER: 'Owner',
  BUSINESS_ADMIN: 'Co-owner',
  BARBER: 'Barber',
  CUSTOMER: 'Customer',
  PUBLIC_VISITOR: 'Visitor',
  ORGANIZATION_OWNER: 'Organization owner',
  CORPORATE_ADMIN: 'Corporate administrator',
  REGIONAL_MANAGER: 'Regional manager',
  FRANCHISE_OWNER: 'Franchise owner',
  LOCATION_MANAGER: 'Location manager',
}

/** Friendly label for a role identifier without exposing unknown internal values. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return 'Customer'
  return ROLE_LABEL[role] ?? 'User'
}

/** Uses an applicable organization role consistently across dashboard surfaces. */
export function dashboardRoleLabel(
  userRole: string | null | undefined,
  organizationRole: string | null | undefined,
): string {
  const displayRole = organizationRole && organizationRole !== 'BARBER' && organizationRole !== 'CUSTOMER'
    ? organizationRole
    : userRole
  return roleLabel(displayRole)
}

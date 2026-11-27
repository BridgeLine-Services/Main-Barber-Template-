/**
 * Who may do what inside an organization (Priority 2 and 3).
 *
 * Two rules shape this table, and both are tested:
 *
 *  1. Aggregated reporting and individual customer access are separate capabilities.
 *     No corporate role is granted `reporting.customer.read`. A corporate leader may see
 *     retention across thirty locations and still cannot open one customer's profile.
 *  2. A capability is a statement about the role, not about the request. Resolving which
 *     locations a person may act on is a separate step (see resolve.ts), so a capability
 *     never stands in for proof of access to a specific shop.
 */

export type OrgRole =
  | 'ORGANIZATION_OWNER'
  | 'CORPORATE_ADMIN'
  | 'REGIONAL_MANAGER'
  | 'FRANCHISE_OWNER'
  | 'LOCATION_MANAGER'
  | 'BARBER'
  | 'CUSTOMER'

export type Capability =
  | 'organization.read'
  | 'organization.manage'
  | 'locations.read'
  | 'locations.manage'
  | 'branding.read'
  | 'branding.manage'
  | 'services.read'
  | 'services.manage'
  | 'reporting.aggregate.read'
  | 'reporting.customer.read'
  | 'announcements.read'
  | 'announcements.send'
  | 'staff.assign'
  | 'financial.organization.read'
  | 'financial.location.read'
  | 'appointments.location.read'
  | 'config.audit.read'
  | 'customer.link.manage'

/** Roles that sit above a single shop. None of them may read an individual customer. */
export const CORPORATE_ROLES: OrgRole[] = ['ORGANIZATION_OWNER', 'CORPORATE_ADMIN', 'REGIONAL_MANAGER', 'FRANCHISE_OWNER']

const LOCATION_LEVEL: Capability[] = [
  'organization.read',
  'locations.read',
  'branding.read',
  'services.read',
  'reporting.aggregate.read',
  'announcements.read',
  'financial.location.read',
  // A location role reads customers of its OWN location only; the location check happens
  // in resolve.ts before any record is loaded.
  'reporting.customer.read',
]

export const ROLE_CAPABILITIES: Record<OrgRole, Capability[]> = {
  ORGANIZATION_OWNER: [
    'organization.read',
    'organization.manage',
    'locations.read',
    'locations.manage',
    'branding.read',
    'branding.manage',
    'services.read',
    'services.manage',
    'reporting.aggregate.read',
    'announcements.read',
    'announcements.send',
    'staff.assign',
    'financial.organization.read',
    'financial.location.read',
    'config.audit.read',
    'customer.link.manage',
  ],
  CORPORATE_ADMIN: [
    'organization.read',
    'locations.read',
    'branding.read',
    'branding.manage',
    'services.read',
    'services.manage',
    'reporting.aggregate.read',
    'announcements.read',
    'announcements.send',
    'financial.organization.read',
    'config.audit.read',
  ],
  REGIONAL_MANAGER: [
    'organization.read',
    'locations.read',
    'branding.read',
    'services.read',
    'reporting.aggregate.read',
    'announcements.read',
    'announcements.send',
    'staff.assign',
    'financial.location.read',
  ],
  FRANCHISE_OWNER: [
    'organization.read',
    'locations.read',
    'branding.read',
    'services.read',
    'reporting.aggregate.read',
    'announcements.read',
    'financial.location.read',
    'financial.organization.read',
  ],
  LOCATION_MANAGER: [...LOCATION_LEVEL, 'appointments.location.read'],
  BARBER: ['organization.read', 'locations.read', 'branding.read', 'services.read', 'announcements.read', 'reporting.customer.read'],
  CUSTOMER: [],
}

export function capabilitiesFor(role: OrgRole): Capability[] {
  return ROLE_CAPABILITIES[role] ?? []
}

export function can(role: OrgRole, capability: Capability): boolean {
  return capabilitiesFor(role).includes(capability)
}

/** The capability that must never be granted by a corporate role. */
export const CUSTOMER_RECORD_CAPABILITY: Capability = 'reporting.customer.read'

export function isCorporateRole(role: OrgRole): boolean {
  return CORPORATE_ROLES.includes(role)
}

/** Plain English, because the person reading this is not a database administrator. */
export function describeRole(role: OrgRole): string {
  switch (role) {
    case 'ORGANIZATION_OWNER':
      return 'You own the organization. You can add or remove locations, appoint managers, and see consolidated reports for every location. You cannot open an individual customer record from a corporate report.'
    case 'CORPORATE_ADMIN':
      return 'You manage branding, services and announcements across the organization. You can see totals by location, but not individual customer records.'
    case 'REGIONAL_MANAGER':
      return 'You manage the locations in the regions assigned to you. You can see their totals and assign staff there.'
    case 'FRANCHISE_OWNER':
      return 'You own one location and see its numbers plus your franchise totals. Other franchisees’ customer records stay private.'
    case 'LOCATION_MANAGER':
      return 'You run one location. You can see that location’s appointments, customers, staff and finances. You cannot change organization-wide settings.'
    case 'BARBER':
      return 'You see your own appointments and the customers you serve at this location. Nothing else.'
    case 'CUSTOMER':
      return 'You see only your own bookings and details.'
    default:
      return 'This role is not recognised, so it is given no access.'
  }
}

/** Fail closed: an unrecognised role is treated as having no capabilities. */
export function normaliseRole(value: string | null | undefined): OrgRole | null {
  if (!value) return null
  return (Object.keys(ROLE_CAPABILITIES) as OrgRole[]).find((role) => role === value) ?? null
}

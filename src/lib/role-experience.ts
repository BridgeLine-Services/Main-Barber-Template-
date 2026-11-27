/**
 * What each person sees first (Part 7.1), in their own words.
 *
 * The dashboard already enforces permissions on the server. What it did not do was
 * explain, to a barber or a co-owner, why their page looks different from the owner's.
 * That gap produces support calls ("where is the payroll page?") and quiet mistakes
 * ("why can't I save this?").
 *
 * This module is the explanation: a focus list of real, existing destinations per role,
 * and a boundary list of what the role cannot do, said plainly. It grants nothing. Every
 * link here must already exist and be permitted by `permissions.ts`; a test asserts both.
 */

import type { AppRole } from '@/lib/permissions'

export interface FocusItem {
  label: string
  href: string
  /** Why this is the thing to look at, in the role's own interest. */
  why: string
}

export type OrganizationRoleName =
  | 'ORGANIZATION_OWNER'
  | 'CORPORATE_ADMIN'
  | 'REGIONAL_MANAGER'
  | 'FRANCHISE_OWNER'
  | 'LOCATION_MANAGER'

export interface RoleExperience {
  role: AppRole | OrganizationRoleName
  /** How this person is described to themselves. */
  label: string
  /** One sentence about what this page is for them. */
  intro: string
  /** What to look at first, in order. */
  focus: FocusItem[]
  /** What this role cannot do, stated without apology and without jargon. */
  boundaries: string[]
  /** True when some actions need another person's agreement. */
  needsOwnerApproval: boolean
}

const OWNER: RoleExperience = {
  role: 'OWNER',
  label: 'Shop owner',
  intro: 'Everything about your shop, in one place. Start with today, then look at how the month is going.',
  focus: [
    { label: "Today's appointments", href: '/dashboard', why: 'Who is coming in today, and whether anything needs moving.' },
    { label: 'Business performance', href: '/dashboard/analytics', why: 'Takings, bookings and which services earn the most.' },
    { label: 'Growth plan', href: '/dashboard/growth', why: 'What to do next, based on what your shop actually has set up.' },
    { label: 'Maintenance', href: '/dashboard/reliability', why: 'Whether your website and backups are in good order.' },
  ],
  boundaries: [],
  needsOwnerApproval: false,
}

const BUSINESS_ADMIN: RoleExperience = {
  role: 'BUSINESS_ADMIN',
  label: 'Co-owner',
  intro: 'You can run the day to day of this shop. A few things belong to the owner alone, and this page says which.',
  focus: [
    { label: "Today's appointments", href: '/dashboard', why: 'The same daily view the owner sees.' },
    { label: 'Calendar', href: '/dashboard/calendar', why: 'Plan the shop schedule and spot gaps in the day.' },
    { label: 'Staff', href: '/dashboard/staff', why: 'See who is working and manage the team you are allowed to oversee.' },
    { label: 'Services', href: '/dashboard/services', why: 'Keep the services customers can book up to date.' },
    { label: 'Customers', href: '/dashboard/customers', why: 'History and contact details for people who book.' },
  ],
  boundaries: [
    'Only the owner can change the shop’s payment settings, owner-level access, or transfer ownership.',
    'Payroll totals, customer exports, shop deactivation and platform administration remain owner-only.',
    'If a page you need is missing, ask the owner to give you that permission rather than sharing their login.',
  ],
  needsOwnerApproval: true,
}

const LOCATION_MANAGER: RoleExperience = {
  role: 'LOCATION_MANAGER',
  label: 'Location manager',
  intro: 'You manage the location or locations assigned to you. Organization totals and announcements are scoped to that access.',
  focus: [
    { label: 'Assigned locations', href: '/dashboard/organization', why: 'See only locations included in your current organization access.' },
    { label: 'Your schedule', href: '/dashboard/schedule', why: 'Check your own working hours and availability.' },
    { label: 'Announcements', href: '/dashboard/organization/announcements', why: 'Read updates shared with your assigned locations.' },
  ],
  boundaries: [
    'You cannot see locations outside your assignments or regions.',
    'Organization-wide branding, shared services and people access belong to corporate administrators.',
    'Your barber tools remain limited to your own profile and schedule; location-wide data is shown only on pages that check your organization access.',
  ],
  needsOwnerApproval: true,
}

const BARBER: RoleExperience = {
  role: 'BARBER',
  label: 'Barber',
  intro: 'Your chair, your clients, your numbers. You see your own work, not the shop’s finances.',
  focus: [
    { label: "Today's appointments", href: '/dashboard', why: 'Only your own bookings appear here.' },
    { label: 'My schedule', href: '/dashboard/schedule', why: 'Your hours and days off.' },
    { label: 'My commission', href: '/dashboard/my-commissions', why: 'What you have earned, calculated from completed appointments.' },
    { label: 'My time clock', href: '/dashboard/my-time-clock', why: 'Clock in and out so your hours are recorded.' },
  ],
  boundaries: [
    'You see your own appointments and customers, not other barbers’ clients.',
    'Shop takings, payroll totals and settings belong to the owner.',
    'If you need a day off, ask the owner: changing the shop’s schedule is their decision.',
  ],
  needsOwnerApproval: true,
}

const ORGANIZATION_OWNER: RoleExperience = {
  role: 'ORGANIZATION_OWNER',
  label: 'Organization owner',
  intro: 'Every location in your organization, plus the settings that apply to all of them.',
  focus: [
    { label: 'Locations', href: '/dashboard/organization', why: 'How each location is doing, side by side.' },
    { label: 'Shop locations', href: '/dashboard/organization/locations', why: 'Which shops are part of the organization, and their regions.' },
    { label: 'Standard services', href: '/dashboard/organization/services', why: 'The shared service list every location starts from.' },
    { label: 'People', href: '/dashboard/organization/people', why: 'Who can see which locations, and what they may change.' },
  ],
  boundaries: [],
  needsOwnerApproval: false,
}

const CORPORATE_ADMIN: RoleExperience = {
  role: 'CORPORATE_ADMIN',
  label: 'Corporate administrator',
  intro: 'You run the organization day to day: locations, people, shared services and announcements.',
  focus: [
    { label: 'Locations', href: '/dashboard/organization', why: 'Totals across the locations you look after.' },
    { label: 'People', href: '/dashboard/organization/people', why: 'Invite someone, or change what they can see.' },
    { label: 'Assignments', href: '/dashboard/organization/assignments', why: 'Give a person access to one more location.' },
    { label: 'Announcements', href: '/dashboard/organization/announcements', why: 'Tell every location about something at once.' },
  ],
  boundaries: [
    'Closing a location and changing who owns the organization belong to the organization owner.',
    'A location\'s own customers and appointments stay with that location.',
  ],
  needsOwnerApproval: true,
}

const REGIONAL_MANAGER: RoleExperience = {
  role: 'REGIONAL_MANAGER',
  label: 'Regional manager',
  intro: 'The locations in the regions you were given, and nothing outside them.',
  focus: [
    { label: 'Locations', href: '/dashboard/organization', why: 'Only the shops in your regions are listed.' },
    { label: 'Assignments', href: '/dashboard/organization/assignments', why: 'Who is working at the shops you look after.' },
    { label: 'Service prices', href: '/dashboard/organization/pricing', why: 'Price requests raised by your locations.' },
  ],
  boundaries: [
    'You see the locations in the regions assigned to you. If a shop is missing, ask the organization owner to add its region to your access.',
    'The shared service list, the organization brand and the list of people belong to corporate.',
    'You cannot change what a shop charges without an approved price request.',
  ],
  needsOwnerApproval: true,
}

const FRANCHISE_OWNER: RoleExperience = {
  role: 'FRANCHISE_OWNER',
  label: 'Franchise owner',
  intro: 'Your own location, plus the organization totals you are allowed to see.',
  focus: [
    { label: 'Locations', href: '/dashboard/organization', why: 'How your location compares with the organization.' },
    { label: 'Today\'s appointments', href: '/dashboard', why: 'The daily view for the shop you run.' },
    { label: 'Service prices', href: '/dashboard/organization/pricing', why: 'Ask to charge something other than the standard price.' },
  ],
  boundaries: [
    'You run your own location. Other locations in the organization belong to their own owners.',
    'Organization-wide settings, shared services and the brand are corporate decisions.',
  ],
  needsOwnerApproval: true,
}

const CUSTOMER: RoleExperience = {
  role: 'CUSTOMER',
  label: 'Customer',
  intro: 'Book, change or cancel your own appointments, and keep your details up to date.',
  focus: [
    { label: 'Book an appointment', href: '/book', why: 'Choose a service, a barber and a time.' },
    { label: 'My appointments', href: '/portal', why: 'See what you have booked and change it.' },
  ],
  boundaries: [
    'You can only see your own appointments and details.',
    'Changing a booking is subject to the shop’s cancellation policy, which is shown when you book.',
  ],
  needsOwnerApproval: false,
}

const PLATFORM_OWNER: RoleExperience = {
  role: 'PLATFORM_OWNER',
  label: 'Platform owner',
  intro: 'You look after the platform itself: which shops exist and whether they are healthy.',
  focus: [
    { label: 'Launch status', href: '/dashboard/factory-status', why: 'Whether each installation is configured and running.' },
    { label: 'Maintenance', href: '/dashboard/reliability', why: 'Versions, backups and support status.' },
  ],
  boundaries: [
    'Looking at a shop’s records is not the same as being allowed to change them. Business data belongs to the business.',
  ],
  needsOwnerApproval: false,
}

const PUBLIC_VISITOR: RoleExperience = {
  role: 'PUBLIC_VISITOR',
  label: 'Visitor',
  intro: 'You are not signed in. You can look at the shop and book, and nothing else.',
  focus: [{ label: 'Book an appointment', href: '/book', why: 'No account needed to book.' }],
  boundaries: ['Anything private needs an account and a sign-in.'],
  needsOwnerApproval: false,
}

const BY_ROLE: Record<AppRole, RoleExperience> = {
  OWNER,
  BUSINESS_ADMIN,
  BARBER,
  CUSTOMER,
  PLATFORM_OWNER,
  PUBLIC_VISITOR,
}

/**
 * An unknown or missing role gets the most restricted answer, not the most generous one.
 * A dashboard that guesses "owner" when the session is incomplete is how a leak starts.
 */
const ORGANIZATION_ROLES: Record<string, RoleExperience> = {
  ORGANIZATION_OWNER,
  CORPORATE_ADMIN,
  REGIONAL_MANAGER,
  FRANCHISE_OWNER,
  LOCATION_MANAGER,
}

export function describeRoleExperience(role: string | null | undefined): RoleExperience {
  if (!role) return PUBLIC_VISITOR
  // Organization roles live in a separate map because AppRole describes shop-level
  // membership. A regional manager used to fall through to PUBLIC_VISITOR, which told
  // them about booking a haircut rather than the shops they actually look after.
  return ORGANIZATION_ROLES[role] ?? BY_ROLE[role as AppRole] ?? PUBLIC_VISITOR
}

/** One sentence for a heading, e.g. "Good morning. This is your chair for today." */
export function roleGreeting(role: string | null | undefined): string {
  const experience = describeRoleExperience(role)
  return `${experience.label}: ${experience.intro}`
}

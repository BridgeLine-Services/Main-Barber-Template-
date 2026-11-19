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

export interface RoleExperience {
  role: AppRole
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
    { label: 'Staff', href: '/dashboard/staff', why: 'Schedules, time clock and who is working.' },
    { label: 'Customers', href: '/dashboard/customers', why: 'History and contact details for people who book.' },
  ],
  boundaries: [
    'Only the owner can change the shop’s payment settings and who has owner-level access.',
    'Only the owner can delete the shop or hand it to someone else.',
    'If a page you need is missing, ask the owner to give you that permission rather than sharing their login.',
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
export function describeRoleExperience(role: string | null | undefined): RoleExperience {
  if (!role) return PUBLIC_VISITOR
  return BY_ROLE[role as AppRole] ?? PUBLIC_VISITOR
}

/** One sentence for a heading, e.g. "Good morning. This is your chair for today." */
export function roleGreeting(role: string | null | undefined): string {
  const experience = describeRoleExperience(role)
  return `${experience.label}: ${experience.intro}`
}

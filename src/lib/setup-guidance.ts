/**
 * Getting-started guidance, in a shop owner's words.
 *
 * Part 4.3 and 4.4 of the expansion directive: copy and additive guidance only. This
 * module decides what to suggest, how to say it, and where to send someone who wants to
 * do it. It never changes a setting, never enables a feature and never turns a
 * recommendation into a requirement. It has no database access, so every rule below is
 * pinned by tests instead of by a screenshot.
 *
 * The one rule that matters most: progress is computed from facts the shop actually has.
 * A thing we could not read is reported as "we could not check", never as done. A
 * percentage is only produced when every step that counts has been read.
 *
 * Five stages (Part 4.1). The fifth, `franchise`, describes a layer this version does not
 * have, so its steps are never scored and never counted as the owner's failure.
 */

import type { BusinessStage } from './growth/stages'

export type ShopStage = BusinessStage

export interface GuidanceStep {
  id: string
  /** Imperative, everyday language. No "configure", no "publish". */
  title: string
  /** Why it matters to the shop. */
  why: string
  /** True when the shop is fine without it. */
  optional?: boolean
  /** The real page that completes this step, or null when nothing can be opened. */
  action?: string | null
  /** A little more detail for someone who wants it, kept out of the way. */
  detail?: string
}

export interface StageCopy {
  id: ShopStage
  label: string
  /** Who this is for, in plain words. */
  suits: string
  /** What to do next, in the order worth doing it. */
  steps: GuidanceStep[]
}

export const STAGE_COPY: StageCopy[] = [
  {
    id: 'starting',
    label: 'Just opening',
    suits: 'You are setting up your first chair and taking your first bookings.',
    steps: [
      {
        id: 'identity',
        title: 'Add your shop name, phone and address',
        why: 'Customers need to know who you are and how to find you.',
        action: '/dashboard/settings?tab=business',
        detail: 'These details appear on your website, on booking confirmations and on the receipt a customer keeps.',
      },
      {
        id: 'hours',
        title: 'Say when you are open',
        why: 'Customers can only book times you are actually there.',
        action: '/dashboard/settings?tab=hours',
        detail: 'Your opening hours and your barbers’ schedules both have to allow a time before it can be booked.',
      },
      {
        id: 'services',
        title: 'Add the cuts you offer and what they cost',
        why: 'This is what a customer picks from when they book.',
        action: '/dashboard/services',
        detail: 'Each service carries its own length and price, which is what the booking page offers.',
      },
      {
        id: 'team',
        title: 'Add yourself as a barber',
        why: 'Bookings are attached to a person, so your chair needs a name.',
        action: '/dashboard/barbers',
        detail: 'A barber record is what a booking points at. Without one there is no chair to book.',
      },
      {
        id: 'website',
        title: 'Turn your website on',
        why: 'Until you do, the site shows a placeholder instead of your shop.',
        action: '/dashboard/website-preview',
        detail: 'Your site stays a draft until you publish it. Nothing is public before that.',
      },
    ],
  },
  {
    id: 'growing',
    label: 'Bringing on help',
    suits: 'You are busy enough to add another barber or a front desk.',
    steps: [
      {
        id: 'team',
        title: 'Add the barbers who work with you',
        why: 'Each barber gets their own schedule and their own bookings.',
        action: '/dashboard/barbers',
        detail: 'Add the person, then choose which services they offer. Their diary stays separate from yours.',
      },
      {
        id: 'permissions',
        title: 'Decide who can see money and settings',
        why: 'Staff can run their own day without seeing the whole business.',
        optional: true,
        action: '/dashboard/staff',
        detail: 'A barber sees their own appointments and pay. A co-owner sees the shop but cannot hand over or delete it.',
      },
      {
        id: 'reminders',
        title: 'Turn on appointment reminders',
        why: 'Fewer people forget, so fewer chairs sit empty.',
        optional: true,
        action: '/dashboard/settings?tab=features',
        detail: 'Reminders need an email or text provider connected for your shop. If one is not connected, reminders cannot send.',
      },
      {
        id: 'walkins',
        title: 'Set up the waitlist for walk-ins',
        why: 'People who turn up without booking can still get seen.',
        optional: true,
        action: '/dashboard/waitlist',
        detail: 'A walk-in joins a queue for a barber. Nobody is charged until they are actually seen.',
      },
    ],
  },
  {
    id: 'established',
    label: 'Established shop',
    suits: 'You have a steady team and want the business to run better, not just busier.',
    steps: [
      {
        id: 'reports',
        title: 'Look at your numbers once a week',
        why: 'You can see which services and barbers earn the most.',
        action: '/dashboard/analytics',
        detail: 'The numbers come from appointments that actually happened, not from bookings that were later cancelled.',
      },
      {
        id: 'memberships',
        title: 'Offer regulars a membership',
        why: 'Steady income, and your regulars come back more often.',
        optional: true,
        action: null,
        detail: 'Membership plans and payments run on the server, but there is no owner screen for them in this version. Ask your operator before promising a membership to a customer.',
      },
      {
        id: 'reviews',
        title: 'Ask happy customers for a review',
        why: 'Reviews are how new customers decide to try you.',
        optional: true,
        action: '/dashboard/reviews',
        detail: 'Only customers who actually visited are invited, and only once per visit.',
      },
      {
        id: 'seo',
        title: 'Check what search engines can read',
        why: 'A few missing details keep you out of local search results.',
        action: '/dashboard/seo-health',
        detail: 'The check names what is missing in plain words. It never changes your site on its own.',
      },
    ],
  },
  {
    id: 'multi-location',
    label: 'More than one shop',
    suits: 'You run, or plan to run, more than one location.',
    steps: [
      {
        id: 'per-location',
        title: 'Give each shop its own copy of this website',
        why: 'Each location keeps its own bookings, staff and customers separate.',
        action: null,
        detail: 'Today a second location is a second deployment with its own database. There is no shared dashboard across shops in this version.',
      },
      {
        id: 'shared-brand',
        title: 'Keep the same look across shops',
        why: 'Customers should recognise you wherever they book.',
        action: '/dashboard/settings?tab=branding',
        detail: 'Branding is stored per shop, so the same logo and colours have to be set on each copy.',
      },
      {
        id: 'consolidated',
        title: 'Ask about combined reporting',
        why: 'Comparing shops needs a setup that does not exist yet in this version.',
        optional: true,
        action: null,
        detail: 'Combining shops would need an organization layer above each shop. That is a proposal, not a feature.',
      },
    ],
  },
  {
    id: 'franchise',
    label: 'A franchise',
    suits: 'You are building a brand that other people will run shops under.',
    steps: [
      {
        id: 'corporate-admin',
        title: 'Set up a head office',
        why: 'There is no corporate layer in this version, so there is nothing to switch on yet.',
        action: null,
        detail: 'No organization, franchisee or regional structure exists in the data model. This step is a plan, not a task you can fail.',
      },
      {
        id: 'brand-governance',
        title: 'Agree the look every shop must use',
        why: 'A franchise is recognised by its brand before anything else.',
        action: '/dashboard/settings?tab=branding',
        detail: 'Today each shop sets its own branding. There is no approval step that stops a franchisee changing it.',
      },
      {
        id: 'location-oversight',
        title: 'Decide who can see each shop',
        why: 'Oversight across shops needs permissions that do not exist yet.',
        action: null,
        detail: 'There is no read-only corporate view of another shop’s records, and none is implied by this page.',
      },
    ],
  },
]

export function copyForStage(stage: ShopStage): StageCopy {
  return STAGE_COPY.find((s) => s.id === stage) ?? STAGE_COPY[0]
}

/** What the shop actually has. Anything we could not read arrives as null. */
export interface ShopFacts {
  hasName?: boolean | null
  hasPhone?: boolean | null
  hasAddress?: boolean | null
  hasHours?: boolean | null
  serviceCount?: number | null
  barberCount?: number | null
  websiteLive?: boolean | null
  bookingEnabled?: boolean | null
  /** Locations the records know about. Null until the platform can report more than one. */
  locationCount?: number | null
}

export type StepState = 'done' | 'to-do' | 'could-not-check'

export interface StepProgress {
  id: string
  state: StepState
  /** Carried through so a caller never has to look the step up again. */
  optional: boolean
  action: string | null
}

export interface GuidanceProgress {
  steps: StepProgress[]
  /** Every step that is done, optional or not. */
  doneCount: number
  /** Steps that still need doing (required only). */
  remaining: string[]
  /** Optional steps still open. Never counted against the owner. */
  optionalRemaining: string[]
  /** Steps whose state could not be read. */
  unknownSteps: string[]
  /** The first required step still to do, or null. */
  nextStepId: string | null
  /** Required steps only, so a percentage never flatters or punishes by optional work. */
  requiredTotal: number
  /** Null when any required step could not be read. Never a guess. */
  percent: number | null
  /** Plain sentence for the top of the panel. */
  headline: string
}

const tri = (value: boolean | null | undefined): StepState =>
  value === true ? 'done' : value === false ? 'to-do' : 'could-not-check'

const countTri = (value: number | null | undefined): StepState =>
  typeof value !== 'number' ? 'could-not-check' : value > 0 ? 'done' : 'to-do'

function stateFor(stepId: string, facts: ShopFacts): StepState | null {
  switch (stepId) {
    case 'identity':
      return tri(facts.hasName && facts.hasPhone && facts.hasAddress)
    case 'hours':
      return tri(facts.hasHours)
    case 'services':
      return countTri(facts.serviceCount)
    case 'team':
      return countTri(facts.barberCount)
    case 'website':
      return tri(facts.websiteLive)
    case 'permissions':
      return facts.barberCount == null ? 'could-not-check' : facts.barberCount > 1 ? 'done' : 'to-do'
    case 'reminders':
      return facts.bookingEnabled == null ? 'could-not-check' : facts.bookingEnabled ? 'done' : 'to-do'
    case 'walkins':
      return facts.bookingEnabled == null ? 'could-not-check' : facts.bookingEnabled ? 'done' : 'to-do'
    case 'reports':
      return facts.serviceCount == null || facts.barberCount == null ? 'could-not-check' : 'done'
    case 'reviews':
      return facts.websiteLive == null ? 'could-not-check' : facts.websiteLive ? 'done' : 'to-do'
    case 'seo':
      return facts.websiteLive == null ? 'could-not-check' : facts.websiteLive ? 'done' : 'to-do'
    // Multi-location and franchise steps describe a setup this version does not offer, so
    // they are never reported as done and never reported as the owner's failure either.
    case 'per-location':
    case 'shared-brand':
    case 'consolidated':
    case 'corporate-admin':
    case 'brand-governance':
    case 'location-oversight':
      return null
    default:
      return null
  }
}

export function buildGuidanceProgress(stage: ShopStage, facts: ShopFacts): GuidanceProgress {
  const copy = copyForStage(stage)
  const steps: StepProgress[] = []
  for (const step of copy.steps) {
    const state = stateFor(step.id, facts)
    if (state) {
      steps.push({
        id: step.id,
        state,
        optional: step.optional === true,
        action: step.action ?? null,
      })
    }
  }

  const doneCount = steps.filter((s) => s.state === 'done').length
  const remaining = steps.filter((s) => s.state === 'to-do' && !s.optional).map((s) => s.id)
  const optionalRemaining = steps.filter((s) => s.state === 'to-do' && s.optional).map((s) => s.id)
  const unknownSteps = steps.filter((s) => s.state === 'could-not-check').map((s) => s.id)
  const required = steps.filter((s) => !s.optional)
  const doneRequired = required.filter((s) => s.state === 'done').length
  const unknownRequired = required.filter((s) => s.state === 'could-not-check').length

  // A percentage is only produced when every required step was actually read. Optional
  // work never changes the number, and unknown work never inflates it.
  const percent =
    required.length === 0 || unknownRequired > 0
      ? null
      : Math.round((doneRequired / required.length) * 100)

  const nextStep = steps.find((s) => s.state === 'to-do' && !s.optional) ?? null

  let headline: string
  if (steps.length === 0) {
    headline = 'Nothing to check yet for this stage.'
  } else if (unknownSteps.length > 0) {
    headline = `We could not check ${unknownSteps.length === 1 ? 'one step' : `${unknownSteps.length} steps`} just now, so this is not a score.`
  } else if (doneCount === steps.length) {
    headline = 'Everything on this list is in place.'
  } else {
    const left = steps.length - doneCount
    headline = `${left} step${left === 1 ? '' : 's'} left. None of them is urgent.`
  }

  return {
    steps,
    doneCount,
    remaining,
    optionalRemaining,
    unknownSteps,
    nextStepId: nextStep?.id ?? null,
    requiredTotal: required.length,
    percent,
    headline,
  }
}

/**
 * Suggests a stage from what the shop actually has. Returns null when it cannot tell.
 *
 * Barber count alone is not treated as the size of a business: locations are considered
 * first when the platform can report them, and a shop with no services yet is not
 * promoted because it happens to have staff records. Multi-location and franchise are
 * never inferred from staff counts; they are declared by the owner, because this version
 * keeps no location data to infer them from.
 */
export function inferStage(facts: ShopFacts): ShopStage | null {
  if (typeof facts.locationCount === 'number' && facts.locationCount > 1) return 'multi-location'
  if (facts.barberCount == null || facts.serviceCount == null) return null
  if (facts.barberCount >= 4) return 'established'
  if (facts.barberCount > 1) return 'growing'
  return 'starting'
}

/**
 * The five business stages, and what each one actually contains.
 *
 * Part 4.1 and 4.2 of the expansion directive. Two jobs, both deliberately pure:
 *
 *  1. Name the five stages a barber moves through — one chair, a growing shop, an
 *     established shop, several locations, a franchise — in a shop owner's words.
 *  2. Say, for each stage, which capabilities exist today and which are only planned,
 *     with the real destination that completes each one.
 *
 * The rule that matters most: a capability is only ever `available` when a page in this
 * application actually does it. Anything described in a proposal or a directive but not
 * built is `planned`, and the owner is told so in the same sentence. Nothing here grants
 * a permission, enables a feature or changes a setting; selecting a stage records an
 * intention and nothing else.
 *
 * `franchise` and most of `multi-location` are planned. This module is where that is
 * stated, so the UI cannot imply otherwise by accident.
 */

export type BusinessStage = 'starting' | 'growing' | 'established' | 'multi-location' | 'franchise'

/**
 * `available` — a working page in this application does it.
 * `partial`   — the engine exists but the owner has no complete screen for it.
 * `planned`   — not built. Never rendered as something the owner can go and use.
 */
export type CapabilityAvailability = 'available' | 'partial' | 'planned'

export interface StageCapability {
  id: string
  label: string
  /** Why an owner at this stage cares. One sentence, no jargon. */
  detail: string
  availability: CapabilityAvailability
  /** The real page that completes it, or null when there is nothing to open. */
  href: string | null
}

export interface BusinessStageDefinition {
  id: BusinessStage
  /** 1–5, shown as "Stage 2 of 5". */
  number: number
  label: string
  /** Who this stage is for, in plain words. */
  suits: string
  /** What the owner is mainly trying to do at this stage. */
  focus: string
  capabilities: StageCapability[]
  /** Said plainly when part of the stage is not built yet. */
  caveat?: string
}

export const BUSINESS_STAGES: readonly BusinessStageDefinition[] = [
  {
    id: 'starting',
    number: 1,
    label: 'Just you and one chair',
    suits: 'You are working alone and taking your first bookings.',
    focus: 'Look professional and let people book you without a phone call.',
    capabilities: [
      {
        id: 'identity',
        label: 'Your shop name, address and phone',
        detail: 'The details customers need before they trust you with a booking.',
        availability: 'available',
        href: '/dashboard/settings?tab=business',
      },
      {
        id: 'branding',
        label: 'Your look: logo and colours',
        detail: 'Pick a ready-made look or set your own, without a designer.',
        availability: 'available',
        href: '/dashboard/settings?tab=branding',
      },
      {
        id: 'services',
        label: 'Services and prices',
        detail: 'The cuts you offer, what they cost and how long they take.',
        availability: 'available',
        href: '/dashboard/services',
      },
      {
        id: 'barber-profile',
        label: 'Your barber profile',
        detail: 'Your photo and story, so a new customer knows who they are booking.',
        availability: 'available',
        href: '/dashboard/profile',
      },
      {
        id: 'schedule',
        label: 'Your own schedule',
        detail: 'When you are at the chair, so only those times can be booked.',
        availability: 'available',
        href: '/dashboard/schedule',
      },
      {
        id: 'booking',
        label: 'Online booking',
        detail: 'Let customers pick a time themselves, day or night.',
        availability: 'available',
        href: '/dashboard/settings?tab=booking',
      },
      {
        id: 'customer-accounts',
        label: 'Customer records',
        detail: 'Who has been in, what they had, and how to reach them.',
        availability: 'available',
        href: '/dashboard/customers',
      },
      {
        id: 'portfolio',
        label: 'Your portfolio',
        detail: 'Photos of your work, which is what sells the next haircut.',
        availability: 'available',
        href: '/dashboard/portfolio',
      },
      {
        id: 'booking-links',
        label: 'Your booking link and QR code',
        detail: 'One link to put in your Instagram bio, and a code to print for the chair.',
        availability: 'available',
        href: '/dashboard/my-numbers',
      },
      {
        id: 'basic-reports',
        label: 'Your basic numbers',
        detail: 'What you took and how busy you were, without a spreadsheet.',
        availability: 'available',
        href: '/dashboard/analytics',
      },
    ],
  },
  {
    id: 'growing',
    number: 2,
    label: 'Bringing on help',
    suits: 'You are busy enough to add another barber or someone on the front desk.',
    focus: 'Add people without losing control of the diary, the money or the customers.',
    capabilities: [
      {
        id: 'add-barbers',
        label: 'Add barbers',
        detail: 'Each person gets their own schedule and their own bookings.',
        availability: 'available',
        href: '/dashboard/barbers',
      },
      {
        id: 'invitations',
        label: 'Invite staff to sign in',
        detail: 'They get their own login instead of sharing yours.',
        availability: 'available',
        href: '/dashboard/staff',
      },
      {
        id: 'co-owner',
        label: 'Give a trusted person co-owner access',
        detail: 'They can run the shop day to day, but not hand over or delete the business.',
        availability: 'available',
        href: '/dashboard/staff',
      },
      {
        id: 'staff-schedule',
        label: 'Staff schedules and time off',
        detail: 'Who is in today, and when somebody is away.',
        availability: 'available',
        href: '/dashboard/schedule',
      },
      {
        id: 'permissions',
        label: 'Decide who sees the money',
        detail: 'A barber can run their day without seeing the whole business.',
        availability: 'available',
        href: '/dashboard/staff',
      },
      {
        id: 'commissions',
        label: 'Commissions',
        detail: 'What each barber earns from what they cut, worked out for you.',
        availability: 'available',
        href: '/dashboard/commissions',
      },
      {
        id: 'time-clock',
        label: 'Clock in and out',
        detail: 'Hours that stand up when it is time to pay someone.',
        availability: 'available',
        href: '/dashboard/time-clock',
      },
      {
        id: 'customers',
        label: 'Customer management',
        detail: 'Notes, history and who belongs to which barber.',
        availability: 'available',
        href: '/dashboard/customers',
      },
      {
        id: 'waitlist',
        label: 'Walk-in waitlist',
        detail: 'People who turn up without booking can still get seen.',
        availability: 'available',
        href: '/dashboard/waitlist',
      },
      {
        id: 'reminders',
        label: 'Appointment reminders',
        detail: 'Fewer people forget, so fewer chairs sit empty.',
        availability: 'available',
        href: '/dashboard/settings?tab=features',
      },
    ],
  },
  {
    id: 'established',
    number: 3,
    label: 'An established shop',
    suits: 'You have a steady team and want the business to run better, not just busier.',
    focus: 'Make the money predictable and stop good customers drifting away.',
    capabilities: [
      {
        id: 'analytics',
        label: 'Deeper numbers',
        detail: 'Which services and which barbers actually earn the most.',
        availability: 'available',
        href: '/dashboard/analytics',
      },
      {
        id: 'payroll',
        label: 'Payroll-ready reporting',
        detail: 'Hours, commission and pay in a form you or a bookkeeper can use.',
        availability: 'available',
        href: '/dashboard/payroll',
      },
      {
        id: 'memberships',
        label: 'Memberships',
        detail: 'Regular income from your regulars. The plans and payments run on the server; there is no owner screen for them yet.',
        availability: 'partial',
        href: null,
      },
      {
        id: 'gift-cards',
        label: 'Gift cards',
        detail: 'Sold and redeemed in the shop, tracked so nothing is paid twice.',
        availability: 'available',
        href: '/dashboard/gift-cards',
      },
      {
        id: 'ecommerce',
        label: 'Online shop',
        detail: 'Products and orders, if you sell anything beyond the chair.',
        availability: 'available',
        href: '/dashboard/ecommerce',
      },
      {
        id: 'inventory',
        label: 'Stock',
        detail: 'What you have on the shelf and when to reorder.',
        availability: 'available',
        href: '/dashboard/inventory',
      },
      {
        id: 'marketing',
        label: 'Marketing campaigns',
        detail: 'A message to a group of customers, with the audience shown before you send.',
        availability: 'available',
        href: '/dashboard/marketing',
      },
      {
        id: 'retention',
        label: 'Bringing customers back',
        detail: 'Who is due back and who has drifted away, ready to act on.',
        availability: 'available',
        href: '/dashboard/rebooking',
      },
      {
        id: 'staff-performance',
        label: 'How each barber is doing',
        detail: 'Bookings, takings and utilisation per person.',
        availability: 'available',
        href: '/dashboard/analytics',
      },
      {
        id: 'reviews',
        label: 'Reviews',
        detail: 'Ask happy customers, and show the good ones on your site.',
        availability: 'available',
        href: '/dashboard/reviews',
      },
    ],
  },
  {
    id: 'multi-location',
    number: 4,
    label: 'More than one shop',
    suits: 'You run, or are about to run, a second location.',
    focus: 'Keep each shop’s bookings and customers separate, and still see the whole picture.',
    caveat:
      'Running several shops from one login is not built yet. Today each location is its own copy of this website, with its own records. Nothing here is switched on for you.',
    capabilities: [
      {
        id: 'second-location',
        label: 'A second location',
        detail: 'Today this means a separate copy of the website for that shop, with its own bookings, staff and customers. There is no shared dashboard across the two.',
        availability: 'partial',
        href: null,
      },
      {
        id: 'shared-brand',
        label: 'The same look across shops',
        detail: 'Use the same branding settings on each copy so customers recognise you.',
        availability: 'available',
        href: '/dashboard/settings?tab=branding',
      },
      {
        id: 'central-dashboard',
        label: 'One dashboard for every shop',
        detail: 'Not built. Needs an organization layer above each shop, which does not exist in this version.',
        availability: 'planned',
        href: null,
      },
      {
        id: 'location-managers',
        label: 'A manager for one location',
        detail: 'Not built. Today a co-owner sees the whole business they belong to.',
        availability: 'planned',
        href: null,
      },
      {
        id: 'consolidated-reporting',
        label: 'Compare shops side by side',
        detail: 'Not built. Adding shops up would need records that are currently kept apart on purpose.',
        availability: 'planned',
        href: null,
      },
      {
        id: 'cross-location-booking',
        label: 'Book across shops',
        detail: 'Not built. Each shop’s diary stays its own until the organization layer exists.',
        availability: 'planned',
        href: null,
      },
    ],
  },
  {
    id: 'franchise',
    number: 5,
    label: 'A franchise',
    suits: 'You are building a brand that other people run shops under.',
    focus: 'Keep the brand and the standards consistent while each owner runs their own shop.',
    caveat:
      'None of the corporate layer is built. There is no franchisee management, no regional roles and no corporate reporting in this version. What exists today is one well-branded copy of the website per shop.',
    capabilities: [
      {
        id: 'corporate-admin',
        label: 'Corporate administration',
        detail: 'Not built. There is no organization, franchisee or regional structure in the data model.',
        availability: 'planned',
        href: null,
      },
      {
        id: 'franchisee-management',
        label: 'Managing franchisees',
        detail: 'Not built. Each franchisee would run their own copy of the website.',
        availability: 'planned',
        href: null,
      },
      {
        id: 'brand-governance',
        label: 'Brand standards',
        detail: 'Partly possible today: each copy can be set to the same logo and colours.',
        availability: 'partial',
        href: '/dashboard/settings?tab=branding',
      },
      {
        id: 'location-oversight',
        label: 'Oversight of every location',
        detail: 'Not built. There is no read-only corporate view of another shop’s records, and none is implied.',
        availability: 'planned',
        href: null,
      },
      {
        id: 'franchise-reporting',
        label: 'Franchise performance reporting',
        detail: 'Not built. Adding shops together is deliberately not possible yet.',
        availability: 'planned',
        href: null,
      },
      {
        id: 'approved-customisation',
        label: 'Approved customisation',
        detail: 'Not built. Today a shop can change its own branding without any approval step.',
        availability: 'planned',
        href: null,
      },
    ],
  },
]

export function stageDefinition(stage: BusinessStage): BusinessStageDefinition {
  return BUSINESS_STAGES.find((s) => s.id === stage) ?? BUSINESS_STAGES[0]
}

/** Capabilities an owner can actually open today. */
export function availableCapabilities(stage: BusinessStage): StageCapability[] {
  return stageDefinition(stage).capabilities.filter((c) => c.availability !== 'planned')
}

/** Everything still to be built for a stage, named rather than hidden. */
export function plannedCapabilities(stage: BusinessStage): StageCapability[] {
  return stageDefinition(stage).capabilities.filter((c) => c.availability === 'planned')
}

export const BUSINESS_STAGE_IDS: readonly BusinessStage[] = BUSINESS_STAGES.map((s) => s.id)

export function isBusinessStage(value: unknown): value is BusinessStage {
  return typeof value === 'string' && (BUSINESS_STAGE_IDS as readonly string[]).includes(value)
}

// ─── Declared intention ──────────────────────────────────────────────────────

export interface IntentOption {
  id: string
  /** What the owner would say, not what the platform calls it. */
  label: string
  /** One line of what choosing it means. */
  detail: string
  stage: BusinessStage
}

/**
 * The four directions an owner can declare. `established` is included because a shop
 * that is happy at one location should be able to say so instead of being pushed
 * towards expansion.
 */
export const INTENT_OPTIONS: readonly IntentOption[] = [
  {
    id: 'alone',
    label: 'I am starting alone',
    detail: 'One chair, and I want the basics right first.',
    stage: 'starting',
  },
  {
    id: 'hiring',
    label: 'I am planning to hire',
    detail: 'I want more barbers working with me.',
    stage: 'growing',
  },
  {
    id: 'steady',
    label: 'I run one busy shop',
    detail: 'One location is the plan; I want it running well.',
    stage: 'established',
  },
  {
    id: 'another-shop',
    label: 'I am opening another shop',
    detail: 'I am heading for a second location.',
    stage: 'multi-location',
  },
  {
    id: 'franchise',
    label: 'I want to build a franchise',
    detail: 'Other people will run shops under my brand.',
    stage: 'franchise',
  },
]

export function intentForStage(stage: BusinessStage): IntentOption | null {
  return INTENT_OPTIONS.find((o) => o.stage === stage) ?? null
}

export function stageForIntent(intentId: string | null | undefined): BusinessStage | null {
  if (!intentId) return null
  return INTENT_OPTIONS.find((o) => o.id === intentId)?.stage ?? null
}

// ─── Current stage vs intended stage ─────────────────────────────────────────

export interface StageResolution {
  /** What the shop's own records suggest, or null when they could not be read. */
  current: BusinessStage | null
  /** What the owner said they are heading for, or null when they have not said. */
  intended: BusinessStage | null
  /** The stage to show. Intention wins, then evidence, then the first stage. */
  effective: BusinessStage
  /** True when the declared direction is further along than the records suggest. */
  aheadOfEvidence: boolean
  /** One plain sentence explaining the decision. */
  note: string
}

/**
 * Decide which stage to show. Intention is never inferred and evidence never overrides
 * what the owner said; when the two disagree the owner is told, not silently corrected.
 *
 * `current` must be passed in already resolved (or null when the read failed), so this
 * function stays pure and every branch can be pinned by a test.
 */
export function resolveStage(
  current: BusinessStage | null,
  intended: BusinessStage | null,
): StageResolution {
  const effective = intended ?? current ?? 'starting'
  const currentNumber = current ? stageDefinition(current).number : null
  const effectiveNumber = stageDefinition(effective).number
  const aheadOfEvidence = currentNumber !== null && effectiveNumber > currentNumber

  let note: string
  if (intended && current) {
    note =
      intended === current
        ? `Your records and your plan agree: ${stageDefinition(effective).label.toLowerCase()}.`
        : aheadOfEvidence
          ? `You said you are heading for ${stageDefinition(intended).label.toLowerCase()}. Your records still look like ${stageDefinition(current).label.toLowerCase()}, which is normal on the way there.`
          : `You said ${stageDefinition(intended).label.toLowerCase()}. Your records show more activity than that, so the earlier stage is only a plan, not a limit.`
  } else if (intended) {
    note = `You told us you are heading for ${stageDefinition(intended).label.toLowerCase()}. We could not read enough about your shop to suggest a stage ourselves.`
  } else if (current) {
    note = `From your records this looks like ${stageDefinition(current).label.toLowerCase()}. If that is not where you are heading, say so below.`
  } else {
    note = 'We could not read enough about your shop to suggest a stage. You can still pick where you are heading.'
  }

  return { current, intended, effective, aheadOfEvidence, note }
}

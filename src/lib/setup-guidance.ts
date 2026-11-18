/**
 * Getting-started guidance, in a shop owner's words.
 *
 * Part 6 of the directive: copy and additive guidance only. This module decides what
 * to suggest and how to say it. It never changes a setting, never enables a feature and
 * never turns a recommendation into a requirement, and it has no database access, so
 * every rule below is pinned by tests instead of by a screenshot.
 *
 * The one rule that matters most: progress is computed from facts the shop actually
 * has. A thing we could not read is reported as "we could not check", never as done.
 */

export type ShopStage = 'starting' | 'growing' | 'established' | 'multi-location'

export interface StageCopy {
  id: ShopStage
  label: string
  /** Who this is for, in plain words. */
  suits: string
  /** What to do next, in the order worth doing it. */
  steps: GuidanceStep[]
}

export interface GuidanceStep {
  id: string
  /** Imperative, everyday language. No "configure", no "publish". */
  title: string
  /** Why it matters to the shop. */
  why: string
  /** True when the shop is fine without it. */
  optional?: boolean
}

export const STAGE_COPY: StageCopy[] = [
  {
    id: 'starting',
    label: 'Just opening',
    suits: 'You are setting up your first chair and taking your first bookings.',
    steps: [
      { id: 'identity', title: 'Add your shop name, phone and address', why: 'Customers need to know who you are and how to find you.' },
      { id: 'hours', title: 'Say when you are open', why: 'Customers can only book times you are actually there.' },
      { id: 'services', title: 'Add the cuts you offer and what they cost', why: 'This is what a customer picks from when they book.' },
      { id: 'team', title: 'Add yourself as a barber', why: 'Bookings are attached to a person, so your chair needs a name.' },
      { id: 'website', title: 'Turn your website on', why: 'Until you do, the site shows a placeholder instead of your shop.' },
    ],
  },
  {
    id: 'growing',
    label: 'Bringing on help',
    suits: 'You are busy enough to add another barber or a front desk.',
    steps: [
      { id: 'team', title: 'Add the barbers who work with you', why: 'Each barber gets their own schedule and their own bookings.' },
      { id: 'permissions', title: 'Decide who can see money and settings', why: 'Staff can run their own day without seeing the whole business.', optional: true },
      { id: 'reminders', title: 'Turn on appointment reminders', why: 'Fewer people forget, so fewer chairs sit empty.', optional: true },
      { id: 'walkins', title: 'Set up the waitlist for walk-ins', why: 'People who turn up without booking can still get seen.', optional: true },
    ],
  },
  {
    id: 'established',
    label: 'Established shop',
    suits: 'You have a steady team and want the business to run better, not just busier.',
    steps: [
      { id: 'reports', title: 'Look at your numbers once a week', why: 'You can see which services and barbers earn the most.' },
      { id: 'memberships', title: 'Offer regulars a membership', why: 'Steady income, and your regulars come back more often.', optional: true },
      { id: 'reviews', title: 'Ask happy customers for a review', why: 'Reviews are how new customers decide to try you.', optional: true },
      { id: 'seo', title: 'Check what search engines can read', why: 'A few missing details keep you out of local search results.' },
    ],
  },
  {
    id: 'multi-location',
    label: 'More than one shop',
    suits: 'You run, or plan to run, more than one location.',
    steps: [
      { id: 'per-location', title: 'Give each shop its own copy of this website', why: 'Each location keeps its own bookings, staff and customers separate.' },
      { id: 'shared-brand', title: 'Keep the same look across shops', why: 'Customers should recognise you wherever they book.' },
      { id: 'consolidated', title: 'Ask about combined reporting', why: 'Comparing shops needs a setup that does not exist yet in this version.', optional: true },
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
}

export type StepState = 'done' | 'to-do' | 'could-not-check'

export interface StepProgress {
  id: string
  state: StepState
}

export interface GuidanceProgress {
  steps: StepProgress[]
  doneCount: number
  /** Null when any needed fact could not be read. */
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
    // Multi-location steps describe a setup this version does not offer, so they are
    // never reported as done and never reported as the owner's failure either.
    case 'per-location':
    case 'shared-brand':
    case 'consolidated':
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
    if (state) steps.push({ id: step.id, state })
  }
  const doneCount = steps.filter((s) => s.state === 'done').length
  const unknown = steps.filter((s) => s.state === 'could-not-check').length
  const percent = steps.length === 0 || unknown > 0 ? null : Math.round((doneCount / steps.length) * 100)

  let headline: string
  if (steps.length === 0) {
    headline = 'Nothing to check yet for this stage.'
  } else if (unknown > 0) {
    headline = `We could not check ${unknown === 1 ? 'one step' : `${unknown} steps`} just now, so this is not a score.`
  } else if (doneCount === steps.length) {
    headline = 'Everything on this list is in place.'
  } else {
    headline = `${steps.length - doneCount} step${steps.length - doneCount === 1 ? '' : 's'} left. None of them is urgent.`
  }

  return { steps, doneCount, percent, headline }
}

/** Suggests a stage from what the shop actually has. Returns null when it cannot tell. */
export function inferStage(facts: ShopFacts): ShopStage | null {
  if (facts.barberCount == null || facts.serviceCount == null) return null
  if (facts.barberCount >= 4) return 'established'
  if (facts.barberCount > 1) return 'growing'
  return facts.serviceCount > 0 ? 'starting' : 'starting'
}

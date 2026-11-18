/**
 * Recommended homepage sections for each stage of business (Part 5.3).
 *
 * Recommendations only. This module cannot enable, save, publish or overwrite
 * anything: it returns a suggested order of the existing module ids, and the
 * caller decides whether to offer it. Two guarantees, enforced by tests:
 *
 *   - every suggested id exists in `HOME_MODULE_IDS`
 *   - `hero` is always first, because the resolver treats it as always-on
 *
 * Reasons are written for an owner, not for a developer.
 */

import { HOME_MODULE_IDS, type HomeModuleId } from './home-modules'

export type BusinessStage = 'independent' | 'growing' | 'established'

export interface StageRecommendation {
  stage: BusinessStage
  label: string
  /** Suggested order of existing module ids. Hero is always first. */
  modules: HomeModuleId[]
  /** One sentence per included section, in the same order. */
  reasons: string[]
  /** Plain-language description of who this suits. */
  suits: string
}

const RECOMMENDATIONS: Record<BusinessStage, Omit<StageRecommendation, 'stage'>> = {
  independent: {
    label: 'Independent barber',
    modules: ['hero', 'quickBook', 'services', 'featuredWork', 'reviews', 'visit'],
    reasons: [
      'Your opening section, so the first screen says who you are.',
      'Booking within reach straight away, which is what most visitors came to do.',
      'Your service list and prices, so nobody has to ask.',
      'Your own work, because a portfolio sells a single chair better than a team page.',
      'Reviews as proof you are worth the wait.',
      'How to find you, for walk-ins.',
    ],
    suits: 'One chair, one barber, no team to introduce.',
  },
  growing: {
    label: 'Growing barbershop',
    modules: ['hero', 'quickBook', 'services', 'team', 'featuredWork', 'reviews', 'visit', 'finalCta'],
    reasons: [
      'Your opening section, so the first screen says who you are.',
      'Booking within reach straight away.',
      'Services and prices for people comparing shops.',
      'The team, because clients choose a barber as much as a shop.',
      'Recent work to show the standard is consistent across chairs.',
      'Reviews from regulars.',
      'Find us, for new customers.',
      'A closing prompt for people who scrolled the whole page.',
    ],
    suits: 'A few chairs, a team, and enough bookings that people compare before choosing.',
  },
  established: {
    label: 'Established shop',
    modules: ['hero', 'services', 'team', 'beforeAfter', 'featuredWork', 'reviews', 'socialGallery', 'shopExperience', 'visit'],
    reasons: [
      'Your opening section, so the first screen says who you are.',
      'The full service menu, because established shops are chosen on range and price.',
      'The whole team, with the seniority a long-standing shop has earned.',
      'Before and after, the clearest proof of quality.',
      'Featured work from across the team.',
      'Reviews, the strongest signal for a shop with history.',
      'Social gallery, for shops with a following.',
      'The experience around the cut: the reason people come back.',
      'Find us, including hours.',
    ],
    suits: 'A full team, a loyal base, and a shop people look up before visiting.',
  },
}

/** All three recommendations, in the order they should be offered. */
export function stageRecommendations(): StageRecommendation[] {
  return (['independent', 'growing', 'established'] as const).map((stage) => ({
    stage,
    ...RECOMMENDATIONS[stage],
    modules: normalise(RECOMMENDATIONS[stage].modules),
  }))
}

function normalise(modules: HomeModuleId[]): HomeModuleId[] {
  const valid = modules.filter((m) => (HOME_MODULE_IDS as readonly HomeModuleId[]).includes(m))
  // Hero is always-on in the resolver; a recommendation that omitted it would
  // describe a page that cannot exist.
  const withoutHero = valid.filter((m) => m !== 'hero')
  return ['hero', ...withoutHero]
}

/** The recommendation for one stage. Unknown stages fall back to the first. */
export function recommendForStage(stage: unknown): StageRecommendation {
  const key = (typeof stage === 'string' && (stage in RECOMMENDATIONS) ? stage : 'independent') as BusinessStage
  return {
    stage: key,
    ...RECOMMENDATIONS[key],
    modules: normalise(RECOMMENDATIONS[key].modules),
  }
}

/**
 * A stage guess from what the business already has, so the owner is not asked a
 * question the records already answer. Returns null when there is not enough to
 * go on, so the caller can ask instead of guessing.
 */
export function inferStage(input: { barbers?: number | null; services?: number | null; reviews?: number | null }): BusinessStage | null {
  const barbers = typeof input.barbers === 'number' ? input.barbers : 0
  const services = typeof input.services === 'number' ? input.services : 0
  if (!barbers && !services) return null
  if (barbers <= 1) return 'independent'
  if (barbers <= 3) return 'growing'
  return 'established'
}

/**
 * What would change if the owner accepted a recommendation. Returns only the
 * differences, so the screen can say "this adds the team section" rather than
 * re-listing everything. Never applies anything.
 */
export function recommendationDiff(current: HomeModuleId[] | null | undefined, recommended: HomeModuleId[]): { add: HomeModuleId[]; remove: HomeModuleId[]; keep: HomeModuleId[] } {
  const now = Array.isArray(current) ? current.filter((m) => (HOME_MODULE_IDS as readonly HomeModuleId[]).includes(m)) : []
  if (now.length === 0) return { add: recommended.filter((m) => m !== 'hero'), remove: [], keep: ['hero'] }
  const add = recommended.filter((m) => !now.includes(m))
  const remove = now.filter((m) => !recommended.includes(m))
  const keep = now.filter((m) => recommended.includes(m))
  return { add, remove, keep }
}

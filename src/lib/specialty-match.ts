/**
 * Specialty Matching
 *
 * Surfaces barbers whose declared free-text specialty (e.g. "Fades • Tapers
 * • Beard Work" — the existing Barber.specialty field) overlaps with the
 * chosen service's name tokens.
 *
 * Purely data-driven — NO hardcoded barber↔service mappings and NO new
 * schema fields. If a barber has no specialty text, or there is no token
 * overlap, ranking falls back to the existing display order (`order asc`).
 */

export interface SpecialtyMatchInfo {
  /** Number of overlapping stemmed tokens. 0 = no match. */
  overlap: number
  /** The shared terms, for display/debugging. */
  matchedTerms: string[]
}

const STOP_WORDS = new Set(['the', 'and', 'with', 'for', 'a', 'an', 'of', 'in', 'my', 'your'])

/**
 * Normalize a phrase into comparable stemmed tokens.
 * "Fades • Tapers" → ["fade", "taper"]; "Skin Fade" → ["skin", "fade"].
 */
export function specialtyTokens(phrase: string | null | undefined): string[] {
  if (!phrase) return []
  const raw = phrase
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
  const stemmed = raw.map((t) => {
    // crude plural stem: "fades"→"fade", "tapers"→"taper", "cuts"→"cut",
    // while "watches"→"watch" / "boxes"→"box" ("es" only after s/x/z/ch/sh)
    if (/(?:[sxz]|ch|sh)es$/.test(t) && t.length > 3) return t.replace(/es$/, '')
    if (/s$/.test(t) && t.length > 2) return t.replace(/s$/, '')
    return t
  })
  return [...new Set(stemmed)]
}

/**
 * Compute the token overlap between a service name and a barber's specialty.
 */
export function matchSpecialty(
  serviceName: string | null | undefined,
  barberSpecialty: string | null | undefined
): SpecialtyMatchInfo {
  const serviceSet = new Set(specialtyTokens(serviceName))
  const barberSet = new Set(specialtyTokens(barberSpecialty))
  if (serviceSet.size === 0 || barberSet.size === 0) return { overlap: 0, matchedTerms: [] }

  const matchedTerms: string[] = []
  // Preserve the barber's own specialty phrasing order for the matched terms
  for (const token of specialtyTokens(barberSpecialty)) {
    if (serviceSet.has(token) && !matchedTerms.includes(token)) matchedTerms.push(token)
  }
  return { overlap: matchedTerms.length, matchedTerms }
}

/**
 * Rank barbers for a chosen service: specialty matches first (more overlap
 * first), then the existing `order asc`. Non-matching barbers keep their
 * original relative order after matching ones. Pure function.
 */
export function rankBarbersForService<T extends { specialty?: string | null; order?: number | null }>(
  barbers: T[],
  serviceName: string | null | undefined
): Array<{ barber: T; match: SpecialtyMatchInfo }> {
  return barbers
    .map((barber) => ({ barber, match: matchSpecialty(serviceName, barber.specialty) }))
    .sort((a, b) => {
      // Stable sort: compare overlap, then order, then keep original position
      if (a.match.overlap !== b.match.overlap) return b.match.overlap - a.match.overlap
      const ao = a.barber.order ?? 0
      const bo = b.barber.order ?? 0
      return ao - bo
    })
}

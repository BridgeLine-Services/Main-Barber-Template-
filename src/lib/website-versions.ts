/**
 * Website version history (Section 8.2 and 8.3 of the platform brief).
 *
 * Publishing writes an append-only snapshot. Restoring an old version copies it into the
 * draft and nothing else, so a rollback still goes through the normal publish step and the
 * live site never changes by surprise.
 */

/** The editable fields that make up a publishable snapshot. Moved here from the route so
 *  one list decides what a version contains. */
export const PUBLISH_FIELDS = [
  'heroEyebrow', 'heroTitle', 'heroDescription', 'heroImageUrl',
  'heroPrimaryCtaLabel', 'heroPrimaryCtaHref', 'heroSecondaryCtaLabel',
  'heroSecondaryCtaHref', 'showServices', 'showTeam', 'showReviews',
  'showVisit', 'showFaq', 'showFinalCta', 'servicesTitle',
  'servicesDescription', 'teamTitle', 'teamDescription', 'reviewsTitle',
  'reviewsDescription', 'visitTitle', 'visitDescription', 'faqTitle',
  'faqDescription', 'finalCtaTitle', 'finalCtaDescription',
  'featuredReviewCount', 'visualPreset', 'visualConfig', 'homeModules', 'navigation',
  'navigation',
] as const

export type PublishField = (typeof PUBLISH_FIELDS)[number]

const FIELD_LABELS: Record<string, string> = {
  heroEyebrow: 'hero eyebrow',
  heroTitle: 'hero title',
  heroDescription: 'hero description',
  heroImageUrl: 'hero image',
  heroPrimaryCtaLabel: 'primary button label',
  heroPrimaryCtaHref: 'primary button link',
  heroSecondaryCtaLabel: 'secondary button label',
  heroSecondaryCtaHref: 'secondary button link',
  showServices: 'services section',
  showTeam: 'team section',
  showReviews: 'reviews section',
  showVisit: 'visit section',
  showFaq: 'FAQ section',
  showFinalCta: 'closing call to action',
  servicesTitle: 'services heading',
  servicesDescription: 'services description',
  teamTitle: 'team heading',
  teamDescription: 'team description',
  reviewsTitle: 'reviews heading',
  reviewsDescription: 'reviews description',
  visitTitle: 'visit heading',
  visitDescription: 'visit description',
  faqTitle: 'FAQ heading',
  faqDescription: 'FAQ description',
  finalCtaTitle: 'closing heading',
  finalCtaDescription: 'closing description',
  featuredReviewCount: 'number of featured reviews',
  visualPreset: 'visual preset',
  visualConfig: 'layout settings',
  homeModules: 'homepage modules',
  navigation: 'navigation',
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

/** Version numbers count up from 1 and are never reused. */
export function nextVersionNumber(existing: number[]): number {
  let highest = 0
  for (const value of existing) {
    if (Number.isFinite(value) && value > highest) highest = Math.floor(value)
  }
  return highest + 1
}

export function buildVersionEntry(input: {
  businessId: string
  version: number
  snapshot: Record<string, unknown>
  summary?: string | null
  authorId?: string | null
  publishedAt: string
}): {
  businessId: string
  version: number
  snapshot: Record<string, unknown>
  summary: string | null
  authorId: string | null
  publishedAt: Date
} {
  return {
    businessId: input.businessId,
    version: Math.max(1, Math.floor(input.version)),
    snapshot: input.snapshot,
    summary: cleanSummary(input.summary),
    authorId: input.authorId ?? null,
    publishedAt: new Date(input.publishedAt),
  }
}

/** A summary is a sentence for a person: trimmed, bounded, never a place for secrets. */
export function cleanSummary(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, 200)
}

function comparable(value: unknown): string {
  return JSON.stringify(value ?? null)
}

/** Which fields differ between two snapshots. */
export function changedFields(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>,
): string[] {
  const fields: string[] = []
  for (const field of PUBLISH_FIELDS) {
    const before = previous ? previous[field] : undefined
    if (comparable(before) !== comparable(next[field])) fields.push(field)
  }
  return fields
}

/** Plain words for what a publish changed. Empty history is described, not guessed at. */
export function describeSnapshotChange(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>,
): string {
  const changed = changedFields(previous, next)
  if (!previous) return 'First published version.'
  if (changed.length === 0) return 'Published with no visible change.'
  const labels = changed.map(fieldLabel)
  if (labels.length === 1) return `Changed the ${labels[0]}.`
  if (labels.length <= 3) return `Changed the ${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}.`
  return `Changed ${labels.length} things, including the ${labels[0]} and the ${labels[1]}.`
}

/**
 * Turn a stored snapshot into a patch for the DRAFT fields. Only known fields are copied, so
 * a stored row can never write businessId, ids or timestamps back into the record.
 */
export function snapshotToDraftPatch(snapshot: unknown): Record<string, unknown> {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return {}
  const source = snapshot as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  for (const field of PUBLISH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) patch[field] = source[field]
  }
  return patch
}

/** One line for the history list. */
export function describeVersion(version: {
  version: number
  publishedAt: Date | string
  summary: string | null
}): string {
  const when = new Date(version.publishedAt)
  const stamp = Number.isNaN(when.getTime()) ? 'an unknown date' : when.toISOString().slice(0, 16).replace('T', ' ')
  return `Version ${version.version}, published ${stamp} UTC${version.summary ? `. ${version.summary}` : '.'}`
}

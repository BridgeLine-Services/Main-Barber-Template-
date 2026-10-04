/**
 * Service-linked portfolio helpers.
 *
 * Pure functions used by the customer-facing portfolio gallery so that
 * filtering behavior is testable without a database.
 */

export interface PortfolioAsset {
  id: string
  url: string
  altText?: string | null
  caption?: string | null
  service?: { id: string; name: string; price?: number | null } | null
  [key: string]: unknown
}

export interface PortfolioFilter {
  /** 'all' or a service id */
  id: string
  label: string
}

/**
 * Build the list of service filters actually represented in the given
 * portfolio assets — only categories the business has configured work for.
 * 'All' is always first; services follow first-seen (sortOrder) order.
 */
export function buildPortfolioFilters(assets: PortfolioAsset[]): PortfolioFilter[] {
  const seen: PortfolioFilter[] = []
  for (const asset of assets) {
    if (asset.service && !seen.some((f) => f.id === asset.service!.id)) {
      seen.push({ id: asset.service.id, label: asset.service.name })
    }
  }
  return [{ id: 'all', label: 'All work' }, ...seen]
}

/**
 * Filter portfolio assets by the selected filter id ('all' or a serviceId).
 * Unlinked assets (no service) appear only under 'all'.
 */
export function filterPortfolio(assets: PortfolioAsset[], filterId: string): PortfolioAsset[] {
  if (filterId === 'all') return assets
  return assets.filter((a) => a.service?.id === filterId)
}

/* ── Homepage Featured Work categories ──────────────────────────────────── */

export interface FeaturedPortfolioAsset extends PortfolioAsset {
  focalX?: number | null
  focalY?: number | null
  barber?: { id: string; name: string; slug: string | null } | null
  /** True when this asset is one side of a published before/after pair. */
  isBeforeAfter?: boolean
}

/**
 * Canonical Featured Work categories, in display order. Filter chips are
 * derived from the business's real published portfolio — a category only
 * appears when at least one published asset maps to it.
 */
export const FEATURED_CATEGORIES = [
  { id: 'haircut', label: 'Haircut' },
  { id: 'fade', label: 'Fade' },
  { id: 'beard', label: 'Beard' },
  { id: 'lineup', label: 'Lineup' },
  { id: 'kids', label: 'Kids' },
  { id: 'specialty', label: 'Specialty' },
  { id: 'before-after', label: 'Before & After' },
] as const

/**
 * Map a linked service name to a canonical Featured Work category.
 * Keyword matching, checked in priority order so compound names land
 * sensibly ("Kids Haircut" → kids, "Haircut + Beard" → beard).
 */
export function categoryFromServiceName(name: string | null | undefined): string | null {
  if (!name) return null
  const n = name.toLowerCase()
  if (/(kid|child)/.test(n)) return 'kids'
  if (/fade|taper|burst|skin\b/.test(n)) return 'fade'
  if (/line ?-?up|edge ?-?up/.test(n)) return 'lineup'
  if (/beard/.test(n)) return 'beard'
  if (
    /specialty|premium|signature|hot towel|shave|facial|scalp|design|color|bleach|perm|locs|dread|braid|twist|waves/.test(
      n
    )
  ) {
    return 'specialty'
  }
  if (/haircut|cut|trim|style|buzz/.test(n)) return 'haircut'
  return null
}

/** Resolve the Featured Work category for a single asset. */
export function featuredAssetCategory(asset: FeaturedPortfolioAsset): string | null {
  // Before/after membership wins: those images are explicitly curated pairs.
  if (asset.isBeforeAfter) return 'before-after'
  return categoryFromServiceName(asset.service?.name)
}

/**
 * Build the Featured Work filter chips from real published assets:
 * 'All' first, then each canonical category that actually contains
 * published portfolio content, in FEATURED_CATEGORIES order.
 */
export function buildFeaturedFilters(
  assets: FeaturedPortfolioAsset[]
): { id: string; label: string }[] {
  const present = new Set<string>()
  for (const asset of assets) {
    const category = featuredAssetCategory(asset)
    if (category) present.add(category)
  }
  return [
    { id: 'all', label: 'All' },
    ...FEATURED_CATEGORIES.filter((c) => present.has(c.id)).map((c) => ({ id: c.id, label: c.label })),
  ]
}

/** Filter Featured Work assets by the selected category chip. */
export function filterFeatured(
  assets: FeaturedPortfolioAsset[],
  filterId: string
): FeaturedPortfolioAsset[] {
  if (filterId === 'all') return assets
  return assets.filter((a) => featuredAssetCategory(a) === filterId)
}

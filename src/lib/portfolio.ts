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
  service?: { id: string; name: string } | null
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

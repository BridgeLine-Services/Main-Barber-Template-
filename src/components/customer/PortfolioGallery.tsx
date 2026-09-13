'use client'

import { useState } from 'react'
import { Images } from 'lucide-react'
import { buildPortfolioFilters, filterPortfolio, PortfolioAsset } from '@/lib/portfolio'

/**
 * Customer-facing portfolio gallery with optional per-service filtering.
 *
 * - Filters are derived from the actual assets (only configured services
 *   appear as categories).
 * - Images lazy-load and always carry accessible alt text.
 * - Fully usable without images: captions render as text and every image
 *   is inside a <figure> with a textual caption fallback.
 */
export default function PortfolioGallery({
  assets,
  altFallback,
}: {
  assets: PortfolioAsset[]
  /** Fallback alt text (e.g. the barber's name) when an asset lacks altText. */
  altFallback: string
}) {
  const filters = buildPortfolioFilters(assets)
  const [active, setActive] = useState('all')
  const visible = filterPortfolio(assets, active)

  if (assets.length === 0) return null

  return (
    <div>
      {/* Service filter chips — only rendered when there is a real choice */}
      {filters.length > 1 && (
        <div
          className="flex flex-wrap gap-2 mb-6"
          role="group"
          aria-label="Filter portfolio by service"
        >
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={active === filter.id}
              onClick={() => setActive(filter.id)}
              className={
                active === filter.id
                  ? 'px-3 py-1.5 rounded-full text-sm font-medium border border-accent/60 bg-accent/15 text-accent transition-colors'
                  : 'px-3 py-1.5 rounded-full text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors'
              }
            >
              {filter.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {visible.map((asset) => (
          <figure key={asset.id} className="rounded-lg overflow-hidden border bg-card">
            <div className="aspect-square bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={asset.url}
                alt={asset.altText || `${altFallback} portfolio work${asset.service ? ` — ${asset.service.name}` : ''}`}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            </div>
            {(asset.caption || asset.service) && (
              <figcaption className="px-3 py-2 text-xs text-muted-foreground">
                {asset.caption && <span className="block truncate">{asset.caption}</span>}
                {asset.service && (
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-accent/90 mt-0.5">
                    {asset.service.name}
                  </span>
                )}
              </figcaption>
            )}
          </figure>
        ))}
      </div>

      {visible.length === 0 && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Images className="h-4 w-4" aria-hidden="true" />
          No work in this category yet.
        </p>
      )}
    </div>
  )
}

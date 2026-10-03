'use client'

import { useState } from 'react'
import { Images } from 'lucide-react'
import type { GalleryLayout } from '@/lib/visual-config'
import { GalleryGrid } from '@/components/customer/GalleryGrid'
import { buildPortfolioFilters, filterPortfolio, PortfolioAsset } from '@/lib/portfolio'

/**
 * Barber-profile portfolio gallery.
 *
 * - Service filter chips derived from the barber's actual assets.
 * - Renders through the shared GalleryGrid so the tenant's configured
 *   gallery layout (grid / masonry / editorial / filmstrip) shapes this
 *   gallery too, with the same accessible lightbox, barber attribution,
 *   and booking links as the main /gallery page.
 */
export default function PortfolioGallery({
  assets,
  altFallback,
  layout = 'grid',
  barber,
}: {
  assets: PortfolioAsset[]
  /** Fallback alt text (e.g. the barber's name) when an asset lacks altText. */
  altFallback: string
  /** Tenant-configured gallery layout; defaults to the classic grid. */
  layout?: GalleryLayout
  /** The profile's barber — attached to every asset for lightbox booking links. */
  barber: { id: string; name: string; slug: string | null }
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

      <GalleryGrid
        layout={layout}
        contextLabel={`${altFallback} portfolio`}
        images={visible.map((asset) => ({
          id: asset.id,
          url: asset.url,
          altText: asset.altText,
          caption: asset.caption,
          barber: { id: barber.id, name: barber.name, slug: barber.slug },
          service: asset.service ?? null,
        }))}
      />

      {visible.length === 0 && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Images className="h-4 w-4" aria-hidden="true" />
          No work in this category yet.
        </p>
      )}
    </div>
  )
}

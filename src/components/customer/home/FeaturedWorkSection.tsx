'use client'

// ─── Featured work (gap 8: "Signature work or featured portfolio" module) ───
// Real published portfolio assets in an editorial grid. Category chips are
// derived from the business's own published content (linked service names
// plus before/after pair membership) — never fabricated. Tiles open the
// shared gallery lightbox (GalleryGrid) directly, with barber / service
// attribution and booking deep links. No images → the module renders
// nothing (the homepage renderer handles the empty case).

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Images } from 'lucide-react'
import { Section, SectionHeading } from '@/components/customer/Section'
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal'
import { Lightbox } from '@/components/customer/GalleryGrid'
import type { GalleryImage } from '@/components/customer/GalleryGrid'
import { focalPositionStyle } from '@/lib/image-roles'
import {
  buildFeaturedFilters,
  filterFeatured,
  type FeaturedPortfolioAsset,
} from '@/lib/portfolio'

type Props = {
  images: FeaturedPortfolioAsset[]
  heading?: string
  blurb?: string
  shopName: string
  buttonShape: string
}

export function FeaturedWorkSection({ images, heading, blurb, shopName }: Props) {
  const [activeFilter, setActiveFilter] = useState('all')
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  if (images.length === 0) return null

  const filters = buildFeaturedFilters(images)
  const visible = filterFeatured(images, activeFilter)
  const lightboxImages: GalleryImage[] = visible.map((image) => ({
    id: image.id,
    url: image.url,
    altText: image.altText,
    caption: image.caption,
    barber: image.barber ?? null,
    service: image.service ? { id: image.service.id, name: image.service.name } : null,
  }))

  return (
    <Section>
      <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end lg:mb-14">
        <SectionHeading
          align="left"
          eyebrow="Signature Work"
          title={heading || `Recent cuts from ${shopName}`}
          description={blurb || undefined}
          className="mb-0"
        />
        <Reveal delay={0.1}>
          <Link
            href="/gallery"
            className="group card-cta inline-flex items-center text-sm font-semibold text-accent hover:brightness-125"
          >
            View Full Gallery
            <ArrowRight className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </Reveal>
      </div>

      {/* Category chips — only categories with real published content.
          Horizontally scrollable on mobile, wrapped on larger screens. */}
      {filters.length > 1 && (
        <Reveal className="-mx-4 mb-8 px-4 sm:mx-0 sm:px-0">
          <div
            className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="group"
            aria-label="Filter featured work by category"
          >
            {filters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                aria-pressed={activeFilter === filter.id}
                onClick={() => setActiveFilter(filter.id)}
                className={
                  'shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-ring ' +
                  (activeFilter === filter.id
                    ? 'border-accent/60 bg-accent/15 text-accent'
                    : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground')
                }
              >
                {filter.label}
              </button>
            ))}
          </div>
        </Reveal>
      )}

      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((image, i) => (
          <StaggerItem key={image.id} className={i === 0 ? 'sm:col-span-2 sm:row-span-1' : undefined}>
            <button
              type="button"
              onClick={() => setOpenIndex(i)}
              className="group relative block w-full overflow-hidden rounded-lg border border-border/60 bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={
                image.caption ||
                image.altText ||
                `${image.barber?.name ? `${image.barber.name} — ` : ''}${shopName} portfolio photo`
              }
            >
              <img
                src={image.url}
                alt={image.altText || `${shopName} — featured work`}
                loading="lazy"
                className={`aspect-[4/5] w-full object-cover transition-transform duration-ui group-hover:scale-[1.03] ${i === 0 ? 'sm:aspect-[4/3]' : ''}`}
                style={focalPositionStyle(image.focalX, image.focalY)}
              />
              {/* Attribution: caption + barber / service / price when available */}
              {(image.caption || image.barber || image.service) && (
                <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-foreground/80 to-transparent p-3 pt-8">
                  {image.caption && (
                    <span className="line-clamp-2 text-sm font-medium text-background">{image.caption}</span>
                  )}
                  {(image.barber || image.service) && (
                    <span className="text-xs text-background/80">
                      {image.barber && `By ${image.barber.name}`}
                      {image.barber && image.service && ' · '}
                      {image.service && image.service.name}
                      {image.service?.price != null && ` · $${image.service.price.toFixed(0)}`}
                    </span>
                  )}
                </span>
              )}
            </button>
          </StaggerItem>
        ))}
      </Stagger>

      {visible.length === 0 && (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Images className="h-4 w-4" aria-hidden="true" /> No work in this category yet.
        </p>
      )}

      {openIndex !== null && (
        <Lightbox
          images={lightboxImages}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onNavigate={setOpenIndex}
        />
      )}
    </Section>
  )
}

import React from 'react'
import Link from 'next/link'
import { ArrowRight, Images } from 'lucide-react'
import { Section, SectionHeading } from '@/components/customer/Section'
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal'
import { focalPositionStyle } from '@/lib/image-roles'

// ─── Featured work (gap 8: "Signature work or featured portfolio" module) ───
// Real published portfolio assets in an editorial grid. Every tile deep
// links into the gallery (where the lightbox lives). No images → the
// module renders nothing (the homepage renderer handles the empty case).

export interface FeaturedImage {
  id: string
  url: string
  altText: string | null
  caption: string | null
  focalX?: number | null
  focalY?: number | null
}

type Props = {
  images: FeaturedImage[]
  heading?: string
  blurb?: string
  shopName: string
  buttonShape: string
}

export function FeaturedWorkSection({ images, heading, blurb, shopName }: Props) {
  if (images.length === 0) return null

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

      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {images.map((image, i) => (
          <StaggerItem key={image.id} className={i === 0 ? 'sm:col-span-2 sm:row-span-1' : undefined}>
            <Link
              href="/gallery"
              className="group relative block overflow-hidden rounded-lg border border-border/60 bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={image.caption || image.altText || `${shopName} portfolio photo`}
            >
              { }
              <img
                src={image.url}
                alt={image.altText || `${shopName} — featured work`}
                loading="lazy"
                className={`aspect-[4/5] w-full object-cover transition-transform duration-ui group-hover:scale-[1.03] ${i === 0 ? 'sm:aspect-[4/3]' : ''}`}
                style={focalPositionStyle(image.focalX, image.focalY)}
              />
              {image.caption && (
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-foreground/80 to-transparent p-3 pt-8 text-sm font-medium text-background">
                  {image.caption}
                </span>
              )}
            </Link>
          </StaggerItem>
        ))}
      </Stagger>

      {images.length === 0 && (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Images className="h-4 w-4" aria-hidden="true" /> Portfolio photos coming soon.
        </p>
      )}
    </Section>
  )
}

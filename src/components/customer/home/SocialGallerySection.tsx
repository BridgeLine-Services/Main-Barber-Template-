import React from 'react'
import Link from 'next/link'
import { Calendar, ExternalLink } from 'lucide-react'
import { Section, SectionHeading } from '@/components/customer/Section'
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal'
import type { SocialGallerySettings } from '@/lib/home-modules'
import { focalPositionStyle } from '@/lib/image-roles'

// ─── Social-style portfolio section (gap 7) ─────────────────────────────────
// A social-inspired grid of the shop's REAL locally managed portfolio
// assets — not live social-media posts and never scraped content. The
// handle/profile link is owner-configured (validated http(s) URL only);
// when no URL is set, only the handle displays. No follower counts.

export interface SocialImage {
  id: string
  url: string
  altText: string | null
  focalX?: number | null
  focalY?: number | null
}

type Props = {
  images: SocialImage[]
  settings: SocialGallerySettings
  shopName: string
  buttonShape: string
}

export function SocialGallerySection({ images, settings, shopName, buttonShape }: Props) {
  if (images.length === 0) return null

  const handle = settings.handle || shopName
  const heading = settings.heading || 'Fresh from the chair'
  const blurb =
    settings.blurb ||
    'A running look at recent cuts and styles from our shop — book yours below.'

  return (
    <Section>
      <SectionHeading eyebrow="Portfolio" title={heading} description={blurb} />

      {/* Handle + profile link — owner-configured, validated URL only */}
      <Reveal className="mb-8 flex flex-wrap items-center justify-center gap-3 text-center">
        <span className="text-lg font-semibold text-foreground">{handle}</span>
        {settings.followEnabled && settings.profileUrl && (
          <a
            href={settings.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 border border-border/70 bg-card px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-ring ${buttonShape}`}
          >
            View profile
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </Reveal>

      {/* Social-style grid: square tiles, edge-to-edge gap */}
      <Stagger className="mx-auto grid max-w-5xl grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2 lg:grid-cols-4">
        {images.map((image) => (
          <StaggerItem key={image.id}>
            <Link
              href="/gallery"
              className="group relative block overflow-hidden rounded-sm bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={image.altText || `${shopName} portfolio photo — open gallery`}
            >
              { }
              <img
                src={image.url}
                alt={image.altText || `${shopName} portfolio`}
                loading="lazy"
                className="aspect-square w-full object-cover transition-transform duration-ui group-hover:scale-[1.05] group-hover:brightness-110"
                style={focalPositionStyle(image.focalX, image.focalY)}
              />
            </Link>
          </StaggerItem>
        ))}
      </Stagger>

      <Reveal delay={0.15} className="mt-10 text-center">
        <Link
          href="/book"
          className={`inline-flex items-center gap-2 bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-ring ${buttonShape}`}
        >
          <Calendar className="h-4 w-4" aria-hidden="true" />
          Book your appointment
        </Link>
      </Reveal>
    </Section>
  )
}

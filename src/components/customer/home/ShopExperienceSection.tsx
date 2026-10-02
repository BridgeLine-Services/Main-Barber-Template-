import React from 'react'
import { Section, SectionHeading } from '@/components/customer/Section'
import { Stagger, StaggerItem } from '@/components/motion/reveal'

// ─── Shop experience module (gap 8: shop interior / atmosphere) ─────────────
// Real SHOP_PHOTO assets showing the space. Empty module → nothing renders.

export interface ShopPhoto {
  id: string
  url: string
  altText: string | null
}

type Props = {
  photos: ShopPhoto[]
  heading?: string
  blurb?: string
  shopName: string
}

export function ShopExperienceSection({ photos, heading, blurb, shopName }: Props) {
  if (photos.length === 0) return null

  return (
    <Section tone="muted" bleed>
      <SectionHeading
        eyebrow="The Shop"
        title={heading || `Inside ${shopName}`}
        description={blurb || 'The space where the craft happens — clean, comfortable, built for you.'}
      />
      <Stagger className="mx-auto grid max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2">
        {photos.map((photo, i) => (
          <StaggerItem key={photo.id} className={i === 0 ? 'sm:col-span-2' : undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={photo.altText || `${shopName} interior`}
              loading="lazy"
              className={`w-full rounded-lg border border-border/60 object-cover ${i === 0 ? 'aspect-[16/9]' : 'aspect-[4/3]'}`}
            />
          </StaggerItem>
        ))}
      </Stagger>
    </Section>
  )
}

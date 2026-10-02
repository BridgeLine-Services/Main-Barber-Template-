import React from 'react'
import { Section, SectionHeading } from '@/components/customer/Section'
import { BeforeAfterSlider, type BeforeAfterData } from '@/components/customer/BeforeAfterSlider'

// ─── Before/After homepage module (gap 2 + 8) ───────────────────────────────
// Renders owner-curated real transformation pairs with the shared
// customer-facing comparison slider. Empty module → nothing renders.

type Props = {
  pairs: BeforeAfterData[]
  heading?: string
  blurb?: string
  shopName: string
  buttonShape: string
}

export function BeforeAfterSection({ pairs, heading, blurb, shopName, buttonShape }: Props) {
  if (pairs.length === 0) return null

  return (
    <Section tone="muted" bleed>
      <SectionHeading
        eyebrow="Transformations"
        title={heading || 'Real transformations, real results'}
        description={blurb || 'Drag the handle to see the difference our barbers make.'}
      />
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {pairs.map((pair) => {
          const params = new URLSearchParams()
          if (pair.serviceId) params.set('serviceId', pair.serviceId)
          if (pair.barberId) params.set('barberId', pair.barberId)
          const qs = params.toString()
          return (
            <BeforeAfterSlider
              key={pair.id}
              pair={pair}
              contextLabel={shopName}
              bookHref={qs ? `/book?${qs}` : '/book'}
              className={buttonShape}
            />
          )
        })}
      </div>
    </Section>
  )
}

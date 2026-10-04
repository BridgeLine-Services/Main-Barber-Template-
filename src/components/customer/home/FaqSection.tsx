// ─── FAQ homepage module (server) ────────────────────────────────────────────
// Renders only REAL Faq records from the tenant's FAQ manager — never the
// generic fallback copy used by the standalone /faq page. The parent renders
// null before this when no FAQs exist, so incomplete setups stay clean.
// Native <details>/<summary> accordions: keyboard-accessible with zero JS.

import { Reveal } from '@/components/motion/reveal'
import { ChevronDown } from 'lucide-react'

export interface FaqItem {
  id: string
  category: string
  question: string
  answer: string
}

export function FaqSection({
  faqs,
  heading,
  blurb,
}: {
  faqs: FaqItem[]
  heading?: string
  blurb?: string
}) {
  // Group by category preserving first-seen order (sortOrder from the query).
  const categories: { category: string; items: FaqItem[] }[] = []
  for (const faq of faqs) {
    const last = categories[categories.length - 1]
    if (last && last.category === faq.category) last.items.push(faq)
    else categories.push({ category: faq.category, items: [faq] })
  }

  return (
    <section className="w-full">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-24">
        <Reveal className="text-center">
          <span className="eyebrow mb-3">Good to know</span>
          <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {heading || 'Frequently Asked Questions'}
          </h2>
          {blurb ? (
            <p className="mx-auto mt-4 max-w-xl text-balance text-base leading-relaxed text-muted-foreground">
              {blurb}
            </p>
          ) : null}
        </Reveal>

        <div className="mt-10">
          {categories.map(({ category, items }) => (
            <div key={category} className="mb-8 last:mb-0">
              <p className="eyebrow-accent mb-2">{category}</p>
              <div className="border-t border-border/60">
                {items.map((faq) => (
                  <details
                    key={faq.id}
                    name="homepage-faq"
                    className="group border-b border-border/60 open:bg-card/40 [&_summary::-webkit-details-marker]:hidden"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left font-medium text-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="text-balance text-base sm:text-lg">{faq.question}</span>
                      <ChevronDown
                        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                        aria-hidden="true"
                      />
                    </summary>
                    <p className="pb-5 pr-8 text-sm leading-relaxed text-muted-foreground">
                      {faq.answer}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

import React from 'react'
import { Reveal } from '@/components/motion/reveal'

// ─── Section primitives (server-safe) ──────────────────────────────────────
// Consistent premium rhythm for the customer site: generous vertical
// spacing, a tone option for alternating backgrounds, and a heading block
// (eyebrow + display title + description) that reveals on scroll.

interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  /** 'muted' paints a slightly raised surface behind the section */
  tone?: 'default' | 'muted'
  /** Bleed the tone/background to full viewport width */
  bleed?: boolean
  children: React.ReactNode
}

export function Section({ tone = 'default', bleed = false, className, children, ...rest }: SectionProps) {
  return (
    <section
      className={
        (bleed
          ? tone === 'muted'
            ? 'w-full border-y border-border/60 bg-card/40 '
            : ''
          : tone === 'muted'
            ? 'w-full border-y border-border/60 bg-card/40 '
            : '') + (className ?? '')
      }
      {...rest}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 lg:py-24">{children}</div>
    </section>
  )
}

interface SectionHeadingProps {
  /** Small uppercase label above the title */
  eyebrow?: string
  title: React.ReactNode
  description?: React.ReactNode
  /** Center = editorial hero-of-section; left = supporting sections */
  align?: 'center' | 'left'
  as?: 'h2' | 'h3'
  className?: string
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'center',
  as: Tag = 'h2',
  className,
}: SectionHeadingProps) {
  const centered = align === 'center'
  return (
    <div className={`${centered ? 'mx-auto text-center' : ''} max-w-2xl mb-10 lg:mb-14 ${className ?? ''}`}>
      {eyebrow && (
        <Reveal>
          <span className="eyebrow mb-3">{eyebrow}</span>
        </Reveal>
      )}
      <Reveal delay={0.05}>
        <Tag className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-foreground leading-[1.15]">
          {title}
        </Tag>
      </Reveal>
      {description && (
        <Reveal delay={0.12}>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            {description}
          </p>
        </Reveal>
      )}
      {centered && (
        <Reveal delay={0.16}>
          <div className="ornament mt-6" aria-hidden="true" />
        </Reveal>
      )}
    </div>
  )
}

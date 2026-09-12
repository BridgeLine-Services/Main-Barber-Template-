import React from 'react'
import Link from 'next/link'
import { Calendar } from 'lucide-react'

// ─── Premium CTAs (server-safe) ─────────────────────────────────────────────
// One consistent call-to-action language across the showroom. Colors come
// from the business theme tokens — gold for the default brand, but any
// shop's accent renders correctly.

interface BookButtonProps {
  href?: string
  label?: string
  size?: 'md' | 'lg'
  className?: string
}

/** Primary conversion CTA — used in hero, mid-page, and final CTA sections. */
export function BookButton({
  href = '/book',
  label = 'Book Your Appointment',
  size = 'lg',
  className,
}: BookButtonProps) {
  return (
    <Link
      href={href}
      className={
        'group inline-flex items-center justify-center gap-2.5 rounded-md font-semibold tracking-wide transition-all duration-300 ' +
        'bg-accent text-accent-foreground hover:brightness-110 hover:-translate-y-0.5 ' +
        'shadow-lg shadow-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
        (size === 'lg' ? 'px-8 py-4 text-base' : 'px-6 py-3 text-sm') +
        (className ? ' ' + className : '')
      }
    >
      <Calendar className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" aria-hidden="true" />
      {label}
    </Link>
  )
}

interface GhostButtonProps {
  href: string
  children: React.ReactNode
  className?: string
}

/** Secondary/outline action — quieter than the primary, still on-brand. */
export function GhostButton({ href, children, className }: GhostButtonProps) {
  return (
    <Link
      href={href}
      className={
        'inline-flex items-center justify-center gap-2 rounded-md px-6 py-4 text-sm font-semibold tracking-wide ' +
        'border border-border bg-card/60 text-foreground backdrop-blur-sm ' +
        'hover:border-accent/50 hover:text-accent transition-all duration-300 hover:-translate-y-0.5 ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
        (className ?? '')
      }
    >
      {children}
    </Link>
  )
}

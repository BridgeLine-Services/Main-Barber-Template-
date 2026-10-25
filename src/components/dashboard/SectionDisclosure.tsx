'use client'

import { ChevronDown } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// SectionDisclosure — a small, accessible progressive-disclosure wrapper for
// the settings pages. Uses the native <details>/<summary> pair so keyboard
// support, the expanded state, and screen-reader semantics come from the
// platform instead of a custom widget. Closed by default: only advanced or
// secondary options live behind it, never primary controls.
// ─────────────────────────────────────────────────────────────────────────────

interface SectionDisclosureProps {
  title: string
  /** One short sentence explaining what is inside. */
  description?: string
  /** Start expanded (use only for content a user usually needs right away). */
  defaultOpen?: boolean
  children: React.ReactNode
}

export function SectionDisclosure({ title, description, defaultOpen = false, children }: SectionDisclosureProps) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-border px-4 py-4">{children}</div>
    </details>
  )
}

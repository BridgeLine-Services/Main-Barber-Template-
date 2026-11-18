'use client'

import { useMemo, useState } from 'react'
import { describeStyle, layoutDifferences, styleGuideList } from '@/lib/visual-style-guide'
import type { VisualStyle } from '@/lib/visual-style'

/**
 * Compare two looks side by side.
 *
 * The differences come from layoutDifferences(), which reads the real preset
 * config, so this can only ever name a section that genuinely differs between the
 * two chosen looks. It is purely informative: nothing here selects or saves.
 */
export function StyleCompare({ currentStyle }: { currentStyle?: string }) {
  const catalogue = useMemo(() => styleGuideList(), [])
  const inUse = describeStyle(currentStyle).style
  const [left, setLeft] = useState<VisualStyle>(inUse)
  const [right, setRight] = useState<VisualStyle>(
    () => catalogue.find((entry) => entry.style !== inUse)?.style ?? 'modern-classic',
  )

  const a = describeStyle(left)
  const b = describeStyle(right)
  const differences = layoutDifferences(left, right)
  const same = differences.length === 0

  return (
    <section aria-labelledby="compare" className="rounded-xl border border-border bg-[var(--dash-surface)]/60 p-5">
      <h2 id="compare" className="text-lg font-semibold text-foreground">Compare two looks</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick any two and see what actually changes. Only the sections listed below are different.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-foreground">
          First look
          <select
            value={left}
            onChange={(event) => setLeft(event.target.value as VisualStyle)}
            className="mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm"
          >
            {catalogue.map((entry) => (
              <option key={entry.style} value={entry.style}>
                {entry.label}
                {entry.style === inUse ? ' (in use now)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-foreground">
          Second look
          <select
            value={right}
            onChange={(event) => setRight(event.target.value as VisualStyle)}
            className="mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm"
          >
            {catalogue.map((entry) => (
              <option key={entry.style} value={entry.style}>
                {entry.label}
                {entry.style === inUse ? ' (in use now)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {[a, b].map((entry) => (
          <div key={entry.style} className="rounded-lg border border-border p-4">
            <p className="font-medium text-foreground">{entry.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">{entry.personality}</p>
            <p className="mt-1 text-xs text-muted-foreground">Best for: {entry.bestFor}</p>
            <p className="mt-1 text-xs text-muted-foreground">Layout: {entry.layoutSummary}.</p>
            <p className="mt-1 text-xs text-muted-foreground">Pace: {entry.pace}.</p>
          </div>
        ))}
      </div>

      <div className="mt-4" role="status" aria-live="polite">
        <p className="text-sm font-medium text-foreground">
          {same ? 'These are the same look, so nothing differs.' : `Different in ${differences.length} place${differences.length === 1 ? '' : 's'}:`}
        </p>
        {!same && (
          <ul className="mt-1 list-inside list-disc">
            {differences.map((difference) => (
              <li key={difference} className="text-sm text-muted-foreground">{difference}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

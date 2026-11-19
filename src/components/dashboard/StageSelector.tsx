'use client'

/**
 * "Where are you heading?" — the owner's declared direction (Part 4.2).
 *
 * One button per direction, the current choice marked with aria-pressed so a screen
 * reader hears it. Saving is a single request to /api/dashboard/growth-stage; the button
 * set is disabled while it is in flight, so a double click cannot send two writes. A
 * failure is shown as a sentence, never as a silent revert.
 *
 * This component records an intention. It cannot grant a permission or switch a feature
 * on: the endpoint it calls only writes one text column.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { INTENT_OPTIONS } from '@/lib/growth/stages'

interface StageSelectorProps {
  /** The stage the owner has already declared, or null. */
  intended: string | null
  /** The stage their records suggest, so the current one can be marked. */
  current: string | null
}

export function StageSelector({ intended, current }: StageSelectorProps) {
  const router = useRouter()
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function choose(stage: string) {
    if (saving) return
    setSaving(stage)
    setError(null)
    setSaved(null)
    try {
      const res = await fetch('/api/dashboard/growth-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Your plan could not be saved just now. Nothing else was changed.')
        return
      }
      setSaved(stage)
      router.refresh()
    } catch {
      setError('Your plan could not be saved because the connection dropped. Please try again.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {INTENT_OPTIONS.map((option) => {
          const isChosen = intended === option.stage
          const isEvidence = !intended && current === option.stage
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => choose(option.stage)}
              disabled={saving !== null}
              aria-pressed={isChosen}
              className={[
                'rounded-lg border p-3 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dash-brand)]',
                isChosen
                  ? 'border-[var(--dash-brand)] bg-[var(--dash-brand)]/10'
                  : 'border-input bg-[var(--dash-surface)]/50 hover:border-[var(--dash-brand)]/60',
                saving !== null ? 'opacity-60' : '',
              ].join(' ')}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{option.label}</span>
                {isChosen && <span className="text-xs font-medium text-[var(--dash-brand)]">Your plan</span>}
                {isEvidence && <span className="text-xs text-muted-foreground">Where you are now</span>}
                {saving === option.stage && <span className="text-xs text-muted-foreground">Saving…</span>}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{option.detail}</span>
            </button>
          )
        })}
      </div>

      <p className="mt-2 min-h-5 text-xs" role="status" aria-live="polite">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : saved ? (
          <span className="text-emerald-500">Saved. This only changes what we suggest; nothing else on your site changed.</span>
        ) : (
          <span className="text-muted-foreground">Choosing a direction never changes your settings, prices or permissions.</span>
        )}
      </p>
    </div>
  )
}

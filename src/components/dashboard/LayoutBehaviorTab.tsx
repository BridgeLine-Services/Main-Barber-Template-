'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LayoutGrid, Info, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { VISUAL_STYLES, VISUAL_STYLE_CONFIG, type VisualStyle } from '@/lib/visual-style'
import {
  VISUAL_FIELD_OPTIONS,
  resolveVisualConfig,
  type VisualOverrideKey,
} from '@/lib/visual-config'
import {
  FIELD_LABELS,
  optionLabel,
  HeroPreview,
} from '@/components/dashboard/AppearanceTab'

// ─────────────────────────────────────────────────────────────────────────────
// Layout & Behavior tab — the visual system's independent layout overrides.
//
// Every option defaults to the selected preset's built-in choice; the owner
// overrides only what they want to differ. '' (Preset default) removes the
// override so the preset drives the value again. Saves as a DRAFT through the
// normal settings flow — never auto-publishes.
// ─────────────────────────────────────────────────────────────────────────────

type WebsiteContentMap = Record<string, unknown>

interface LayoutBehaviorTabProps {
  websiteContent: WebsiteContentMap
  setWebsiteContent: (next: WebsiteContentMap) => void
}

export function LayoutBehaviorTab({ websiteContent, setWebsiteContent }: LayoutBehaviorTabProps) {
  const preset = (typeof websiteContent.visualPreset === 'string' ? websiteContent.visualPreset : '') as VisualStyle | ''
  const overrides = (websiteContent.visualConfig && typeof websiteContent.visualConfig === 'object'
    ? websiteContent.visualConfig
    : {}) as Record<string, string>
  const selectedPreset: VisualStyle = preset && (VISUAL_STYLES as readonly string[]).includes(preset) ? preset : 'modern-classic'
  const resolved = resolveVisualConfig(selectedPreset, overrides)

  const setOverride = (key: VisualOverrideKey, value: string) => {
    const next = { ...overrides }
    if (!value) delete next[key] // '' = follow preset default
    else next[key] = value
    setWebsiteContent({ ...websiteContent, visualConfig: next })
  }

  /**
   * Reset to preset defaults: clears every optional visual override (layouts,
   * motion, buttons, typography) so the selected preset's built-in choices
   * apply again. The preset itself, branding, photos, services, barbers and
   * reviews are untouched. Follows the normal save flow — draft only,
   * never auto-publishes.
   */
  const hasOverrides = Object.keys(overrides).length > 0
  const resetToPresetDefaults = () => {
    const presetLabel = VISUAL_STYLE_CONFIG[selectedPreset].label
    const ok = window.confirm(
      `Reset to ${presetLabel} defaults?\n\n` +
      'All layout and typography overrides will be cleared and this preset\'s built-in design choices will apply again. ' +
      'Your preset, branding, logo, photos, services, barbers and reviews are all kept.\n\n' +
      'This saves as a draft — nothing goes live until you publish.'
    )
    if (!ok) return
    setWebsiteContent({ ...websiteContent, visualConfig: {} })
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <LayoutGrid className="h-5 w-5 text-[var(--dash-brand)]" />
          Layout &amp; Behavior
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        <p className="text-sm text-muted-foreground">
          Fine-tune how the <span className="font-semibold text-foreground">{VISUAL_STYLE_CONFIG[selectedPreset].label}</span> preset
          composes your public website. Every option defaults to the preset&apos;s built-in choice — override only what you
          want to differ. Changes save as a <span className="font-semibold text-foreground">draft</span> and go live when you publish.
        </p>

        {/* ── Independent layout overrides ──────────────────────────── */}
        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Layout options</h3>
            <button
              type="button"
              onClick={resetToPresetDefaults}
              disabled={!hasOverrides}
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-[var(--dash-surface)] px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Reset to {VISUAL_STYLE_CONFIG[selectedPreset].label} defaults
            </button>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            Every option defaults to the preset&apos;s built-in choice. Override only what you want to differ.
            Resetting clears all overrides (saved as a draft) and keeps everything else about your site.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(VISUAL_FIELD_OPTIONS) as VisualOverrideKey[]).map((key) => {
              const options = VISUAL_FIELD_OPTIONS[key]
              const presetDefault = (resolved[key] as string)
              const currentValue = overrides[key] ?? ''
              return (
                <label key={key} className="block">
                  <span className="mb-1 block text-xs font-medium text-foreground/85">{FIELD_LABELS[key]}</span>
                  <select
                    value={currentValue}
                    onChange={(e) => setOverride(key, e.target.value)}
                    className="w-full rounded-md border border-input bg-[var(--dash-surface)] px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
                  >
                    <option value="">Preset default — {optionLabel(presetDefault)}</option>
                    {options.map((opt) => (
                      <option key={opt} value={opt}>{optionLabel(opt)}</option>
                    ))}
                  </select>
                </label>
              )
            })}
          </div>
        </div>

        {/* ── Instant draft hero (updates with unsaved choices) ──────── */}
        <div>
          <h3 className="mb-1 text-sm font-semibold text-foreground">Hero check</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Updates instantly with your unsaved hero layout choice. The full responsive preview is on the
            Website Appearance tab and the Site Preview page.
          </p>
          <div className="max-w-2xl">
            <HeroPreview heroLayout={resolved.heroLayout} preset={selectedPreset} />
          </div>
        </div>

        <div className={cn('flex items-start gap-2 rounded-lg border border-border bg-[var(--dash-surface)]/50 p-3')}>
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Walk-in navigation focus appears on the public site only when your shop supports walk-ins
            (Business Info → walk-ins welcome). Motion respects each visitor&apos;s reduced-motion preference
            regardless of the level chosen here.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

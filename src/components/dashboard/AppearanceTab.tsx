'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Check, Monitor, Info, Smartphone, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  VISUAL_STYLES,
  VISUAL_STYLE_CONFIG,
  type VisualStyle,
} from '@/lib/visual-style'
import {
  type VisualOverrideKey,
  type VisualConfig,
  resolveVisualConfig,
} from '@/lib/visual-config'

// ─────────────────────────────────────────────────────────────────────────────
// Website Appearance tab — owner-facing visual identity configuration.
//
// The owner picks a preset (8 independently recognizable designs). Layout,
// typography and homepage sections live in their own dedicated tabs
// (Layout & Behavior / Typography / Homepage Sections); the dashboard preview
// has its own tab too.
//
// Saves as DRAFT through the existing settings save flow; the Publish
// Website card below makes it live (existing draft→publish architecture).
//
// Preview architecture:
//   • HeroPreview — instant strip reflecting the CURRENT UNSAVED draft.
//   • SitePreview — the REAL customer homepage rendered in an iframe from
//     the authenticated /dashboard/website-preview route, with a Desktop /
//     Mobile viewport toggle (transient client state, never persisted as a
//     branding setting). It shows the SAVED draft, so it refreshes after
//     each successful save (savedAt prop).
// ─────────────────────────────────────────────────────────────────────────────

type WebsiteContentMap = Record<string, unknown>

export const PRESET_META: Record<VisualStyle, { blurb: string; swatches: string[]; type: string }> = {
  'black-label': {
    blurb: 'Luxury, cinematic, dark materials, refined editorial typography.',
    swatches: ['#0a0a0a', '#d4af37', '#1c1c1c', '#f5f5f0'],
    type: 'Serif display',
  },
  'barber-heritage': {
    blurb: 'Traditional barbershop character, vintage typography, warm materials.',
    swatches: ['#2b1d12', '#c19a6b', '#f2e8d5', '#7a4f2b'],
    type: 'Vintage serif',
  },
  'street-cut': {
    blurb: 'Urban, bold, energetic, oversized typography, strong contrast.',
    swatches: ['#111111', '#ff3b00', '#ffffff', '#00e5a0'],
    type: 'Heavy grotesque',
  },
  'clean-club': {
    blurb: 'Minimal, bright grooming-studio design, restrained typography.',
    swatches: ['#fafafa', '#1a1a1a', '#e5e5e5', '#5c8a6a'],
    type: 'Light sans',
  },
  'modern-classic': {
    blurb: 'Contemporary barbershop, classic elements with modern typography.',
    swatches: ['#1e2126', '#d4af37', '#f4f4f2', '#9aa3ad'],
    type: 'Modern serif/sans',
  },
  'warm-premium': {
    blurb: 'Coffee-house warmth at luxury grade: honeyed surfaces, soft frames.',
    swatches: ['#2b2218', '#c98f4e', '#f5efe4', '#ab9c85'],
    type: 'Serif display',
  },
  'high-energy-urban': {
    blurb: 'Voltage accent, poster walls, hard frames, condensed type.',
    swatches: ['#101214', '#c8f318', '#f0f2f4', '#3a3f45'],
    type: 'Condensed heavy',
  },
  'single-chair': {
    blurb: 'One-person studio: journal-like, airy, personal. You are the brand.',
    swatches: ['#f8f5ef', '#8a6d3f', '#fffdf8', '#2a251c'],
    type: 'Editorial serif',
  },
}

export const FIELD_LABELS: Record<VisualOverrideKey, string> = {
  heroLayout: 'Hero layout',
  serviceLayout: 'Service listing layout',
  barberLayout: 'Barber presentation',
  galleryLayout: 'Gallery layout',
  motionLevel: 'Motion level',
  mobileNavMode: 'Mobile navigation focus',
  reviewPresentation: 'Review presentation',
  buttonStyle: 'Button style',
  imageShape: 'Image shape',
  headingScale: 'Heading scale',
}

export const OPTION_LABELS: Record<string, string> = {
  cinematic: 'Cinematic — immersive full-bleed image',
  split: 'Split — text beside imagery',
  poster: 'Poster — bold typography-led',
  editorial: 'Editorial rows',
  cards: 'Cards',
  'visual-menu': 'Visual menu (image-led)',
  'portrait-grid': 'Portrait grid',
  'large-profile': 'Large profiles',
  grid: 'Grid',
  masonry: 'Masonry',
  filmstrip: 'Filmstrip (horizontal)',
  off: 'Off — no decorative animation',
  subtle: 'Subtle — restrained transitions',
  expressive: 'Expressive — noticeable, purposeful',
  appointment: 'Appointment-focused (Book)',
  walkin: 'Walk-in-focused',
  barber: 'Barber-focused',
  strip: 'Compact strip / carousel',
  sharp: 'Sharp — square corners',
  soft: 'Soft — slightly rounded',
  pill: 'Pill — fully rounded',
  square: 'Square — sharp corners',
  rounded: 'Rounded — soft corners',
  'full-bleed': 'Full-bleed — edge to edge',
  compact: 'Compact — smaller headings',
  grand: 'Grand — larger headings',
}

export function optionLabel(value: string): string {
  return OPTION_LABELS[value] ?? value
}

/** Tiny hero mock that reflects the selected hero layout + preset character. */
export function HeroPreview({ heroLayout, preset }: { heroLayout: string; preset: VisualStyle }) {
  const meta = PRESET_META[preset]
  const [bg, accent, surface, light] = meta.swatches
  const base = 'relative flex h-28 w-full overflow-hidden rounded-md border border-input'
  const text = 'font-bold tracking-tight'
  if (heroLayout === 'split') {
    return (
      <div className={cn(base)} aria-hidden="true">
        <div className="flex w-1/2 flex-col justify-center gap-1.5 p-3" style={{ background: surface }}>
          <span className="text-[8px] uppercase tracking-widest opacity-70" style={{ color: bg }}>Eyebrow</span>
          <span className={cn(text, 'text-sm leading-none')} style={{ color: bg }}>Sharp looks,</span>
          <span className={cn(text, 'text-sm leading-none')} style={{ color: bg }}>honest craft.</span>
          <span className="mt-1 w-fit rounded-sm px-2 py-0.5 text-[8px] font-semibold text-white" style={{ background: bg }}>Book Now</span>
        </div>
        <div className="w-1/2" style={{ background: `linear-gradient(135deg, ${bg}, ${accent})` }} />
      </div>
    )
  }
  if (heroLayout === 'poster') {
    return (
      <div className={cn(base, 'flex-col justify-end p-3')} style={{ background: `linear-gradient(160deg, ${bg} 65%, ${accent}22)` }} aria-hidden="true">
        <span className="absolute right-2 top-2 h-8 w-8 rounded-full opacity-80" style={{ background: accent }} />
        <span className={cn(text, 'text-2xl leading-none')} style={{ color: light }}>BIG TYPE.</span>
        <span className={cn(text, 'text-xl leading-none')} style={{ color: accent }}>HOT WALK-INS.</span>
        <span className="mt-1.5 w-fit rounded-sm px-2 py-0.5 text-[8px] font-semibold text-white" style={{ background: accent }}>Book a Chair</span>
      </div>
    )
  }
  // cinematic
  return (
    <div className={cn(base, 'items-center justify-center')} style={{ background: `linear-gradient(180deg, ${bg}cc, ${bg}), url()` }} aria-hidden="true">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <span className="text-[8px] uppercase tracking-[0.3em]" style={{ color: accent }}>EST. 2012</span>
        <span className={cn(text, 'text-lg leading-none')} style={{ color: light }}>The Gentleman's Cut</span>
        <span className="w-fit rounded-sm px-2 py-0.5 text-[8px] font-semibold text-white" style={{ background: accent }}>Book Appointment</span>
      </div>
    </div>
  )
}

interface AppearanceTabProps {
  websiteContent: WebsiteContentMap
  setWebsiteContent: (next: WebsiteContentMap) => void
  /** Bumped by the settings page after each successful save — reloads the real-site preview iframe. */
  savedAt?: number
}

export function AppearanceTab({ websiteContent, setWebsiteContent, savedAt }: AppearanceTabProps) {
  // Viewport selection is TRANSIENT client state — it never persists as a
  // branding setting and never affects what publish renders.
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
  const [frameHeight, setFrameHeight] = useState(640)

  const preset = (typeof websiteContent.visualPreset === 'string' ? websiteContent.visualPreset : '') as VisualStyle | ''
  const overrides = (websiteContent.visualConfig && typeof websiteContent.visualConfig === 'object'
    ? websiteContent.visualConfig
    : {}) as Record<string, string>
  const selectedPreset: VisualStyle = preset && (VISUAL_STYLES as readonly string[]).includes(preset) ? preset : 'modern-classic'
  // What the PUBLIC site currently renders for this draft (preset defaults +
  // overrides) — the preview reflects the real resolver behavior.
  const resolved: VisualConfig = resolveVisualConfig(selectedPreset, overrides)

  const setPreset = (p: VisualStyle) => {
    setWebsiteContent({ ...websiteContent, visualPreset: p })
  }

  const isMobile = viewport === 'mobile'

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Monitor className="h-5 w-5 text-[var(--dash-brand)]" />
          Website Appearance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        <p className="text-sm text-muted-foreground">
          Choose the visual identity customers see on your public website. Changes save as a{' '}
          <span className="font-semibold text-foreground">draft</span> and go live when you{' '}
          <span className="font-semibold text-foreground">publish</span> (Publish Website card below).
        </p>

        {/* ── Preset picker ─────────────────────────────────────────── */}
        <div>
          <h3 className="mb-1 text-sm font-semibold text-foreground">Visual preset</h3>
          <p className="mb-4 text-xs text-muted-foreground">
            Each preset is a complete design identity — typography, spacing, surfaces, image treatment, and motion.
          </p>
          <div role="radiogroup" aria-label="Visual preset" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {VISUAL_STYLES.map((style) => {
              const meta = PRESET_META[style]
              const isSelected = selectedPreset === style
              return (
                <button
                  key={style}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setPreset(style)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected ? 'border-[var(--dash-brand-border)] bg-[var(--dash-brand-soft)]' : 'border-input hover:border-border'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">{VISUAL_STYLE_CONFIG[style].label}</span>
                    {isSelected && <Check className="h-4 w-4 text-[var(--dash-brand)]" aria-label="Selected" />}
                  </div>
                  <div className="mt-2 flex gap-1" aria-hidden="true">
                    {meta.swatches.map((c) => (
                      <span key={c} className="h-5 w-5 rounded-full border border-input" style={{ background: c }} />
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{meta.blurb}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{meta.type}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Instant draft strip (unsaved state, updates immediately) ── */}
        <div>
          <h3 className="mb-1 text-sm font-semibold text-foreground">Draft check</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Updates instantly with your unsaved choices — the hero composition this draft resolves to right now.
          </p>
          <HeroPreview heroLayout={resolved.heroLayout} preset={selectedPreset} />
        </div>

        {/* ── Real site preview with Desktop / Mobile viewport ──────── */}
        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Site preview</h3>
            {/* Viewport toggle — presentation only, never saved/published */}
            <div role="group" aria-label="Preview viewport" className="inline-flex rounded-lg border border-input bg-[var(--dash-surface)] p-0.5">
              <button
                type="button"
                onClick={() => setViewport('desktop')}
                aria-pressed={!isMobile}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  !isMobile ? 'bg-[var(--dash-brand-soft)] text-foreground border border-[var(--dash-brand-border)]' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
                Desktop
              </button>
              <button
                type="button"
                onClick={() => setViewport('mobile')}
                aria-pressed={isMobile}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isMobile ? 'bg-[var(--dash-brand-soft)] text-foreground border border-[var(--dash-brand-border)]' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
                Mobile
              </button>
            </div>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            The real customer homepage rendered from your <span className="font-semibold text-foreground">saved draft</span> —
            press <span className="font-semibold text-foreground">Save Changes</span> above, then the preview refreshes.
            The viewport switch changes the preview only, never your settings.
          </p>
          <div
            className={cn(
              'mx-auto overflow-hidden rounded-xl border border-border bg-[var(--dash-surface-2)] shadow-sm transition-all',
              isMobile ? 'w-[390px] max-w-full' : 'w-full'
            )}
          >
            {/* iframe: same-origin authenticated draft preview, session cookies apply */}
            <iframe
              key={savedAt || 1}
              src="/dashboard/website-preview?embedded=1"
              title="Website draft preview"
              className="block w-full border-0"
              style={{ height: frameHeight }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <a
              href="/dashboard/website-preview"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--dash-brand)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              Open full-size Site Preview
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Height
              <input
                type="range"
                min={400}
                max={1000}
                step={40}
                value={frameHeight}
                onChange={(e) => setFrameHeight(Number(e.target.value))}
                aria-label="Preview height"
                className="accent-[var(--dash-brand)]"
              />
            </label>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-border bg-[var(--dash-surface)]/50 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Fine-tune layouts in <span className="font-semibold text-foreground">Layout &amp; Behavior</span>, fonts in{' '}
            <span className="font-semibold text-foreground">Typography</span>, and homepage section visibility in{' '}
            <span className="font-semibold text-foreground">Homepage Sections</span>. Your dashboard&apos;s own look has its own
            <span className="font-semibold text-foreground"> Dashboard Preview</span> tab.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

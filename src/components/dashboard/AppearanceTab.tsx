'use client'

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Check, Monitor, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  VISUAL_STYLES,
  VISUAL_STYLE_CONFIG,
  type VisualStyle,
} from '@/lib/visual-style'
import {
  VISUAL_FIELD_OPTIONS,
  HERO_LAYOUTS,
  type VisualOverrideKey,
  resolveVisualConfig,
} from '@/lib/visual-config'

// ─────────────────────────────────────────────────────────────────────────────
// Website Appearance tab — owner-facing visual identity configuration.
//
// The owner picks a preset (5 independently recognizable designs) and may
// override individual layouts (hero, services, barbers, gallery, motion,
// mobile nav, reviews). Unset fields follow the preset's built-in mapping.
//
// Saves as DRAFT through the existing settings save flow; the Publish
// Website card below makes it live (existing draft→publish architecture).
// ─────────────────────────────────────────────────────────────────────────────

type WebsiteContentMap = Record<string, string | boolean | Record<string, string>>

const PRESET_META: Record<VisualStyle, { blurb: string; swatches: string[]; type: string }> = {
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
}

const FIELD_LABELS: Record<VisualOverrideKey, string> = {
  heroLayout: 'Hero layout',
  serviceLayout: 'Service listing layout',
  barberLayout: 'Barber presentation',
  galleryLayout: 'Gallery layout',
  motionLevel: 'Motion level',
  mobileNavMode: 'Mobile navigation focus',
  reviewPresentation: 'Review presentation',
}

const OPTION_LABELS: Record<string, string> = {
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
}

function optionLabel(value: string): string {
  return OPTION_LABELS[value] ?? value
}

/** Tiny hero mock that reflects the selected hero layout + preset character. */
function HeroPreview({ heroLayout, preset }: { heroLayout: string; preset: VisualStyle }) {
  const meta = PRESET_META[preset]
  const [bg, accent, surface, light] = meta.swatches
  const base = 'relative flex h-28 w-full overflow-hidden rounded-md border border-zinc-700'
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
}

export function AppearanceTab({ websiteContent, setWebsiteContent }: AppearanceTabProps) {
  const preset = (typeof websiteContent.visualPreset === 'string' ? websiteContent.visualPreset : '') as VisualStyle | ''
  const overrides = (websiteContent.visualConfig && typeof websiteContent.visualConfig === 'object'
    ? websiteContent.visualConfig
    : {}) as Record<string, string>
  const selectedPreset: VisualStyle = preset && (VISUAL_STYLES as readonly string[]).includes(preset) ? preset : 'modern-classic'
  // What the PUBLIC site currently renders for this draft (preset defaults +
  // overrides) — the preview reflects the real resolver behavior.
  const resolved = resolveVisualConfig(selectedPreset, overrides)

  const setPreset = (p: VisualStyle) => {
    setWebsiteContent({ ...websiteContent, visualPreset: p })
  }
  const setOverride = (key: VisualOverrideKey, value: string) => {
    const next = { ...overrides }
    if (!value) delete next[key] // '' = follow preset default
    else next[key] = value
    setWebsiteContent({ ...websiteContent, visualConfig: next })
  }

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Monitor className="h-5 w-5 text-amber-500" />
          Website Appearance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        <p className="text-sm text-zinc-400">
          Choose the visual identity customers see on your public website. Changes save as a{' '}
          <span className="font-semibold text-zinc-200">draft</span> and go live when you{' '}
          <span className="font-semibold text-zinc-200">publish</span> (Publish Website card below).
        </p>

        {/* ── Preset picker ─────────────────────────────────────────── */}
        <div>
          <h3 className="mb-1 text-sm font-semibold text-zinc-200">Visual preset</h3>
          <p className="mb-4 text-xs text-zinc-500">
            Each preset is a complete design identity — typography, spacing, surfaces, image treatment, and motion.
          </p>
          <div role="radiogroup" aria-label="Visual preset" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
                    'rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500',
                    isSelected ? 'border-amber-500 bg-amber-500/10' : 'border-zinc-700 hover:border-zinc-500'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-zinc-100">{VISUAL_STYLE_CONFIG[style].label}</span>
                    {isSelected && <Check className="h-4 w-4 text-amber-500" aria-label="Selected" />}
                  </div>
                  <div className="mt-2 flex gap-1" aria-hidden="true">
                    {meta.swatches.map((c) => (
                      <span key={c} className="h-5 w-5 rounded-full border border-zinc-700" style={{ background: c }} />
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-snug text-zinc-400">{meta.blurb}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">{meta.type}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Hero preview ──────────────────────────────────────────── */}
        <div>
          <h3 className="mb-1 text-sm font-semibold text-zinc-200">Hero preview</h3>
          <p className="mb-3 text-xs text-zinc-500">A simplified mock of how your homepage hero will compose.</p>
          <HeroPreview heroLayout={resolved.heroLayout} preset={selectedPreset} />
        </div>

        {/* ── Independent layout overrides ──────────────────────────── */}
        <div>
          <h3 className="mb-1 text-sm font-semibold text-zinc-200">Layout & behavior</h3>
          <p className="mb-4 text-xs text-zinc-500">
            Every option defaults to the preset&apos;s built-in choice. Override only what you want to differ.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(VISUAL_FIELD_OPTIONS) as VisualOverrideKey[]).map((key) => {
              const options = VISUAL_FIELD_OPTIONS[key]
              const presetDefault = (resolved[key] as string)
              const currentValue = overrides[key] ?? ''
              return (
                <label key={key} className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-300">{FIELD_LABELS[key]}</span>
                  <select
                    value={currentValue}
                    onChange={(e) => setOverride(key, e.target.value)}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
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

        <div className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-zinc-400">
            Walk-in navigation focus appears on the public site only when your shop supports walk-ins
            (Business Info → walk-ins welcome). Motion respects each visitor&apos;s reduced-motion preference
            regardless of the level chosen here.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

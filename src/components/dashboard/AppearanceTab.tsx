'use client'

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Check, Monitor, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  VISUAL_STYLES,
  VISUAL_STYLE_CONFIG,
  type VisualStyle,
} from '@/lib/visual-style'
import {
  VISUAL_FIELD_OPTIONS,
  type VisualOverrideKey,
  type VisualConfig,
  resolveVisualConfig,
} from '@/lib/visual-config'
import { FONT_FAMILY_OPTIONS, mapFontFamily } from '@/lib/theme'
import { PresetCompare } from '@/components/dashboard/PresetCompare'

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
}

const FIELD_LABELS: Record<VisualOverrideKey, string> = {
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
  sharp: 'Sharp — square corners',
  soft: 'Soft — slightly rounded',
  pill: 'Pill — fully rounded',
  square: 'Square — sharp corners',
  rounded: 'Rounded — soft corners',
  'full-bleed': 'Full-bleed — edge to edge',
  compact: 'Compact — smaller headings',
  grand: 'Grand — larger headings',
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

/** Mini-site preview: hero + service/team/gallery strips + CTA, all driven by
 * the RESOLVED draft (preset defaults + overrides) — what publish will render. */
function MiniSitePreview({ resolved, preset }: { resolved: VisualConfig; preset: VisualStyle }) {
  const meta = PRESET_META[preset]
  const [bg, accent, surface, light] = meta.swatches
  const headingFont = resolved.headingFont ? mapFontFamily(resolved.headingFont) : undefined
  const bodyFont = resolved.bodyFont ? mapFontFamily(resolved.bodyFont) : undefined
  const hSize = resolved.headingScale === 'grand' ? 'text-[13px]' : resolved.headingScale === 'compact' ? 'text-[9px]' : 'text-[11px]'
  const radius = resolved.buttonStyle === 'pill' ? 'rounded-full' : resolved.buttonStyle === 'soft' ? 'rounded-md' : 'rounded-none'
  const imgRadius = resolved.imageShape === 'rounded' ? 'rounded-md' : resolved.imageShape === 'full-bleed' ? 'rounded-none' : 'rounded-sm'
  const label = 'mb-1.5 text-[7px] font-semibold uppercase tracking-widest text-zinc-500'

  const services =
    resolved.serviceLayout === 'visual-menu' ? (
      <div className="grid grid-cols-3 gap-1">
        {['Cut', 'Fade', 'Shave'].map((n, i) => (
          <div key={n} className="overflow-hidden">
            <div className={cn('aspect-[4/3]', imgRadius)} style={{ background: i === 0 ? accent : i === 1 ? `${accent}66` : `${bg}55` }} />
            <p className="mt-0.5 text-[6px] font-medium" style={{ color: light }}>{n}</p>
          </div>
        ))}
      </div>
    ) : resolved.serviceLayout === 'cards' ? (
      <div className="grid grid-cols-2 gap-1">
        {['Cut — $30', 'Fade — $35', 'Shave — $25', 'Beard — $20'].map((n) => (
          <div key={n} className={cn('p-1 text-[6px]', imgRadius)} style={{ background: surface, color: light }}>{n}</div>
        ))}
      </div>
    ) : (
      <div className="flex flex-col gap-0.5">
        {['Cut — $30', 'Fade — $35', 'Shave — $25'].map((n, i) => (
          <div key={n} className="flex items-baseline justify-between gap-2">
            <span className="text-[6px] font-medium" style={{ color: light }}>{n.split(' — ')[0]}</span>
            <span className="h-px flex-1" style={{ background: `${bg}44` }} />
            <span className="text-[6px]" style={{ color: accent }}>{i === 1 ? '$35' : i === 2 ? '$25' : '$30'}</span>
          </div>
        ))}
      </div>
    )

  const team =
    resolved.barberLayout === 'portrait-grid' ? (
      <div className="grid grid-cols-3 gap-1">
        {['A', 'B', 'C'].map((n, i) => (
          <div key={n}>
            <div className={cn('aspect-[3/4]', imgRadius)} style={{ background: i === 1 ? `${accent}55` : `${bg}44` }} />
            <p className="mt-0.5 text-[6px] text-center" style={{ color: light }}>Barber {n}</p>
          </div>
        ))}
      </div>
    ) : resolved.barberLayout === 'large-profile' ? (
      <div className="flex gap-1.5">
        <div className={cn('aspect-[3/4] w-1/3 shrink-0', imgRadius)} style={{ background: `${accent}55` }} />
        <div className="flex flex-col justify-center gap-1">
          <span className={cn(hSize, 'font-bold leading-none')} style={{ color: light }}>Marcus D.</span>
          <span className="text-[6px]" style={{ color: accent }}>Master barber — 12 yrs</span>
          <span className="text-[6px]" style={{ color: `${light}99` }}>Fades · Beards</span>
        </div>
      </div>
    ) : (
      <div className="flex gap-1">
        {['A', 'B', 'C'].map((n, i) => (
          <div key={n} className="flex items-center gap-1.5 p-1" style={{ background: surface }}>
            <div className={cn('h-7 w-7 shrink-0', imgRadius)} style={{ background: i === 0 ? `${accent}66` : `${bg}44` }} />
            <div>
              <p className="text-[6px] font-semibold" style={{ color: light }}>Barber {n}</p>
              <p className="text-[5px]" style={{ color: accent }}>Specialty</p>
            </div>
          </div>
        ))}
      </div>
    )

  const gallery =
    resolved.galleryLayout === 'masonry' ? (
      <div className="flex gap-1">
        <div className="flex w-1/3 flex-col gap-1"><div className="h-8" style={{ background: `${bg}66` }} /><div className="h-5" style={{ background: `${accent}44` }} /></div>
        <div className="flex w-1/3 flex-col gap-1"><div className="h-5" style={{ background: `${accent}44` }} /><div className="h-8" style={{ background: `${bg}55` }} /></div>
        <div className="flex w-1/3 flex-col gap-1"><div className="h-6" style={{ background: `${bg}44` }} /><div className="h-7" style={{ background: `${accent}33` }} /></div>
      </div>
    ) : resolved.galleryLayout === 'filmstrip' ? (
      <div className="flex gap-1 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={cn('h-9 w-8 shrink-0', imgRadius)} style={{ background: i % 2 ? `${accent}33` : `${bg}55` }} />
        ))}
      </div>
    ) : resolved.galleryLayout === 'editorial' ? (
      <div className="flex gap-1">
        <div className={cn('h-9 w-1/2', imgRadius)} style={{ background: `${bg}55` }} />
        <div className="flex w-1/2 flex-col gap-1">
          <div className="h-4" style={{ background: `${accent}33` }} />
          <div className="h-4" style={{ background: `${bg}44` }} />
        </div>
      </div>
    ) : (
      <div className="grid grid-cols-4 gap-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="aspect-square" style={{ background: i % 2 ? `${accent}33` : `${bg}55` }} />
        ))}
      </div>
    )

  return (
    <div className="overflow-hidden rounded-md border border-zinc-700" style={{ background: `${bg}11` }} aria-hidden="true">
      <div className="border-b border-zinc-700 p-2.5" style={{ background: bg }}>
        <div className="flex items-center justify-between">
          <span className="text-[8px] font-bold uppercase tracking-widest" style={{ color: light }}>The Shop</span>
          <span className={cn('px-2 py-0.5 text-[6px] font-semibold text-white', radius)} style={{ background: accent }}>Book</span>
        </div>
      </div>
      <div className="space-y-2.5 p-2.5" style={{ fontFamily: bodyFont }}>
        <div>
          <p className={label} style={{ color: accent }}>Services — {OPTION_LABELS[resolved.serviceLayout] ?? resolved.serviceLayout}</p>
          {services}
        </div>
        <div>
          <p className={label} style={{ color: accent }}>Team — {OPTION_LABELS[resolved.barberLayout] ?? resolved.barberLayout}</p>
          <span style={{ fontFamily: headingFont }}>
            <span className={cn(hSize, 'block font-bold leading-tight')} style={{ color: light }}>The chairs behind the craft</span>
          </span>
          <div className="mt-1">{team}</div>
        </div>
        <div>
          <p className={label} style={{ color: accent }}>Gallery — {OPTION_LABELS[resolved.galleryLayout] ?? resolved.galleryLayout}</p>
          {gallery}
        </div>
        <div className="flex justify-center border-t border-zinc-700 pt-2.5">
          <span className={cn('px-3 py-1 text-[7px] font-semibold text-white', radius)} style={{ background: accent }}>
            Book your chair
          </span>
        </div>
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

        {/* ── Mini-site preview (hero + sections, from the resolved draft) ── */}
        <div>
          <h3 className="mb-1 text-sm font-semibold text-zinc-200">Site preview</h3>
          <p className="mb-3 text-xs text-zinc-500">
            A simplified mock of your homepage as this draft resolves it — hero, services, team, gallery, and buttons follow your choices below.
          </p>
          <div className="space-y-2">
            <HeroPreview heroLayout={resolved.heroLayout} preset={selectedPreset} />
            <MiniSitePreview resolved={resolved} preset={selectedPreset} />
          </div>
        </div>

        {/* ── Five-preset comparison (same real data, all styles) ───── */}
        <PresetCompare />

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

        {/* ── Typography ─────────────────────────────────────────────── */}
        <div>
          <h3 className="mb-1 text-sm font-semibold text-zinc-200">Typography</h3>
          <p className="mb-4 text-xs text-zinc-500">
            Optionally override the preset&apos;s fonts. The heading font applies to display
            headings; the body font applies to paragraphs, buttons, and forms.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-300">Heading font</span>
              <select
                value={overrides.headingFont ?? ''}
                onChange={(e) => setOverride('headingFont' as VisualOverrideKey, e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
              >
                <option value="">Preset default</option>
                {FONT_FAMILY_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label} — {f.description}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-300">Body font</span>
              <select
                value={overrides.bodyFont ?? ''}
                onChange={(e) => setOverride('bodyFont' as VisualOverrideKey, e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
              >
                <option value="">Preset default</option>
                {FONT_FAMILY_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label} — {f.description}</option>
                ))}
              </select>
            </label>
          </div>
          {(resolved.headingFont || resolved.bodyFont) && (
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4" aria-hidden="true">
              <p className="text-xs uppercase tracking-widest text-zinc-500">Font preview</p>
              <p
                className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100"
                style={{ fontFamily: resolved.headingFont ? mapFontFamily(resolved.headingFont) : undefined }}
              >
                Sharp looks, honest craft.
              </p>
              <p
                className="mt-2 text-sm text-zinc-400"
                style={{ fontFamily: resolved.bodyFont ? mapFontFamily(resolved.bodyFont) : undefined }}
              >
                Fades, beard work, and classic cuts — done right, every visit.
              </p>
            </div>
          )}
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

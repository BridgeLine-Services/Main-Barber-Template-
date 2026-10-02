import { VISUAL_STYLES, VISUAL_STYLE_CONFIG, type VisualStyle } from './visual-style'

// ─────────────────────────────────────────────────────────────────────────────
// Visual configuration system
//
// Owner settings → WebsiteContent draft fields (visualPreset + visualConfig)
// → publish snapshot → public website resolver → rendered composition.
//
// Every layout choice is INDEPENDENT and owner-selectable; each falls back to
// the selected preset's built-in mapping, and the preset falls back to
// 'modern-classic' (the historical default). Invalid values always resolve
// safely — this is the single source of truth for the public renderer.
// ─────────────────────────────────────────────────────────────────────────────

export const HERO_LAYOUTS = ['cinematic', 'split', 'poster'] as const
export const SERVICE_LAYOUTS = ['editorial', 'cards', 'visual-menu'] as const
export const BARBER_LAYOUTS = ['portrait-grid', 'editorial', 'large-profile'] as const
export const GALLERY_LAYOUTS = ['grid', 'masonry', 'editorial', 'filmstrip'] as const
export const MOTION_LEVELS = ['off', 'subtle', 'expressive'] as const
export const MOBILE_NAV_MODES = ['appointment', 'walk-in', 'barber'] as const
export const REVIEW_PRESENTATIONS = ['editorial', 'cards', 'strip'] as const

export type HeroLayout = (typeof HERO_LAYOUTS)[number]
export type ServiceLayout = (typeof SERVICE_LAYOUTS)[number]
export type BarberLayout = (typeof BARBER_LAYOUTS)[number]
export type GalleryLayout = (typeof GALLERY_LAYOUTS)[number]
export type MotionLevel = (typeof MOTION_LEVELS)[number]
export type MobileNavMode = (typeof MOBILE_NAV_MODES)[number]
export type ReviewPresentation = (typeof REVIEW_PRESENTATIONS)[number]

export interface VisualConfig {
  preset: VisualStyle
  presetLabel: string
  heroLayout: HeroLayout
  serviceLayout: ServiceLayout
  barberLayout: BarberLayout
  galleryLayout: GalleryLayout
  motionLevel: MotionLevel
  mobileNavMode: MobileNavMode
  reviewPresentation: ReviewPresentation
}

export const VISUAL_FIELD_OPTIONS = {
  heroLayout: HERO_LAYOUTS,
  serviceLayout: SERVICE_LAYOUTS,
  barberLayout: BARBER_LAYOUTS,
  galleryLayout: GALLERY_LAYOUTS,
  motionLevel: MOTION_LEVELS,
  mobileNavMode: MOBILE_NAV_MODES,
  reviewPresentation: REVIEW_PRESENTATIONS,
} as const

export type VisualOverrideKey = keyof typeof VISUAL_FIELD_OPTIONS
export const VISUAL_OVERRIDE_KEYS = Object.keys(VISUAL_FIELD_OPTIONS) as VisualOverrideKey[]

/** Runtime shape of the stored override JSON (all optional). */
export interface StoredVisualConfig {
  heroLayout?: unknown
  serviceLayout?: unknown
  barberLayout?: unknown
  galleryLayout?: unknown
  motionLevel?: unknown
  mobileNavMode?: unknown
  reviewPresentation?: unknown
}

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

/**
 * Resolve the effective visual configuration for a tenant.
 *
 * @param preset    the stored preset id (draft column or published snapshot)
 * @param overrides the stored layout overrides (draft column or snapshot)
 *
 * Precedence: explicit override → preset's built-in mapping → historical
 * default ('modern-classic'). Unknown/invalid anything is silently safe.
 */
export function resolveVisualConfig(preset?: unknown, overrides?: unknown): VisualConfig {
  const style: VisualStyle =
    typeof preset === 'string' && (VISUAL_STYLES as readonly string[]).includes(preset)
      ? (preset as VisualStyle)
      : 'modern-classic'
  const base = VISUAL_STYLE_CONFIG[style]
  const o: StoredVisualConfig =
    overrides && typeof overrides === 'object' && !Array.isArray(overrides)
      ? (overrides as StoredVisualConfig)
      : {}

  const galleryLayout = pick(o.galleryLayout, GALLERY_LAYOUTS)
  const motionLevel = pick(o.motionLevel, MOTION_LEVELS)
  const mobileNavMode = pick(o.mobileNavMode, MOBILE_NAV_MODES)
  const reviewPresentation = pick(o.reviewPresentation, REVIEW_PRESENTATIONS)

  return {
    preset: style,
    presetLabel: base.label,
    heroLayout: pick(o.heroLayout, HERO_LAYOUTS) ?? base.hero,
    serviceLayout: pick(o.serviceLayout, SERVICE_LAYOUTS) ?? base.services,
    barberLayout: pick(o.barberLayout, BARBER_LAYOUTS) ?? base.team,
    // Defaults for values with no preset mapping (first entry = sensible default)
    galleryLayout: galleryLayout ?? 'grid',
    motionLevel: motionLevel ?? base.motion,
    mobileNavMode: mobileNavMode ?? 'appointment',
    reviewPresentation: reviewPresentation ?? 'editorial',
  }
}

/**
 * Parse + validate an owner-submitted visual configuration for SAVING.
 * Returns a normalized override object with only valid keys, plus the
 * normalized preset. Used by the settings API.
 */
export function validateVisualConfigInput(input: {
  visualPreset?: unknown
  visualConfig?: unknown
}): { visualPreset: VisualStyle | null; visualConfig: StoredVisualConfig } {
  const preset = pick(input.visualPreset, VISUAL_STYLES)
  const raw: StoredVisualConfig =
    input.visualConfig && typeof input.visualConfig === 'object' && !Array.isArray(input.visualConfig)
      ? (input.visualConfig as StoredVisualConfig)
      : {}

  const clean: StoredVisualConfig = {}
  const heroLayout = pick(raw.heroLayout, HERO_LAYOUTS)
  const serviceLayout = pick(raw.serviceLayout, SERVICE_LAYOUTS)
  const barberLayout = pick(raw.barberLayout, BARBER_LAYOUTS)
  const galleryLayout = pick(raw.galleryLayout, GALLERY_LAYOUTS)
  const motionLevel = pick(raw.motionLevel, MOTION_LEVELS)
  const mobileNavMode = pick(raw.mobileNavMode, MOBILE_NAV_MODES)
  const reviewPresentation = pick(raw.reviewPresentation, REVIEW_PRESENTATIONS)
  if (heroLayout) clean.heroLayout = heroLayout
  if (serviceLayout) clean.serviceLayout = serviceLayout
  if (barberLayout) clean.barberLayout = barberLayout
  if (galleryLayout) clean.galleryLayout = galleryLayout
  if (motionLevel) clean.motionLevel = motionLevel
  if (mobileNavMode) clean.mobileNavMode = mobileNavMode
  if (reviewPresentation) clean.reviewPresentation = reviewPresentation

  return { visualPreset: preset, visualConfig: clean }
}

/**
 * Resolve the visual config a public page should render with, from the
 * WebsiteContent record (already merged with its published snapshot).
 * This is the one function customer-facing pages call.
 */
export function visualConfigFromContent(content: unknown): VisualConfig {
  const c = (content ?? {}) as {
    visualPreset?: unknown
    visualConfig?: unknown
    visualStyle?: unknown
  }
  // visualStyle: legacy key that may exist in older published snapshots.
  const preset = c.visualPreset ?? c.visualStyle
  return resolveVisualConfig(preset, c.visualConfig)
}

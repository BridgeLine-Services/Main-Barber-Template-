import { VISUAL_STYLES, VISUAL_STYLE_CONFIG, type VisualStyle } from './visual-style'
import { FONT_FAMILY_VALUES } from './theme'

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

// Owner-selectable identity overrides (gap 6): button shape, image shape,
// typography pairing (curated, self-hosted fonts), and heading scale.
// Bounded vocabularies only — the server rejects anything else.
export const BUTTON_STYLES = ['sharp', 'soft', 'pill'] as const
export const IMAGE_SHAPES = ['square', 'portrait', 'rounded', 'full-bleed'] as const
export const HEADING_SCALES = ['compact', 'standard', 'grand'] as const

export type HeroLayout = (typeof HERO_LAYOUTS)[number]
export type ServiceLayout = (typeof SERVICE_LAYOUTS)[number]
export type BarberLayout = (typeof BARBER_LAYOUTS)[number]
export type GalleryLayout = (typeof GALLERY_LAYOUTS)[number]
export type MotionLevel = (typeof MOTION_LEVELS)[number]
export type MobileNavMode = (typeof MOBILE_NAV_MODES)[number]
export type ReviewPresentation = (typeof REVIEW_PRESENTATIONS)[number]
export type ButtonStyle = (typeof BUTTON_STYLES)[number]
export type ImageShape = (typeof IMAGE_SHAPES)[number]
export type HeadingScale = (typeof HEADING_SCALES)[number]

/**
 * Owner override wins over the preset default (gap 6). The owner's
 * buttonStyle/imageShape choice replaces the preset mapping when set.
 */
export function resolvedButtonShapeClass(visual: VisualConfig): string {
  return visual.buttonStyle === 'pill'
    ? 'rounded-full'
    : visual.buttonStyle === 'soft'
      ? 'rounded-lg'
      : 'rounded-sm'
}

export function resolvedImageShapeClass(visual: VisualConfig): string {
  return visual.imageShape === 'rounded'
    ? 'rounded-2xl'
    : visual.imageShape === 'square' || visual.imageShape === 'full-bleed'
      ? 'rounded-none'
      : 'rounded-md'
}

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
  buttonStyle: ButtonStyle
  imageShape: ImageShape
  /** Curated self-hosted font id; null = follow the business branding font. */
  headingFont: string | null
  bodyFont: string | null
  headingScale: HeadingScale
}

export const VISUAL_FIELD_OPTIONS = {
  heroLayout: HERO_LAYOUTS,
  serviceLayout: SERVICE_LAYOUTS,
  barberLayout: BARBER_LAYOUTS,
  galleryLayout: GALLERY_LAYOUTS,
  motionLevel: MOTION_LEVELS,
  mobileNavMode: MOBILE_NAV_MODES,
  reviewPresentation: REVIEW_PRESENTATIONS,
  buttonStyle: BUTTON_STYLES,
  imageShape: IMAGE_SHAPES,
  headingScale: HEADING_SCALES,
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
  buttonStyle?: unknown
  imageShape?: unknown
  headingFont?: unknown
  bodyFont?: unknown
  headingScale?: unknown
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

  const buttonStyle = pick(o.buttonStyle, BUTTON_STYLES) ?? base.button
  const imageShape = pick(o.imageShape, IMAGE_SHAPES) ?? base.imageShape
  const headingFont = typeof o.headingFont === 'string' && (FONT_FAMILY_VALUES as readonly string[]).includes(o.headingFont) ? o.headingFont : null
  const bodyFont = typeof o.bodyFont === 'string' && (FONT_FAMILY_VALUES as readonly string[]).includes(o.bodyFont) ? o.bodyFont : null
  const headingScale = pick(o.headingScale, HEADING_SCALES) ?? 'standard'
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
    buttonStyle,
    imageShape,
    headingFont,
    bodyFont,
    headingScale,
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
  const buttonStyle = pick(raw.buttonStyle, BUTTON_STYLES)
  const imageShape = pick(raw.imageShape, IMAGE_SHAPES)
  const headingScale = pick(raw.headingScale, HEADING_SCALES)
  if (buttonStyle) clean.buttonStyle = buttonStyle
  if (imageShape) clean.imageShape = imageShape
  if (headingScale) clean.headingScale = headingScale
  // Typography: curated, self-hosted font ids only (see lib/theme.ts).
  if (typeof raw.headingFont === 'string' && (FONT_FAMILY_VALUES as readonly string[]).includes(raw.headingFont)) clean.headingFont = raw.headingFont
  if (typeof raw.bodyFont === 'string' && (FONT_FAMILY_VALUES as readonly string[]).includes(raw.bodyFont)) clean.bodyFont = raw.bodyFont

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

/**
 * Owner-facing guide to the eight visual identities.
 *
 * Why this file exists: the owner experience asked for by the enhancement
 * program needs plain-language descriptions of each identity, but the identity
 * definitions themselves live in `visual-style.ts` and must not be duplicated or
 * forked. Everything here is additive: labels, layout summaries and the layout
 * fingerprint are *derived* from `VISUAL_STYLE_CONFIG` at import time, so the
 * guide can never drift from the real presets. Only the human copy (personality,
 * who it suits, pace) is authored here.
 *
 * Guarantees:
 *   - one entry per identity, no more, no less (enforced by tests)
 *   - `describeStyle()` accepts anything and always returns a valid guide,
 *     falling back exactly like `getVisualStyle()` does
 *   - no new identifiers are introduced; the type is the existing `VisualStyle`
 *
 * Pure module: no React, no database, no I/O. Safe to call from a server
 * component, a client component or a test.
 */

import { getVisualStyle, VISUAL_STYLE_CONFIG, VISUAL_STYLES, type VisualStyle } from './visual-style'

export interface StylePersonality {
  /** Which identity this is, in the words owners use. */
  style: VisualStyle
  /** The preset's own label, taken from visual-style.ts. */
  label: string
  /** One sentence describing the feel, in business language. */
  personality: string
  /** The kind of shop this identity tends to suit. */
  bestFor: string
  /** How busy or calm the site feels, for comparing two identities. */
  pace: 'calm' | 'balanced' | 'energetic'
  /** Derived: what the homepage layouts actually do. */
  layoutSummary: string
  /** Derived: a stable fingerprint of the layout choices, for diffing/compare UI. */
  fingerprint: string
}

const COPY: Record<VisualStyle, { personality: string; bestFor: string; pace: StylePersonality['pace'] }> = {
  'black-label': {
    personality: 'Quiet confidence: dark, tailored and editorial, with big images and few words.',
    bestFor: 'Premium shops whose clients pay for craft, discretion and finish.',
    pace: 'calm',
  },
  'barber-heritage': {
    personality: 'Warm and tactile, like good signage on an old shopfront. Varied photo sizes and a classic review strip.',
    bestFor: 'Neighbourhood shops with a history and a loyal local clientele.',
    pace: 'balanced',
  },
  'street-cut': {
    personality: 'Bold and loud, built like a poster wall. Horizontal photo strips and punchy review cards.',
    bestFor: 'Urban shops and younger clients who want energy over polish.',
    pace: 'energetic',
  },
  'clean-club': {
    personality: 'Calm and orderly. Even grids, quiet reviews, nothing competing for attention.',
    bestFor: 'Busy shops that mostly need clarity: services, prices, book now.',
    pace: 'calm',
  },
  'modern-classic': {
    personality: 'The refined default: a balanced split hero, editorial services and quote-led reviews.',
    bestFor: 'Most shops. A safe starting point that does not need explaining.',
    pace: 'balanced',
  },
  'warm-premium': {
    personality: 'Comfortable luxury, like a coffee house at a high price point. Soft frames and a glowing services row.',
    bestFor: 'Upmarket lounges and hybrid bar/café shops that sell an experience.',
    pace: 'calm',
  },
  'high-energy-urban': {
    personality: 'Poster walls and voltage: hard frames, stripe accents, fast horizontal movement.',
    bestFor: 'Streetwear-adjacent shops with a strong visual brand and a young crowd.',
    pace: 'energetic',
  },
  'single-chair': {
    personality: 'One person, one brand. A cinematic opening, menu-board services and the barber\u2019s own portfolio wall.',
    bestFor: 'Independent barbers and single-chair studios working alone.',
    pace: 'balanced',
  },
}

const HERO_WORDS: Record<string, string> = {
  cinematic: 'full-width cinematic opener',
  split: 'side-by-side opener',
  poster: 'poster-style opener',
}

const SERVICE_WORDS: Record<string, string> = {
  editorial: 'editorial service list',
  cards: 'service cards',
  'visual-menu': 'menu-board services',
}

const TEAM_WORDS: Record<string, string> = {
  'portrait-grid': 'even portrait grid',
  editorial: 'editorial team rows',
  'large-profile': 'one large profile',
}

const GALLERY_WORDS: Record<string, string> = {
  grid: 'even photo grid',
  masonry: 'mixed-height photo wall',
  editorial: 'editorial gallery rows',
  filmstrip: 'horizontal filmstrip',
}

const REVIEW_WORDS: Record<string, string> = {
  editorial: 'quote-led reviews',
  cards: 'review cards',
  strip: 'single review strip',
}

/** Derived layout sentence, e.g. "full-width cinematic opener, menu-board services, ...". */
function summarise(style: VisualStyle): string {
  const c = VISUAL_STYLE_CONFIG[style]
  return [
    HERO_WORDS[c.hero] ?? c.hero,
    SERVICE_WORDS[c.services] ?? c.services,
    TEAM_WORDS[c.team] ?? c.team,
    GALLERY_WORDS[c.gallery] ?? c.gallery,
    REVIEW_WORDS[c.reviews] ?? c.reviews,
  ].join(', ')
}

/** Derived fingerprint of the layout choices, so a compare view can show "what differs". */
function fingerprintOf(style: VisualStyle): string {
  const c = VISUAL_STYLE_CONFIG[style]
  return [c.hero, c.services, c.team, c.gallery, c.reviews, c.imageShape, c.button, c.motion].join('|')
}

/** All eight identities, in the canonical order of `VISUAL_STYLES`. */
export function styleGuideList(): StylePersonality[] {
  return VISUAL_STYLES.map((style) => describeStyle(style))
}

/**
 * Everything an owner needs to understand one identity. Accepts any input;
 * an unknown value resolves the same way the rest of the app resolves it,
 * so a stale saved value shows the identity the site is actually using.
 */
export function describeStyle(value: unknown): StylePersonality {
  const style = getVisualStyle(value)
  const copy = COPY[style]
  return {
    style,
    label: VISUAL_STYLE_CONFIG[style].label,
    personality: copy.personality,
    bestFor: copy.bestFor,
    pace: copy.pace,
    layoutSummary: summarise(style),
    fingerprint: fingerprintOf(style),
  }
}

/**
 * What actually changes between two identities, or an empty list when the
 * layouts are identical. Used by the comparison view to avoid claiming a
 * difference that is not there.
 */
export function layoutDifferences(a: unknown, b: unknown): string[] {
  const left = describeStyle(a)
  const right = describeStyle(b)
  if (left.style === right.style) return []
  const ca = VISUAL_STYLE_CONFIG[left.style]
  const cb = VISUAL_STYLE_CONFIG[right.style]
  const out: string[] = []
  if (ca.hero !== cb.hero) out.push('opening section')
  if (ca.services !== cb.services) out.push('service layout')
  if (ca.team !== cb.team) out.push('team presentation')
  if (ca.gallery !== cb.gallery) out.push('photo gallery')
  if (ca.reviews !== cb.reviews) out.push('reviews')
  if (ca.imageShape !== cb.imageShape) out.push('image corners')
  if (ca.button !== cb.button) out.push('button shape')
  if (ca.motion !== cb.motion) out.push('motion level')
  return out
}

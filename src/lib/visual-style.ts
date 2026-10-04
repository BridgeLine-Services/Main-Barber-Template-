export const VISUAL_STYLES = [
  'black-label',
  'barber-heritage',
  'street-cut',
  'clean-club',
  'modern-classic',
  'warm-premium',
  'high-energy-urban',
  'single-chair',
] as const

export type VisualStyle = (typeof VISUAL_STYLES)[number]

type StyleConfig = {
  label: string
  hero: 'cinematic' | 'split' | 'poster'
  services: 'editorial' | 'cards' | 'visual-menu'
  team: 'portrait-grid' | 'editorial' | 'large-profile'
  gallery: 'grid' | 'masonry' | 'editorial' | 'filmstrip'
  reviews: 'editorial' | 'cards' | 'strip'
  imageShape: 'square' | 'portrait' | 'rounded' | 'full-bleed'
  button: 'sharp' | 'soft' | 'pill'
  motion: 'off' | 'subtle' | 'expressive'
}

export const VISUAL_STYLE_CONFIG: Record<VisualStyle, StyleConfig> = {
  'black-label': {
    // Premium editorial storytelling: curated feature rows and quote-led reviews.
    label: 'Black Label', hero: 'cinematic', services: 'editorial', team: 'editorial', gallery: 'editorial', reviews: 'editorial',
    imageShape: 'portrait', button: 'sharp', motion: 'subtle',
  },
  'barber-heritage': {
    // Tactile and varied: mixed-height masonry, signage-style review strip.
    label: 'Barber Heritage', hero: 'cinematic', services: 'visual-menu', team: 'portrait-grid', gallery: 'masonry', reviews: 'strip',
    imageShape: 'rounded', button: 'soft', motion: 'subtle',
  },
  'street-cut': {
    // Bold poster energy: horizontal filmstrip, punchy review cards.
    label: 'Street Cut', hero: 'poster', services: 'cards', team: 'large-profile', gallery: 'filmstrip', reviews: 'cards',
    imageShape: 'square', button: 'sharp', motion: 'expressive',
  },
  'clean-club': {
    // Calm and orderly: uniform grid, quiet review strip.
    label: 'Clean Club', hero: 'split', services: 'cards', team: 'portrait-grid', gallery: 'grid', reviews: 'strip',
    imageShape: 'rounded', button: 'pill', motion: 'off',
  },
  'modern-classic': {
    // Refined default: uniform grid, quote-led reviews (historical behavior).
    label: 'Modern Classic', hero: 'split', services: 'editorial', team: 'editorial', gallery: 'grid', reviews: 'editorial',
    imageShape: 'portrait', button: 'soft', motion: 'subtle',
  },
  'warm-premium': {
    // Coffee-house comfort at luxury grade: soft frames, glowing hero
    // services, one large personal profile row.
    label: 'Warm Premium', hero: 'split', services: 'editorial', team: 'large-profile', gallery: 'editorial', reviews: 'editorial',
    imageShape: 'rounded', button: 'soft', motion: 'subtle',
  },
  'high-energy-urban': {
    // Poster walls and voltage: hard frames, tape-stripe underlines,
    // horizontal filmstrip, punchy review cards.
    label: 'High-Energy Urban', hero: 'poster', services: 'cards', team: 'large-profile', gallery: 'filmstrip', reviews: 'cards',
    imageShape: 'square', button: 'sharp', motion: 'expressive',
  },
  'single-chair': {
    // One person, one brand: cinematic intro, menu-board services, the
    // barber's own portfolio wall, journal-style reviews.
    label: 'Single-Chair Studio', hero: 'cinematic', services: 'visual-menu', team: 'large-profile', gallery: 'masonry', reviews: 'editorial',
    imageShape: 'portrait', button: 'pill', motion: 'subtle',
  },
}

export function getVisualStyle(value: unknown): VisualStyle {
  return typeof value === 'string' && VISUAL_STYLES.includes(value as VisualStyle)
    ? value as VisualStyle
    : 'modern-classic'
}

export function getVisualStyleConfig(value: unknown) {
  const style = getVisualStyle(value)
  return { style, ...VISUAL_STYLE_CONFIG[style] }
}

export function visualStyleClass(value: unknown) {
  return `visual-style-${getVisualStyle(value)}`
}

export function buttonStyleClass(value: unknown) {
  const { button } = getVisualStyleConfig(value)
  return button === 'pill' ? 'rounded-full' : button === 'soft' ? 'rounded-lg' : 'rounded-sm'
}

export function imageStyleClass(value: unknown) {
  const { imageShape } = getVisualStyleConfig(value)
  return imageShape === 'rounded' ? 'rounded-2xl' : imageShape === 'square' ? 'rounded-none' : imageShape === 'full-bleed' ? 'rounded-none' : 'rounded-md'
}

export const VISUAL_STYLES = [
  'black-label',
  'barber-heritage',
  'street-cut',
  'clean-club',
  'modern-classic',
] as const

export type VisualStyle = (typeof VISUAL_STYLES)[number]

type StyleConfig = {
  label: string
  hero: 'cinematic' | 'split' | 'poster'
  services: 'editorial' | 'cards' | 'visual-menu'
  team: 'portrait-grid' | 'editorial' | 'large-profile'
  imageShape: 'square' | 'portrait' | 'rounded' | 'full-bleed'
  button: 'sharp' | 'soft' | 'pill'
  motion: 'off' | 'subtle' | 'expressive'
}

export const VISUAL_STYLE_CONFIG: Record<VisualStyle, StyleConfig> = {
  'black-label': {
    label: 'Black Label', hero: 'cinematic', services: 'editorial', team: 'editorial', imageShape: 'portrait', button: 'sharp', motion: 'subtle',
  },
  'barber-heritage': {
    label: 'Barber Heritage', hero: 'cinematic', services: 'visual-menu', team: 'portrait-grid', imageShape: 'rounded', button: 'soft', motion: 'subtle',
  },
  'street-cut': {
    label: 'Street Cut', hero: 'poster', services: 'cards', team: 'large-profile', imageShape: 'square', button: 'sharp', motion: 'expressive',
  },
  'clean-club': {
    label: 'Clean Club', hero: 'split', services: 'cards', team: 'portrait-grid', imageShape: 'rounded', button: 'pill', motion: 'off',
  },
  'modern-classic': {
    label: 'Modern Classic', hero: 'split', services: 'editorial', team: 'editorial', imageShape: 'portrait', button: 'soft', motion: 'subtle',
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

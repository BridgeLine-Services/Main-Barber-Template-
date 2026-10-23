// ============================================================================
// DASHBOARD THEME — the dashboard half of the shared brand design system.
//
// The customer website is themed by generateThemeCSS() (src/lib/theme.ts),
// which scopes the business's brand palette under `.brand-theme`. This module
// does the same for the OWNER dashboard: it maps the business's selected
// VISUAL PRESET (plus any custom brand colors) onto a scoped `.dash-theme`
// block that re-defines the same semantic tokens the shadcn/ui primitives
// already consume (--background, --card, --border, --foreground, --accent,
// --ring, --radius) plus a few dashboard-only tokens.
//
// One business, one visual identity, two connected experiences:
//   • Storefront: .brand-theme  (customer site, src/lib/theme.ts)
//   • Control room: .dash-theme (this module, dashboard layout)
//
// Rules:
//   • Custom business colors always win over preset defaults (accent color).
//   • The published visual preset is the source of truth; the layout falls
//     back to the live draft column pre-first-publish (parity with the
//     public site).
//   • The owner's saved themeMode (Light/Dark) controls the dashboard's
//     overall brightness. Each preset keeps its character (accent hue,
//     temperature, radius, typography) in BOTH modes via a light and a dark
//     palette variant; themeMode selects which variant renders.
//   • No server-only imports — safe for client previews too (Appearance
//     settings can render the same block scoped to a preview container).
// ============================================================================

import type { VisualStyle } from './visual-style'
import { getVisualStyle, getVisualStyleConfig } from './visual-style'
import { DEFAULT_BRANDING, readableForegroundFor, hexToHsl, mapFontFamily } from './theme'

/** Branding inputs (subset of the Business + WebsiteContent records). */
export interface DashboardBrandInput {
  visualPreset?: string | null
  primaryColor?: string | null
  secondaryColor?: string | null
  accentColor?: string | null
  fontFamily?: string | null
  /** Owner-selected Light/Dark mode (Business.themeMode). Null = preset default. */
  themeMode?: string | null
}

type DashPalette = {
  bg: string
  surface: string
  surface2: string
  border: string
  borderStrong: string
  text: string
  muted: string
  hover: string
  accent: string
  accentFg: string
  radius: string
  displayFont: string
  dark: boolean
}

const isHex = (v: unknown): v is string =>
  typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)

/**
 * Dark dashboard palettes per visual preset (the control-room default for
 * presets with a dark storefront character).
 */
const PRESET_DASH: Record<VisualStyle, DashPalette> = {
  'black-label': {
    bg: '#0b0b0c', surface: '#131315', surface2: '#1a1a1d', border: '#26262a', borderStrong: '#333338',
    text: '#f2f0eb', muted: '#a29e93', hover: '#1f1f23', accent: '#c9a961', accentFg: '#0b0b0c',
    radius: '4px', displayFont: "'Playfair Display', Georgia, serif", dark: true,
  },
  'barber-heritage': {
    bg: '#f4efe4', surface: '#faf6ec', surface2: '#efe8d8', border: '#ddd3bd', borderStrong: '#c9bda2',
    text: '#2c241a', muted: '#6e6353', hover: '#e9e1ce', accent: '#7c2d2e', accentFg: '#faf6ec',
    radius: '8px', displayFont: "'Playfair Display', Georgia, serif", dark: false,
  },
  'street-cut': {
    bg: '#111111', surface: '#181818', surface2: '#202020', border: '#2c2c2c', borderStrong: '#3a3a3a',
    text: '#f5f5f5', muted: '#9d9d9d', hover: '#242424', accent: '#ff5c39', accentFg: '#111111',
    radius: '4px', displayFont: "'Oswald', 'Arial Narrow', sans-serif", dark: true,
  },
  'clean-club': {
    bg: '#f6f7f9', surface: '#ffffff', surface2: '#eceef1', border: '#e3e6ea', borderStrong: '#cbd1d8',
    text: '#1f2937', muted: '#6b7280', hover: '#e9ebee', accent: '#0f766e', accentFg: '#ffffff',
    radius: '10px', displayFont: "'Inter', system-ui, sans-serif", dark: false,
  },
  'modern-classic': {
    bg: '#141210', surface: '#1c1917', surface2: '#25211d', border: '#2e2925', borderStrong: '#3d3630',
    text: '#f0ece5', muted: '#a89f92', hover: '#292420', accent: '#c88a4b', accentFg: '#141210',
    radius: '6px', displayFont: "'Playfair Display', Georgia, serif", dark: true,
  },
  'warm-premium': {
    bg: '#221a12', surface: '#2b2218', surface2: '#352a1e', border: '#3d3022', borderStrong: '#4c3d2c',
    text: '#f5efe4', muted: '#ab9c85', hover: '#332819', accent: '#c98f4e', accentFg: '#221a12',
    radius: '8px', displayFont: "'Playfair Display', Georgia, serif", dark: true,
  },
  'high-energy-urban': {
    bg: '#101214', surface: '#17191c', surface2: '#1e2125', border: '#2a2e33', borderStrong: '#3a3f45',
    text: '#f0f2f4', muted: '#9aa1a9', hover: '#22262b', accent: '#c8f318', accentFg: '#101214',
    radius: '4px', displayFont: "'Oswald', 'Arial Narrow', sans-serif", dark: true,
  },
  'single-chair': {
    bg: '#f8f5ef', surface: '#fffdf8', surface2: '#f1ece2', border: '#e4ddd0', borderStrong: '#d4c9b6',
    text: '#2a251c', muted: '#756c5b', hover: '#ece5d8', accent: '#8a6d3f', accentFg: '#fffdf8',
    radius: '8px', displayFont: "'Playfair Display', Georgia, serif", dark: false,
  },
}

/**
 * LIGHT counterparts for the dark-character presets. The owner's selected
 * Light mode flips brightness without discarding the preset's identity:
 * each light palette keeps the accent hue, temperature and typography of
 * its dark sibling on readable light surfaces. (Presets whose default is
 * already light reuse themselves here.) Accent colors that would be
 * illegible on light surfaces (e.g. the voltage lime) are deepened.
 */
const PRESET_DASH_LIGHT: Record<VisualStyle, DashPalette> = {
  'black-label': {
    bg: '#f7f5f0', surface: '#fffefa', surface2: '#efece4', border: '#e0dbcf', borderStrong: '#c9c2b2',
    text: '#221f17', muted: '#6d6759', hover: '#ece7db', accent: '#8a6d1f', accentFg: '#ffffff',
    radius: '4px', displayFont: "'Playfair Display', Georgia, serif", dark: false,
  },
  'barber-heritage': PRESET_DASH['barber-heritage'],
  'street-cut': {
    bg: '#f5f5f4', surface: '#ffffff', surface2: '#ececea', border: '#dcdcd9', borderStrong: '#c4c4c0',
    text: '#171717', muted: '#676763', hover: '#e9e9e6', accent: '#d63a00', accentFg: '#ffffff',
    radius: '4px', displayFont: "'Oswald', 'Arial Narrow', sans-serif", dark: false,
  },
  'clean-club': PRESET_DASH['clean-club'],
  'modern-classic': {
    bg: '#f6f5f2', surface: '#fffdf9', surface2: '#efede7', border: '#e2ded4', borderStrong: '#cbc5b6',
    text: '#26211a', muted: '#6f685c', hover: '#eceae4', accent: '#96602a', accentFg: '#ffffff',
    radius: '6px', displayFont: "'Playfair Display', Georgia, serif", dark: false,
  },
  'warm-premium': {
    bg: '#faf5ec', surface: '#fffaf1', surface2: '#f3ebdc', border: '#e6dac4', borderStrong: '#d3c3a6',
    text: '#33261a', muted: '#7a6a55', hover: '#f1e9da', accent: '#9a6425', accentFg: '#ffffff',
    radius: '8px', displayFont: "'Playfair Display', Georgia, serif", dark: false,
  },
  'high-energy-urban': {
    bg: '#f4f6f7', surface: '#ffffff', surface2: '#e8ecef', border: '#d8dee2', borderStrong: '#c0c9cf',
    text: '#14181b', muted: '#5f6b72', hover: '#e6eaec', accent: '#5c7a00', accentFg: '#ffffff',
    radius: '4px', displayFont: "'Oswald', 'Arial Narrow', sans-serif", dark: false,
  },
  'single-chair': PRESET_DASH['single-chair'],
}

/** Fallback when nothing is configured — the classic zinc dashboard look. */
const FALLBACK = PRESET_DASH['modern-classic']

/**
 * Darkens a hex accent color until it is legible as text/fill on light
 * surfaces (contrast >= 4.5:1 vs the light workspace background). Used when
 * the owner selects Light mode with a bright accent (voltage lime, pale
 * gold) — the brand hue is preserved, only its lightness is pulled down.
 */
function ensureAccentReadableOnLight(hex: string): string {
  let r = parseInt(hex.slice(1, 3), 16)
  let g = parseInt(hex.slice(3, 5), 16)
  let b = parseInt(hex.slice(5, 7), 16)
  // Luminance of the lightest workspace surface we render accents on.
  const bgLum = 0.94
  for (let i = 0; i < 10; i++) {
    const lin = [r, g, b].map((c) => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
    const lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    const contrast = (bgLum + 0.05) / (lum + 0.05)
    if (contrast >= 4.5) break
    r = Math.round(r * 0.82)
    g = Math.round(g * 0.82)
    b = Math.round(b * 0.82)
  }
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Resolves the dashboard palette: the preset's character in the owner's
 * selected Light/Dark mode, with the business's own custom accent (and
 * font) always taking precedence over preset defaults.
 *
 * Mode resolution: an explicit themeMode ('light' | 'dark') wins; otherwise
 * the preset's default brightness is kept.
 */
export function resolveDashboardPalette(input: DashboardBrandInput): DashPalette {
  const style = getVisualStyle(input.visualPreset)
  const darkDefault = PRESET_DASH[style]
  const lightDefault = PRESET_DASH_LIGHT[style]

  const requestedLight =
    input.themeMode === 'light' ||
    (input.themeMode !== 'dark' && input.themeMode != null && input.themeMode.toLowerCase() === 'light')

  const base = requestedLight ? lightDefault : darkDefault

  let accent = base.accent
  let accentFg = base.accentFg
  if (isHex(input.accentColor) && input.accentColor !== DEFAULT_BRANDING.accentColor) {
    accent = input.accentColor
    if (!base.dark) {
      // Light mode: a too-bright custom accent would vanish on light
      // surfaces — preserve the hue, pull the lightness down.
      accent = ensureAccentReadableOnLight(accent)
    }
    accentFg =
      readableForegroundFor(accent) === '0 0% 4%' ? '#0a0a0a' : '#fafafa'
  }

  const displayFont = input.fontFamily
    ? mapFontFamily(input.fontFamily)
    : base.displayFont

  return { ...base, accent, accentFg, displayFont }
}

/**
 * Generates the scoped CSS block for the dashboard shell. Re-defines the
 * standard shadcn semantic tokens inside `.dash-theme` (so every Card,
 * Button, Input, Table, Dialog, Dropdown and Tab used by the dashboard
 * inherits the brand identity through the CSS cascade) plus explicit
 * dashboard-only tokens for the sidebar/header surfaces.
 *
 * `scope` defaults to '.dash-theme' (dashboard layout). The Appearance
 * settings preview can pass a different scope (e.g. '.dash-preview') to show
 * owners how a preset changes the dashboard without touching the live one.
 */
export function generateDashboardThemeCSS(input: DashboardBrandInput, scope = '.dash-theme'): string {
  const p = resolveDashboardPalette(input)
  const style = getVisualStyle(input.visualPreset)
  const { button } = getVisualStyleConfig(style)
  const radius = button === 'pill' ? '10px' : button === 'soft' ? '8px' : '5px'

  // Portal content (dialogs, dropdown menus, selects, toasts) is teleported
  // to <body>, escaping the scoped subtree. Mirror the tokens onto <body>
  // while the dashboard is mounted so portals inherit them. Gated to the
  // LIVE dashboard scope only — the draft preview (.dash-preview) must
  // never leak tokens to the document.
  const selector = scope === '.dash-theme' ? '.dash-theme, body:has(.dash-theme)' : scope

  return `
${selector} {
  /* shadcn semantic tokens — theme every dashboard primitive at once */
  --background: ${hexToHsl(p.bg)};
  --foreground: ${hexToHsl(p.text)};
  --card: ${hexToHsl(p.surface)};
  --card-foreground: ${hexToHsl(p.text)};
  --popover: ${hexToHsl(p.surface2)};
  --popover-foreground: ${hexToHsl(p.text)};
  --primary: ${hexToHsl(p.accent)};
  --primary-foreground: ${hexToHsl(p.accentFg)};
  --secondary: ${hexToHsl(p.surface2)};
  --secondary-foreground: ${hexToHsl(p.text)};
  --muted: ${hexToHsl(p.surface2)};
  --muted-foreground: ${hexToHsl(p.muted)};
  --accent: ${hexToHsl(p.hover)};
  --accent-foreground: ${hexToHsl(p.text)};
  --destructive: ${p.dark ? '0 72% 51%' : '0 74% 42%'};
  --border: ${hexToHsl(p.border)};
  --input: ${hexToHsl(p.borderStrong)};
  --ring: ${hexToHsl(p.accent)};
  --radius: ${p.radius};

  /* dashboard shell surfaces (sidebar, top bar, active nav) */
  --dash-surface: ${hexToHsl(p.surface)};
  --dash-surface-2: ${hexToHsl(p.surface2)};
  --dash-header: ${hexToHsl(p.dark ? p.bg : p.surface2)};
  --dash-hover: ${hexToHsl(p.hover)};
  --dash-brand: ${hexToHsl(p.accent)};
  --dash-brand-foreground: ${hexToHsl(p.accentFg)};
  --dash-brand-soft: ${p.accent}1a;
  --dash-brand-border: ${p.accent}40;
  /* status colors, lightness-tuned per theme so they read on dark AND light presets */
  --dash-ok: ${p.dark ? '#34d399' : '#047857'};
  --dash-warn: ${p.dark ? '#fbbf24' : '#b45309'};
  --dash-info: ${p.dark ? '#60a5fa' : '#1d4ed8'};
  --dash-danger: ${p.dark ? '#f87171' : '#b91c1c'};
  --dash-display-font: ${p.displayFont};
}
`
}

/** Inline style object for the layout root — applies the scope class. */
export const DASH_THEME_CLASS = 'dash-theme'

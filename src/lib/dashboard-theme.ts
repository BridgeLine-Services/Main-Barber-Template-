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
 * Dashboard character per visual preset. Surfaces/borders/typography stay
 * dashboard-appropriate (dense, readable); the accent + overall temperature
 * carry the brand so the control room unmistakably matches the storefront.
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
}

/** Fallback when nothing is configured — the classic zinc dashboard look. */
const FALLBACK = PRESET_DASH['modern-classic']

/**
 * Resolves the dashboard palette: preset character, with the business's own
 * custom accent (and font) always taking precedence over preset defaults.
 */
export function resolveDashboardPalette(input: DashboardBrandInput): DashPalette {
  const style = getVisualStyle(input.visualPreset)
  const base = PRESET_DASH[style]

  let accent = base.accent
  let accentFg = base.accentFg
  if (isHex(input.accentColor) && input.accentColor !== DEFAULT_BRANDING.accentColor) {
    accent = input.accentColor
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

  return `
${scope} {
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
  --dash-display-font: ${p.displayFont};
}
`
}

/** Inline style object for the layout root — applies the scope class. */
export const DASH_THEME_CLASS = 'dash-theme'

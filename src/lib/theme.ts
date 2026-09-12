// ============================================================================
// THEME — single source of truth for white-label theming.
//
// Shared between:
//   • src/components/customer/ThemeStyle.tsx (public site <style> injection)
//   • src/components/onboarding/BrandingStep.tsx (onboarding live preview)
//
// Keeping one implementation guarantees the onboarding preview renders
// exactly what the public website will render.
//
// NOTE: no server-only or Prisma imports here — this module must be safe to
// import from client components.
// ============================================================================

/** Branding fields used for theming (subset of the Business record). */
export interface ThemeSettings {
  primaryColor: string | null
  accentColor: string | null
  secondaryColor?: string | null
  fontFamily?: string | null
  themeMode?: string | null
}

/** Template default branding — the public site fallback styling. */
export const DEFAULT_BRANDING = {
  primaryColor: '#1a1a1a',
  accentColor: '#d4af37',
  secondaryColor: '#2a2a2a',
  themeMode: 'dark',
  fontFamily: null as string | null,
} as const

/** Font families the template supports (loaded via next/font in layout.tsx). */
export const FONT_FAMILY_OPTIONS = [
  { value: 'inter', label: 'Inter', description: 'Clean, modern, neutral' },
  { value: 'poppins', label: 'Poppins', description: 'Friendly, geometric' },
  { value: 'montserrat', label: 'Montserrat', description: 'Bold, contemporary' },
  { value: 'playfair', label: 'Playfair Display', description: 'Elegant, classic serif' },
  { value: 'roboto', label: 'Roboto', description: 'Simple, highly readable' },
  { value: 'oswald', label: 'Oswald', description: 'Strong, condensed' },
  { value: 'lato', label: 'Lato', description: 'Warm, rounded' },
] as const

export const FONT_FAMILY_VALUES = FONT_FAMILY_OPTIONS.map((f) => f.value)

/**
 * Generates CSS custom properties from the business theme.
 * Converts hex colors to HSL for shadcn/ui compatibility.
 *
 * `scope`: when provided (e.g. '.brand-preview'), the variables are scoped
 * to that selector instead of :root/body — used by the onboarding live
 * preview so previewing a theme doesn't restyle the whole dashboard.
 */
export function generateThemeCSS(theme: ThemeSettings, scope?: string): string {
  const accentHsl = hexToHsl(theme.accentColor || DEFAULT_BRANDING.accentColor)
  const primaryHsl = hexToHsl(theme.primaryColor || DEFAULT_BRANDING.primaryColor)
  const secondaryHsl = theme.secondaryColor
    ? hexToHsl(theme.secondaryColor)
    : hexToHsl(DEFAULT_BRANDING.secondaryColor)

  const fontFamily = theme.fontFamily
    ? mapFontFamily(theme.fontFamily)
    : "'Inter', system-ui, sans-serif"

  const isDark = (theme.themeMode || DEFAULT_BRANDING.themeMode) === 'dark'

  if (scope) {
    // Scoped mode — everything in one block so the preview container owns
    // the full themed surface (background, card, text, accent).
    return `
${scope} {
  --accent: ${accentHsl};
  --accent-foreground: ${isDark ? '0 0% 98%' : '0 0% 5%'};
  --primary: ${primaryHsl};
  --primary-foreground: ${isDark ? '0 0% 98%' : '0 0% 5%'};
  --secondary: ${secondaryHsl};
  --secondary-foreground: ${isDark ? '0 0% 98%' : '0 0% 5%'};
  --background: ${isDark ? primaryHsl : '0 0% 100%'};
  --foreground: ${isDark ? '0 0% 98%' : '240 10% 3.9%'};
  --card: ${isDark ? secondaryHsl : '0 0% 100%'};
  --card-foreground: ${isDark ? '0 0% 98%' : '240 10% 3.9%'};
  --muted: ${isDark ? secondaryHsl : '240 4.8% 95.9%'};
  --muted-foreground: ${isDark ? '0 0% 63.9%' : '240 3.8% 46.1%'};
  --border: ${isDark ? '0 0% 14.9%' : '240 5.9% 90%'};
  --ring: ${accentHsl};
  --font-family: ${fontFamily};
  font-family: var(--font-family);
}
`
  }

  // Non-scoped mode — the public website. All variables are emitted under a
  // single `.brand-theme` class which the customer layout puts on its root
  // wrapper. Everything inside inherits the business's full palette through
  // CSS variable cascade, regardless of the global `dark` class on <html>.
  // (The dashboard keeps the globals.css defaults; the customer site is
  // themed end-to-end by the business record itself.)
  return `
.brand-theme {
  --accent: ${accentHsl};
  --accent-foreground: ${isDark ? '0 0% 98%' : '0 0% 5%'};
  --primary: ${primaryHsl};
  --primary-foreground: ${isDark ? '0 0% 98%' : '0 0% 5%'};
  --secondary: ${secondaryHsl};
  --secondary-foreground: ${isDark ? '0 0% 98%' : '0 0% 5%'};
  --background: ${isDark ? primaryHsl : '0 0% 100%'};
  --foreground: ${isDark ? '0 0% 98%' : '240 10% 3.9%'};
  --card: ${isDark ? secondaryHsl : '0 0% 100%'};
  --card-foreground: ${isDark ? '0 0% 98%' : '240 10% 3.9%'};
  --muted: ${isDark ? secondaryHsl : '240 4.8% 95.9%'};
  --muted-foreground: ${isDark ? '0 0% 63.9%' : '240 3.8% 46.1%'};
  --border: ${isDark ? '0 0% 14.9%' : '240 5.9% 90%'};
  --input: ${isDark ? '0 0% 14.9%' : '240 5.9% 90%'};
  --ring: ${accentHsl};
  --font-family: ${fontFamily};
  --font-display: ${mapDisplayFont(theme.fontFamily)};
  font-family: var(--font-family);
}
`
}

/** Converts a hex color to an HSL string (e.g., "212 67% 45%"). */
export function hexToHsl(hex: string): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      case b: h = (r - g) / d + 4; break
    }
    h /= 6
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

/** Validates a #rrggbb hex color string. */
export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

/**
 * Maps a font family key to a CSS font stack.
 * Uses the next/font CSS variables declared in src/app/layout.tsx so every
 * option actually renders its real typeface (with graceful fallback).
 */
export function mapFontFamily(font: string): string {
  const fonts: Record<string, string> = {
    poppins: 'var(--font-poppins), var(--font-inter), system-ui, sans-serif',
    inter: 'var(--font-inter), system-ui, sans-serif',
    montserrat: 'var(--font-montserrat), var(--font-inter), system-ui, sans-serif',
    playfair: 'var(--font-playfair), var(--font-inter), Georgia, serif',
    roboto: 'var(--font-roboto), var(--font-inter), system-ui, sans-serif',
    oswald: 'var(--font-oswald), var(--font-inter), system-ui, sans-serif',
    lato: 'var(--font-lato), var(--font-inter), system-ui, sans-serif',
  }
  return fonts[font.toLowerCase()] || fonts.inter
}

/**
 * Maps the business font choice to the DISPLAY (headings) stack.
 * When the owner has picked a brand font, headings use it so the brand voice
 * stays consistent. When unset, headings fall back to an elegant editorial
 * serif (Playfair Display) — the showroom default — while body text stays
 * in the clean Inter sans.
 */
export function mapDisplayFont(fontFamily?: string | null): string {
  if (fontFamily && (FONT_FAMILY_VALUES as readonly string[]).includes(fontFamily.toLowerCase())) {
    return mapFontFamily(fontFamily)
  }
  return "var(--font-playfair), Georgia, 'Times New Roman', serif"
}

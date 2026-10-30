// Theme / CSS injection regression tests.
//
// The public website and dashboard emit generated CSS through
// dangerouslySetInnerHTML (ThemeStyle.tsx, dashboard layout). User-controlled
// branding values must never be able to escape a CSS declaration. These tests
// lock the sanitisation contract of src/lib/theme.ts:
//   • colour values are strict #rrggbb hex, converted numerically to HSL
//   • font selections are allow-listed to curated, self-hosted ids
//   • anything unrecognised falls back to a fixed safe value
//
// Pure functions only — no database required.

import {
  generateThemeCSS,
  hexToHsl,
  isValidHexColor,
  mapDisplayFont,
  mapFontFamily,
  FONT_FAMILY_VALUES,
} from '../src/lib/theme'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

// Payloads that would break out of a declaration/rule if interpolated raw.
const EVIL_COLORS = [
  '#fff"); } body{display:none} .x{',
  'red',
  '#12345',
  '#1234567',
  '#12345g',
  'expression(alert(1))',
  'url(javascript:alert(1))',
  '</style><script>alert(1)</script>',
]

const EVIL_FONTS = [
  'Inter; } body { display:none',
  'expression(alert(1))',
  '</style><script>alert(1)</script>',
  'not-a-real-font',
  'Arial',
]

console.log('Theme sanitisation tests')

// ── hex validation ────────────────────────────────────────────────────────
for (const evil of EVIL_COLORS) {
  assert(!isValidHexColor(evil), `rejects unsafe colour value: ${evil.slice(0, 32)}`)
}
assert(isValidHexColor('#d4af37'), 'accepts a valid #rrggbb colour')
assert(isValidHexColor('#D4AF37'), 'accepts upper-case hex')

// ── hexToHsl is numeric only ──────────────────────────────────────────────
assert(/^\d{1,3} \d{1,3}% \d{1,3}%$/.test(hexToHsl('#d4af37')), 'hexToHsl emits plain numeric HSL components')

// ── generated CSS cannot be escaped by a colour ───────────────────────────
for (const evil of EVIL_COLORS) {
  const css = generateThemeCSS({
    primaryColor: evil,
    secondaryColor: evil,
    accentColor: evil,
    themeMode: 'dark',
  } as never)
  assert(!css.includes('display:none') && !css.includes('<script') && !css.includes('expression('),
    `build CSS is not escaped by colour: ${evil.slice(0, 28)}`)
  assert(css.includes('.brand-theme {'), 'build CSS still renders the brand theme block')
  // Braces balance: an injected "}" would break this.
  const opens = (css.match(/{/g) || []).length
  const closes = (css.match(/}/g) || []).length
  assert(opens === closes, `brace count stays balanced for colour: ${evil.slice(0, 24)}`)
}

// ── generated CSS cannot be escaped by a font selection ───────────────────
for (const evil of EVIL_FONTS) {
  const css = generateThemeCSS({
    primaryColor: '#121212',
    secondaryColor: '#2a2a2a',
    accentColor: '#d4af37',
    themeMode: 'dark',
    fontFamily: evil,
  } as never)
  assert(!css.includes('display:none') && !css.includes('<script') && !css.includes('expression('),
    `build CSS is not escaped by font: ${evil.slice(0, 28)}`)
  assert(css.includes("'Inter'"), 'unknown font falls back to the Inter stack')
}

// ── scoped (preview) output is sanitised identically ──────────────────────
const scoped = generateThemeCSS(
  { primaryColor: EVIL_COLORS[0], secondaryColor: '#2a2a2a', accentColor: EVIL_COLORS[0], themeMode: 'dark' } as never,
  '.brand-preview',
)
assert(scoped.includes('.brand-preview {'), 'scoped preview CSS keeps its scope selector')
assert(!scoped.includes('display:none'), 'scoped preview CSS is not escaped')

// ── font allow-list ───────────────────────────────────────────────────────
for (const evil of EVIL_FONTS) {
  assert(!(FONT_FAMILY_VALUES as readonly string[]).includes(evil.toLowerCase()),
    `font allow-list rejects: ${evil.slice(0, 28)}`)
  assert(!mapFontFamily(evil).includes('display:none'), 'mapFontFamily never echoes input')
  assert(!mapDisplayFont(evil).includes('display:none'), 'mapDisplayFont never echoes input')
}
// Font stacks are the real self-hosted CSS variables, not the display name.
assert(mapFontFamily('poppins').includes('var(--font-poppins)'), 'known font still maps to its real stack')
assert(mapDisplayFont('playfair').includes('var(--font-playfair)'), 'display font still maps to its real stack')

console.log(`\nTheme sanitisation tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

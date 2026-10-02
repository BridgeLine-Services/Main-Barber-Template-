/**
 * Visual Configuration Tests
 *
 * Covers the tenant visual configuration system at the logic layer:
 *   - resolver precedence: explicit override → preset mapping → default
 *   - invalid/unknown values always resolve safely (never throw)
 *   - published snapshot + legacy key handling (visualConfigFromContent)
 *   - save-side validation (validateVisualConfigInput normalizes + drops junk)
 *   - every layout option resolves end-to-end from its stored value
 *
 * Pure logic tests — no database required.
 * Run: npx tsx tests/visual-config.test.ts
 */

import {
  resolveVisualConfig,
  visualConfigFromContent,
  validateVisualConfigInput,
  HERO_LAYOUTS,
  SERVICE_LAYOUTS,
  BUTTON_STYLES,
  IMAGE_SHAPES,
  HEADING_SCALES,
  BARBER_LAYOUTS,
  GALLERY_LAYOUTS,
  MOTION_LEVELS,
  MOBILE_NAV_MODES,
  REVIEW_PRESENTATIONS,
  VISUAL_OVERRIDE_KEYS,
  type VisualConfig,
} from '../src/lib/visual-config'

let passed = 0
let failed = 0

function check(name: string, condition: boolean) {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

function expectEqual(a: unknown, b: unknown, name: string) {
  check(name, a === b)
}

console.log('\n🎨 Visual Configuration Tests\n')

// ── Defaults ────────────────────────────────────────────────────────────────
console.log('Default resolution (no preset, no overrides)')

const defaults = resolveVisualConfig(undefined, undefined)
expectEqual(defaults.preset, 'modern-classic', 'falls back to modern-classic preset')
expectEqual(defaults.motionLevel, 'subtle', 'modern-classic maps to subtle motion')
check('all fields present and valid', HERO_LAYOUTS.includes(defaults.heroLayout as never))
expectEqual(defaults.galleryLayout, 'grid', 'gallery defaults to grid')
expectEqual(defaults.mobileNavMode, 'appointment', 'mobile nav defaults to appointment')
expectEqual(defaults.reviewPresentation, 'editorial', 'reviews default to editorial')

// ── Preset mapping ───────────────────────────────────────────────────────────
console.log('\nPreset built-in mappings')

const street = resolveVisualConfig('street-cut', undefined)
expectEqual(street.heroLayout, 'poster', 'street-cut maps hero → poster')
expectEqual(street.serviceLayout, 'cards', 'street-cut maps services → cards')
expectEqual(street.barberLayout, 'large-profile', 'street-cut maps team → large-profile')
expectEqual(street.motionLevel, 'expressive', 'street-cut maps motion → expressive')

const heritage = resolveVisualConfig('barber-heritage', undefined)
expectEqual(heritage.serviceLayout, 'visual-menu', 'barber-heritage maps services → visual-menu')
expectEqual(heritage.barberLayout, 'portrait-grid', 'barber-heritage maps team → portrait-grid')

// ── Override precedence ───────────────────────────────────────────────────────
console.log('\nOverride precedence (override → preset → default)')

const mixed = resolveVisualConfig('street-cut', { heroLayout: 'split' })
expectEqual(mixed.heroLayout, 'split', 'explicit hero override wins over preset')
expectEqual(mixed.serviceLayout, 'cards', 'unset fields keep the preset mapping')

// ── Invalid values are silently safe ─────────────────────────────────────────
console.log('\nInvalid values resolve safely')

const junk = resolveVisualConfig('not-a-preset', {
  heroLayout: 'hologram',
  motionLevel: 42,
  galleryLayout: ['beep'],
})
expectEqual(junk.preset, 'modern-classic', 'unknown preset falls back to modern-classic')
expectEqual(junk.heroLayout, 'split', 'invalid hero layout falls back to preset mapping')
expectEqual(junk.motionLevel, 'subtle', 'non-string motion level falls back')
expectEqual(junk.galleryLayout, 'grid', 'array gallery layout falls back to grid')

const nullContent = resolveVisualConfig(null, null)
expectEqual(nullContent.preset, 'modern-classic', 'null preset is safe')

// ── visualConfigFromContent (public page entry point) ─────────────────────────
console.log('\nvisualConfigFromContent (public pages)')

const fromSnapshot = visualConfigFromContent({
  visualPreset: 'black-label',
  visualConfig: { barberLayout: 'portrait-grid' },
})
expectEqual(fromSnapshot.preset, 'black-label', 'resolves preset from merged content')
expectEqual(fromSnapshot.barberLayout, 'portrait-grid', 'resolves overrides from merged content')

const legacy = visualConfigFromContent({ visualStyle: 'street-cut' })
expectEqual(legacy.preset, 'street-cut', 'legacy visualStyle key is honored')

expectEqual(visualConfigFromContent(null).preset, 'modern-classic', 'null content is safe')
expectEqual(visualConfigFromContent({}).preset, 'modern-classic', 'empty content is safe')

// The resolver the pages call must produce every valid override correctly:
// round-trip every allowed value through resolveVisualConfig.
console.log('\nEvery option value round-trips')

const roundTrips: Array<[keyof typeof optionSets, readonly string[]]> = [
  ['heroLayout', HERO_LAYOUTS],
  ['serviceLayout', SERVICE_LAYOUTS],
  ['barberLayout', BARBER_LAYOUTS],
  ['galleryLayout', GALLERY_LAYOUTS],
  ['buttonStyle', BUTTON_STYLES],
  ['imageShape', IMAGE_SHAPES],
  ['headingScale', HEADING_SCALES],
  ['motionLevel', MOTION_LEVELS],
  ['mobileNavMode', MOBILE_NAV_MODES],
  ['reviewPresentation', REVIEW_PRESENTATIONS],
] as const

const optionSets = {
  heroLayout: HERO_LAYOUTS,
  serviceLayout: SERVICE_LAYOUTS,
  barberLayout: BARBER_LAYOUTS,
  galleryLayout: GALLERY_LAYOUTS,
  buttonStyle: BUTTON_STYLES,
  imageShape: IMAGE_SHAPES,
  headingScale: HEADING_SCALES,
  motionLevel: MOTION_LEVELS,
  mobileNavMode: MOBILE_NAV_MODES,
  reviewPresentation: REVIEW_PRESENTATIONS,
}

for (const [field, values] of roundTrips) {
  for (const value of values) {
    const resolved = resolveVisualConfig(undefined, { [field]: value }) as VisualConfig
    expectEqual(resolved[field], value, `${field}="${value}" round-trips`)
  }
}

// ── Save-side validation ──────────────────────────────────────────────────────
console.log('\nvalidateVisualConfigInput (owner save path)')

const saved = validateVisualConfigInput({
  visualPreset: 'black-label',
  visualConfig: {
    heroLayout: 'split',
    serviceLayout: 'editorial',
    junkField: 'ignored',
    motionLevel: 'ludicrous',
  },
})
expectEqual(saved.visualPreset, 'black-label', 'valid preset passes through')
expectEqual(saved.visualConfig.heroLayout, 'split', 'valid override is kept')
expectEqual(saved.visualConfig.motionLevel, undefined, 'invalid motion level is dropped')
check(
  'unknown keys are not copied into the stored config',
  !('junkField' in (saved.visualConfig as Record<string, unknown>))
)

const savedNone = validateVisualConfigInput({ visualPreset: 'nope', visualConfig: 'not-an-object' })
expectEqual(savedNone.visualPreset, null, 'invalid preset becomes null (unchanged)')
expectEqual(Object.keys(savedNone.visualConfig).length, 0, 'non-object config normalizes to empty')

// Every override key the UI offers is accepted by validation
const allFields = validateVisualConfigInput({
  visualConfig: Object.fromEntries(
    VISUAL_OVERRIDE_KEYS.map((k) => [k, optionSets[k][0]])
  ),
})
check(
  'all UI override keys validate',
  VISUAL_OVERRIDE_KEYS.every(
    (k) => (allFields.visualConfig as Record<string, unknown>)[k] === optionSets[k][0]
  )
)

// ── Results ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`)
if (failed === 0) {
  console.log(`✅ All ${passed} visual-config tests passed\n`)
  process.exit(0)
} else {
  console.log(`❌ ${failed} of ${passed + failed} visual-config tests failed\n`)
  process.exit(1)
}

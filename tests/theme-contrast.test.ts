/**
 * Brand colour contrast (Section 17).
 *
 * Pinned against the WCAG reference values: black on white is 21:1, a colour against itself
 * is 1:1, and an unreadable colour is reported as unchecked rather than passed.
 */
import assert from 'node:assert/strict'
import {
  auditBrandContrast,
  contrastRatio,
  parseHexColor,
  relativeLuminance,
  summariseContrast,
} from '../src/lib/theme-contrast'

let p = 0
let f = 0
const ok = (name: string, condition: boolean) => {
  if (condition) p += 1
  else { f += 1; console.log('  FAIL', name) }
}
const near = (value: number, expected: number, tolerance = 0.05) => Math.abs(value - expected) <= tolerance

// --- reading colours ---
ok('six digit hex is read', parseHexColor('#1a1a1a')?.r === 26)
ok('three digit hex is expanded', parseHexColor('#fff')?.r === 255 && parseHexColor('#fff')?.b === 255)
ok('a named colour is not a hex value', parseHexColor('gold') === null)
ok('a missing value is not a colour', parseHexColor(null) === null)
ok('a short hex is refused', parseHexColor('#12') === null)

// --- the reference ratios ---
const white = parseHexColor('#ffffff')!
const black = parseHexColor('#000000')!
ok('black on white is 21 to 1', near(contrastRatio(black, white), 21))
ok('a colour against itself is 1 to 1', near(contrastRatio(black, black), 1))
ok('white luminance is 1', near(relativeLuminance(white), 1))
ok('black luminance is 0', near(relativeLuminance(black), 0))
ok('the ratio is symmetric', near(contrastRatio(black, white), contrastRatio(white, black)))

// --- the pairings a shop actually sets ---
const defaults = auditBrandContrast({ primaryColor: '#1a1a1a', accentColor: '#d4af37', secondaryColor: '#2a2a2a' })
ok('three pairings are checked', defaults.length === 3)
// The default theme is not a free pass: white text on the gold accent is a real failure,
// which is the case the brief warns about.
const primary = defaults.find((entry) => entry.pair === 'White text on the primary colour')!
ok('white on the default primary surface reads', primary.passes)
const onGold = defaults.find((entry) => entry.pair === 'White text on the accent colour')!
ok('white on the default gold accent does not read', !onGold.passes && onGold.ratio !== null && onGold.ratio < 4.5)
const pale = auditBrandContrast({ primaryColor: '#f5f0e6', accentColor: '#f0e0b0' })
ok('pale colours on pale colours fail', pale.some((entry) => !entry.passes))
const unreadable = pale.find((entry) => !entry.passes)!
ok('a failing pairing says the ratio', /:\s?1/.test(unreadable.advice))
ok('a failing pairing explains the minimum', /4\.5:1 minimum/.test(unreadable.advice))
const invalid = auditBrandContrast({ primaryColor: 'not-a-colour' })
ok('an unreadable colour is not a pass', invalid.length === 1 && invalid[0].passes === false)
ok('an unreadable colour has no ratio', invalid[0].ratio === null)
ok('an unreadable colour says why', /cannot be checked/.test(invalid[0].advice))
ok('no colours means no findings', auditBrandContrast({}).length === 0)

// --- the sentence an owner reads ---
ok('no colours is stated plainly', /default theme/.test(summariseContrast([])))
ok('a clean set is stated plainly', /meets the 4\.5:1/.test(summariseContrast([primary])))
ok('the default theme is reported honestly, not excused', /below the 4\.5:1/.test(summariseContrast(defaults)))
const summary = summariseContrast(pale)
ok('failures are counted', /^\d of \d brand pairings/.test(summary))
ok('failures are named', /primary colour|accent colour/i.test(summary))

assert.ok(p > 0)
console.log(`\nBrand colour contrast: ${p} passed, ${f} failed`)
if (f > 0) process.exit(1)

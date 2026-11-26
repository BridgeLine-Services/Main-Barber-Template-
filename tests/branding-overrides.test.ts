/**
 * Brand inheritance and location overrides (Section 7 of the platform brief).
 *
 * The distinction these tests exist for: no saved override inherits the shared brand, while a
 * saved empty value means the location deliberately shows nothing. Collapsing the two is how a
 * cleared logo silently reappears.
 */
import {
  describeBrandBoundary,
  isValidBrandValue,
  requestLocationOverride,
  resolveBrand,
  resolveBrandField,
  type BrandSettingsRecord,
} from '../src/lib/organization/branding'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; return }
  failed++
  console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`)
}

const settings = {
  organizationId: 'org-1',
  logoUrl: 'https://cdn.example/shared-logo.png',
  primaryColor: '#101010',
  accentColor: '#c0a060',
  brandGuidelinesUrl: 'https://cdn.example/guidelines.pdf',
  allowedOverrides: ['logoUrl', 'accentColor'],
} as unknown as BrandSettingsRecord

// --- inheritance -----------------------------------------------------------
const inherited = resolveBrandField(settings, null, 'primaryColor')
ok('no overrides means the shared value', inherited.source === 'organization')
ok('the shared value is returned', inherited.value === '#101010')

const absent = resolveBrandField(settings, { accentColor: undefined } as never, 'accentColor')
ok('an undefined field inherits', absent.source === 'organization')

// --- allowed override ------------------------------------------------------
const own = resolveBrandField(settings, { accentColor: '#ff0000' }, 'accentColor')
ok('an allowed override wins', own.source === 'location')
ok('the override value is returned', own.value === '#ff0000')

// --- explicit clear --------------------------------------------------------
const cleared = resolveBrandField(settings, { logoUrl: '' }, 'logoUrl')
ok('an empty saved value is a clear, not an inherit', cleared.source === 'cleared')
ok('a cleared field has no value', cleared.value === null)

const clearedWhitespace = resolveBrandField(settings, { logoUrl: '   ' }, 'logoUrl')
ok('whitespace counts as a clear', clearedWhitespace.source === 'cleared')

const clearedAgainstUnsetCorporate = resolveBrandField(
  { ...settings, logoUrl: null } as unknown as BrandSettingsRecord,
  { logoUrl: '' },
  'logoUrl',
)
ok('clearing is not mistaken for never set', clearedAgainstUnsetCorporate.source === 'cleared')

// --- not allowed -----------------------------------------------------------
const notAllowed = resolveBrandField(settings, { primaryColor: '#ff0000' }, 'primaryColor')
ok('an override corporate did not allow is ignored', notAllowed.source === 'organization')
ok('the shared value is used instead', notAllowed.value === '#101010')

const notAllowedClear = resolveBrandField(settings, { primaryColor: '' }, 'primaryColor')
ok('a location cannot clear a field it may not change', notAllowedClear.source === 'organization')

// --- nothing anywhere ------------------------------------------------------
ok('no settings and no override is unset', resolveBrandField(null, null, 'logoUrl').source === 'unset')
ok('no settings still honours an allowed override', resolveBrandField(null, { logoUrl: 'https://cdn.example/x.png' }, 'logoUrl').source === 'unset')

// --- whole brand -----------------------------------------------------------
const all = resolveBrand(settings, { accentColor: '#00ff00', logoUrl: '' })
ok('every field resolves', all.length === 4)
ok('the accent override is a location value', all.find((f) => f.field === 'accentColor')?.source === 'location')
ok('the cleared logo stays cleared', all.find((f) => f.field === 'logoUrl')?.source === 'cleared')
ok('the untouched field inherits', all.find((f) => f.field === 'brandGuidelinesUrl')?.source === 'organization')

// --- two locations do not share an override --------------------------------
const locationA = resolveBrandField(settings, { accentColor: '#111111' }, 'accentColor')
const locationB = resolveBrandField(settings, { accentColor: '#222222' }, 'accentColor')
ok('two locations keep their own values', locationA.value === '#111111' && locationB.value === '#222222')

// --- the request path ------------------------------------------------------
ok('a location may request an allowed change', requestLocationOverride(settings, 'logoUrl', 'https://cdn.example/own.png').accepted)
ok('a location may not request a disallowed field', !requestLocationOverride(settings, 'primaryColor', '#ff0000').accepted)
ok('an empty value is not accepted as a change', !requestLocationOverride(settings, 'logoUrl', '').accepted)
ok('a javascript URL is refused', !requestLocationOverride(settings, 'logoUrl', 'javascript:alert(1)').accepted)
ok('a data URL is refused', !requestLocationOverride(settings, 'logoUrl', 'data:text/html,<script>').accepted)
ok('a bare word is refused as a colour', !requestLocationOverride(settings, 'accentColor', 'red').accepted)
ok('a hex colour is accepted', isValidBrandValue('accentColor', '#a1b2c3'))
ok('a three digit hex is accepted as CSS allows', isValidBrandValue('accentColor', '#abc'))
ok('a word that is not a colour is refused', !isValidBrandValue('accentColor', 'gold'))

// --- wording ---------------------------------------------------------------
ok('the boundary is explained when nothing is allowed', /No location may change it/.test(describeBrandBoundary({ ...settings, allowedOverrides: [] } as unknown as BrandSettingsRecord)))
ok('the boundary names what is allowed', /logoUrl/.test(describeBrandBoundary(settings)))

// --- the defect this fixed stays fixed -------------------------------------
const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src/lib/organization/branding.ts'), 'utf8')
ok('the resolver does not decide on truthiness alone', !/if \(override &&/.test(source))
ok('the resolver checks whether the field is present', /hasOwnProperty/.test(source))

console.log(`\nBrand inheritance and overrides: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

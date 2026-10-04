/**
 * Homepage Module System Tests
 *
 * Covers the unified homepage module system at the logic layer:
 *   - legacy derivation: no saved homeModules → config derived from the
 *     legacy show* toggles so existing sites render exactly as before
 *   - explicit configuration: stored order + enabled flags are honored
 *   - hero is structural: always enabled, always first
 *   - missing modules are appended in default order (off unless legacy)
 *   - save-side validation (validateHomeModulesInput): unknown ids and
 *     duplicates dropped, bounds enforced, unsafe profile URLs rejected
 *
 * Pure logic tests — no database required.
 * Run: npx tsx tests/home-modules.test.ts
 */

import {
  resolveHomeModules,
  validateHomeModulesInput,
  HOME_MODULE_IDS,
  ALWAYS_ON_MODULES,
  type HomeModule,
} from '../src/lib/home-modules'

let passed = 0
let failed = 0

function check(label: string, condition: boolean) {
  if (condition) {
    passed++
    console.log(`  ✅ ${label}`)
  } else {
    failed++
    console.error(`  ❌ ${label}`)
  }
}

function expectEqual<T>(actual: T, expected: T, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  check(`${label}${ok ? '' : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`, ok)
}

console.log('\nLegacy derivation (never saved homeModules)')

const legacy = resolveHomeModules({
  showServices: true,
  showTeam: false,
  showReviews: true,
  showVisit: true,
  showFinalCta: true,
})
check('flags itself as derived from legacy defaults', legacy.fromLegacyDefaults)
expectEqual(legacy.modules.length, HOME_MODULE_IDS.length, 'all modules present')
expectEqual(legacy.modules[0].id, 'hero', 'hero is first')
check('hero always enabled', legacy.modules[0].enabled)
check('services follows showServices=true', legacy.modules.find((m) => m.id === 'services')?.enabled === true)
check('team follows showTeam=false', legacy.modules.find((m) => m.id === 'team')?.enabled === false)
check('reviews follows showReviews=true', legacy.modules.find((m) => m.id === 'reviews')?.enabled === true)
check('beforeAfter defaults off', legacy.modules.find((m) => m.id === 'beforeAfter')?.enabled === false)
check('socialGallery defaults off', legacy.modules.find((m) => m.id === 'socialGallery')?.enabled === false)
check('featuredWork defaults off', legacy.modules.find((m) => m.id === 'featuredWork')?.enabled === false)
check('shopExperience defaults off', legacy.modules.find((m) => m.id === 'shopExperience')?.enabled === false)
check('visit follows showVisit=true', legacy.modules.find((m) => m.id === 'visit')?.enabled === true)
check('finalCta follows showFinalCta=true', legacy.modules.find((m) => m.id === 'finalCta')?.enabled === true)
check('quickBook ships on for derived sites', legacy.modules.find((m) => m.id === 'quickBook')?.enabled === true)
check('faq ships on for derived sites', legacy.modules.find((m) => m.id === 'faq')?.enabled === true)
expectEqual(legacy.modules[1].id, 'quickBook', 'quickBook defaults to slot 2 (after hero)')

const legacyOff = resolveHomeModules({
  showServices: false,
  showTeam: false,
  showReviews: false,
  showVisit: false,
  showFinalCta: false,
})
const SHIP_ON = ['quickBook', 'faq'] as const
check('all legacy toggles off → every legacy module off', legacyOff.modules.every((m) => !m.enabled || ALWAYS_ON_MODULES.includes(m.id) || (SHIP_ON as readonly string[]).includes(m.id)))
check('hero stays on even with everything off', legacyOff.modules[0].id === 'hero' && legacyOff.modules[0].enabled)

const legacyUndef = resolveHomeModules({})
check('undefined toggles default ON (pre-launch parity)', legacyUndef.modules.find((m) => m.id === 'services')?.enabled === true)

console.log('\nExplicit stored configuration')

const explicit = resolveHomeModules({
  homeModules: {
    modules: [
      { id: 'hero', enabled: false, settings: {} }, // hero cannot be disabled
      { id: 'reviews', enabled: true, settings: {} },
      { id: 'services', enabled: false, settings: {} },
      { id: 'finalCta', enabled: true, settings: {} },
    ],
  },
  showServices: true, // legacy ignored for explicitly-stored modules
})
check('explicit config is not legacy-derived', !explicit.fromLegacyDefaults)
check('hero forced enabled even when stored disabled', explicit.modules[0].id === 'hero' && explicit.modules[0].enabled)
expectEqual(explicit.modules[1].id, 'reviews', 'stored order honored (reviews second)')
check('stored services=false wins over legacy toggle true', explicit.modules.find((m) => m.id === 'services')?.enabled === false)
check('missing modules appended (team present)', explicit.modules.find((m) => m.id === 'team') !== undefined)
check('appended legacy modules follow toggles (team on)', explicit.modules.find((m) => m.id === 'team')?.enabled === true)
check('appended new modules stay off (beforeAfter)', explicit.modules.find((m) => m.id === 'beforeAfter')?.enabled === false)
check('appended homepage-upgrade modules stay off (quickBook)', explicit.modules.find((m) => m.id === 'quickBook')?.enabled === false)
check('appended homepage-upgrade modules stay off (faq)', explicit.modules.find((m) => m.id === 'faq')?.enabled === false)
expectEqual(explicit.modules.length, HOME_MODULE_IDS.length, 'no duplicates after append')

const reordered = resolveHomeModules({
  homeModules: {
    modules: [
      { id: 'hero', enabled: true, settings: {} },
      { id: 'visit', enabled: true, settings: {} },
      { id: 'team', enabled: true, settings: {} },
      { id: 'services', enabled: true, settings: {} },
    ],
  },
})
expectEqual(
  reordered.modules.slice(0, 4).map((m) => m.id),
  ['hero', 'visit', 'team', 'services'],
  'arbitrary owner order round-trips'
)

console.log('\nSave-side validation (validateHomeModulesInput)')

const bad = validateHomeModulesInput('not-an-object')
expectEqual(bad.homeModules, null, 'non-object input → null')
const noList = validateHomeModulesInput({ modules: 'nope' })
expectEqual(noList.homeModules, null, 'non-array modules → null')
const empty = validateHomeModulesInput({ modules: [] })
expectEqual(empty.homeModules, null, 'empty module list → null (keeps legacy derivation)')

const junk = validateHomeModulesInput({
  modules: [
    { id: 'not-a-module', enabled: true, settings: {} },
    { id: 'services', enabled: true, settings: {} },
    { id: 'services', enabled: false, settings: {} }, // duplicate dropped
    null,
    'services',
  ],
})
const junkModules = (junk.homeModules as { modules: HomeModule[] }).modules
expectEqual(junkModules.length, 1, 'unknown/duplicate/junk entries dropped')
expectEqual(junkModules[0].id, 'services', 'valid entry kept (first wins)')

const bounded = validateHomeModulesInput({
  modules: [
    {
      id: 'featuredWork',
      enabled: true,
      settings: { count: 0, heading: 'x'.repeat(200), blurb: 'y'.repeat(500) },
    },
    { id: 'beforeAfter', enabled: true, settings: { count: 999 } },
  ],
})
const bm = (bounded.homeModules as { modules: HomeModule[] }).modules
check('count 0 clamps to the minimum (1)', bm[0].settings.count === 1)
check('count above max is clamped', bm[1].settings.count === 6)
check('heading trimmed to 80 chars', bm[0].settings.heading.length === 80)
check('blurb trimmed to 400 chars', bm[0].settings.blurb.length === 400)

const social = validateHomeModulesInput({
  modules: [
    {
      id: 'socialGallery',
      enabled: true,
      settings: {
        social: {
          handle: '  @myshop  ',
          profileUrl: 'https://instagram.com/myshop',
          followEnabled: true,
          count: 8,
        },
      },
    },
    {
      id: 'socialGallery2', // unknown id — ignored; safe-url case still covered above
      enabled: true,
      settings: {},
    },
  ],
})
const sm = (social.homeModules as { modules: HomeModule[] }).modules[0].settings.social
check('social handle trimmed', sm?.handle === '@myshop')
check('safe https profile URL kept', sm?.profileUrl === 'https://instagram.com/myshop')
check('follow flag kept', sm?.followEnabled === true)
check('social count kept', sm?.count === 8)

const unsafe = validateHomeModulesInput({
  modules: [
    {
      id: 'socialGallery',
      enabled: true,
      settings: {
        social: { handle: 'x', profileUrl: 'javascript:alert(1)', followEnabled: true },
      },
    },
  ],
})
const um = (unsafe.homeModules as { modules: HomeModule[] }).modules[0].settings.social
check('javascript: profile URL is dropped', um?.profileUrl === '')
check('follow still allowed without URL (renders no link)', um?.followEnabled === true)

const explicitRound = validateHomeModulesInput({
  modules: [
    { id: 'hero', enabled: false, settings: {} },
    { id: 'services', enabled: true, settings: { heading: 'Menu' } },
  ],
})
// Round-trip the validated save through the resolver: hero still forced on.
const saved = resolveHomeModules({ homeModules: explicitRound.homeModules })
check('saved hero remains enabled after resolve', saved.modules[0].id === 'hero' && saved.modules[0].enabled)
check('saved settings survive round-trip', saved.modules.find((m) => m.id === 'services')?.settings.heading === 'Menu')

console.log('\nResilience')

check('null content resolves', resolveHomeModules(null).modules.length === HOME_MODULE_IDS.length)
check('weird content resolves', resolveHomeModules('junk').modules.length === HOME_MODULE_IDS.length)
check(
  'garbage stored list resolves with defaults',
  resolveHomeModules({ homeModules: { modules: [42, { nope: true }] } }).modules.length === HOME_MODULE_IDS.length
)

// ── Results ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`)
if (failed === 0) {
  console.log(`✅ All ${passed} home-modules tests passed\n`)
  process.exit(0)
} else {
  console.log(`❌ ${failed} of ${passed + failed} home-modules tests failed\n`)
  process.exit(1)
}

/**
 * The eight visual identities and the brand assistant.
 *
 * Pins the guarantees the owner-facing branding work depends on:
 *   - the identity list is exactly the eight documented ids, in order
 *   - the guide covers every identity and never invents one
 *   - layout summaries and fingerprints come from the real preset config, so
 *     the guide cannot drift from visual-style.ts
 *   - the assistant only ever recommends an existing identity, is deterministic,
 *     and falls back to modern-classic when it has nothing to go on
 *   - suggestions never save, publish or mutate anything
 *
 * Pure logic. No database.
 * Run: npx tsx tests/brand-assistant.test.ts
 */

import {
  BRAND_QUESTIONS,
  isBrandQuizComplete,
  nextBrandQuestion,
  recommendStyle,
} from '../src/lib/brand-assistant'
import { describeStyle, layoutDifferences, styleGuideList } from '../src/lib/visual-style-guide'
import { VISUAL_STYLE_CONFIG, VISUAL_STYLES } from '../src/lib/visual-style'

let passed = 0
let failed = 0

function ok(name: string, condition: boolean, said?: string) {
  if (condition) {
    passed += 1
    console.log(`  PASS ${name}${said ? ` (said: ${said})` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL ${name}${said ? ` (said: ${said})` : ''}`)
  }
}

function eq(name: string, actual: unknown, expected: unknown) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

const EXPECTED_IDS = [
  'black-label',
  'barber-heritage',
  'street-cut',
  'clean-club',
  'modern-classic',
  'warm-premium',
  'high-energy-urban',
  'single-chair',
]

console.log('--- the eight identities are unchanged ---')
eq('visual styles are exactly the documented eight, in order', [...VISUAL_STYLES], EXPECTED_IDS)
eq('guide covers all eight in the same order', styleGuideList().map((s) => s.style), EXPECTED_IDS)
ok('guide length matches the style list', styleGuideList().length === VISUAL_STYLES.length)

console.log('--- the guide is derived, not duplicated ---')
for (const style of VISUAL_STYLES) {
  const guide = describeStyle(style)
  const config = VISUAL_STYLE_CONFIG[style]
  ok(`${style}: label comes from the real preset`, guide.label === config.label, guide.label)
  ok(`${style}: fingerprint reflects the real layout choices`, guide.fingerprint === [
    config.hero, config.services, config.team, config.gallery, config.reviews,
    config.imageShape, config.button, config.motion,
  ].join('|'))
  ok(`${style}: has a personality sentence`, guide.personality.length > 30)
  ok(`${style}: says who it suits`, guide.bestFor.length > 20)
  ok(`${style}: layout summary describes the service presentation`, guide.layoutSummary.includes('service'))
  ok(`${style}: pace is one of the three allowed values`, ['calm', 'balanced', 'energetic'].includes(guide.pace))
}

console.log('--- unknown values resolve like the rest of the app ---')
ok('an unknown identity resolves to modern-classic', describeStyle('no-such-style').style === 'modern-classic')
ok('an undefined identity resolves to modern-classic', describeStyle(undefined).style === 'modern-classic')
ok('a number resolves without throwing', describeStyle(42).style === 'modern-classic')

console.log('--- comparing two identities ---')
const diff = layoutDifferences('street-cut', 'clean-club')
ok('a difference list names the sections that actually differ', diff.includes('opening section') && diff.includes('reviews'), diff.join(', '))
ok('an identical service layout is not reported as a difference', !diff.includes('service layout'), diff.join(', '))
eq('comparing an identity with itself reports no differences', layoutDifferences('warm-premium', 'warm-premium'), [])
ok('an identity with itself is not reported as different', layoutDifferences('street-cut', 'street-cut').length === 0)

console.log('--- the assistant only recommends existing identities ---')
const cases: Array<[string, Record<string, string>]> = [
  ['premium executives solo', { personality: 'premium', clientele: 'executives', team: 'solo', pace: 'calm', presentation: 'people' }],
  ['bold young energetic', { personality: 'bold', clientele: 'young', team: 'small_team', pace: 'energetic', presentation: 'photos' }],
  ['calm families large team', { personality: 'calm', clientele: 'families', team: 'large_team', pace: 'calm', presentation: 'menu' }],
  ['friendly regulars photos', { personality: 'friendly', clientele: 'regulars', team: 'small_team', pace: 'balanced', presentation: 'photos' }],
]
for (const [name, answers] of cases) {
  const r = recommendStyle(answers)
  ok(`${name}: recommendation is an existing identity`, (VISUAL_STYLES as readonly string[]).includes(r.style), r.style)
  ok(`${name}: not flagged as a default fallback`, r.isDefault === false)
  ok(`${name}: carries at least one plain-language reason`, r.reasons.length >= 1 && r.reasons[0].length > 20)
  ok(`${name}: never offers itself as an alternative`, !r.alternatives.includes(r.style))
  ok(`${name}: at most two alternatives, all existing`, r.alternatives.length <= 2 && r.alternatives.every((s) => (VISUAL_STYLES as readonly string[]).includes(s)))
}

console.log('--- determinism and control stay with the owner ---')
const a = recommendStyle({ personality: 'bold', clientele: 'young', team: 'small_team', pace: 'energetic', presentation: 'photos' })
const b = recommendStyle({ personality: 'bold', clientele: 'young', team: 'small_team', pace: 'energetic', presentation: 'photos' })
eq('the same answers always give the same recommendation', a, b)
eq('an empty answer set falls back to modern-classic', recommendStyle({}).style, 'modern-classic')
ok('an empty answer set is labelled as a fallback', recommendStyle({}).isDefault === true)
eq('a nonsense answer set falls back to modern-classic', recommendStyle({ personality: 'zzz', clientele: 'qqq', team: 'xyz', pace: '???', presentation: '###' }).style, 'modern-classic')
ok('a fallback still explains itself in plain language', recommendStyle({}).reasons[0].includes('starting point'))
ok('answers are not mutated by the call', (() => {
  const input = { personality: 'bold', clientele: 'young' }
  recommendStyle(input)
  return JSON.stringify(input) === JSON.stringify({ personality: 'bold', clientele: 'young' })
})())
ok('the assistant exposes no side effects: no database import needed', !recommendStyle.toString().includes('prisma'))

console.log('--- the wizard asks one question at a time ---')
eq('the first question is personality', nextBrandQuestion({}), 'personality')
eq('an answered question is skipped', nextBrandQuestion({ personality: 'bold' }), 'clientele')
eq('all answered means nothing left to ask', nextBrandQuestion({ personality: 'bold', clientele: 'young', team: 'solo', pace: 'calm', presentation: 'photos' }), null)
ok('blank strings do not count as answers', nextBrandQuestion({ personality: '   ' }) === 'personality')
ok('completeness is false until every question is answered', isBrandQuizComplete({ personality: 'bold' }) === false)
ok('completeness is true once all are answered', isBrandQuizComplete({ personality: 'bold', clientele: 'young', team: 'solo', pace: 'calm', presentation: 'photos' }) === true)
eq('there are exactly five questions', BRAND_QUESTIONS.length, 5)

console.log(`\nBrand and identity tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

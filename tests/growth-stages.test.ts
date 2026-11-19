/**
 * Part 4.1 and 4.2: the five stages, the declared direction, and honest capability claims.
 *
 * Two kinds of assertion here. The first is behavioural: which stage is shown, and what
 * the owner is told. The second is structural, and matters just as much: every "Open"
 * link on the page must point at a page that exists, and no capability may be called
 * available without one. A green stage model with dead buttons is worse than no model.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUSINESS_STAGES,
  BUSINESS_STAGE_IDS,
  INTENT_OPTIONS,
  availableCapabilities,
  intentForStage,
  isBusinessStage,
  plannedCapabilities,
  resolveStage,
  stageDefinition,
  stageForIntent,
} from '../src/lib/growth/stages'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
    return
  }
  failed++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const ROOT = join(__dirname, '..')
const APP = join(ROOT, 'src', 'app')

// ─── The five stages ────────────────────────────────────────────────────────

ok('five stages exist', BUSINESS_STAGES.length === 5, String(BUSINESS_STAGES.length))
ok(
  'stage ids are the agreed five, in order',
  BUSINESS_STAGE_IDS.join(',') === 'starting,growing,established,multi-location,franchise',
  BUSINESS_STAGE_IDS.join(','),
)
ok('stage numbers run 1 to 5', BUSINESS_STAGES.map((s) => s.number).join(',') === '1,2,3,4,5')
ok('every stage has a plain label', BUSINESS_STAGES.every((s) => s.label.length > 2))
ok('every stage says who it suits', BUSINESS_STAGES.every((s) => s.suits.length > 20))
ok('every stage says what it is for', BUSINESS_STAGES.every((s) => s.focus.length > 20))
ok('every stage has at least three capabilities', BUSINESS_STAGES.every((s) => s.capabilities.length >= 3))
ok(
  'capability ids are unique inside a stage',
  BUSINESS_STAGES.every((s) => new Set(s.capabilities.map((c) => c.id)).size === s.capabilities.length),
)
ok('unknown stage falls back to the first', stageDefinition('nonsense' as never).id === 'starting')

// ─── Honesty about what is built ────────────────────────────────────────────

const plannedStages = BUSINESS_STAGES.filter((s) => plannedCapabilities(s.id).length > 0).map((s) => s.id)
ok('multi-location names what is not built', plannedStages.includes('multi-location'))
ok('franchise names what is not built', plannedStages.includes('franchise'))
ok(
  'multi-location carries a plain caveat',
  Boolean(stageDefinition('multi-location').caveat?.length),
  stageDefinition('multi-location').caveat,
)
ok(
  'franchise carries a plain caveat',
  Boolean(stageDefinition('franchise').caveat?.length),
  stageDefinition('franchise').caveat,
)
ok(
  'a planned capability never offers a link',
  BUSINESS_STAGES.every((s) => s.capabilities.filter((c) => c.availability === 'planned').every((c) => c.href === null)),
)
ok(
  'an available capability always offers a real link',
  BUSINESS_STAGES.every((s) =>
    s.capabilities.filter((c) => c.availability === 'available').every((c) => typeof c.href === 'string' && c.href.startsWith('/')),
  ),
  BUSINESS_STAGES.flatMap((s) => s.capabilities.filter((c) => c.availability === 'available' && !c.href).map((c) => c.id)).join(','),
)
ok(
  'memberships are not claimed as a finished owner screen',
  stageDefinition('established').capabilities.find((c) => c.id === 'memberships')?.availability === 'partial',
)
ok(
  'franchise corporate admin is planned, not available',
  stageDefinition('franchise').capabilities.find((c) => c.id === 'corporate-admin')?.availability === 'planned',
)

// ─── Dead-link protection ───────────────────────────────────────────────────

const settingsPage = readFileSync(join(APP, '(dashboard)', 'dashboard', 'settings', 'page.tsx'), 'utf8')
const validTabsMatch = /const VALID_TABS = \[([\s\S]*?)\] as const/.exec(settingsPage)
const validTabs = validTabsMatch
  ? [...validTabsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  : []
ok('settings tab list was found, so links can be checked', validTabs.length > 5, String(validTabs.length))

function pageExists(href: string): boolean {
  const [path, query] = href.split('?')
  const segments = path.replace(/^\//, '').split('/')
  // Dashboard pages live under the (dashboard) route group; public pages under (customer).
  const candidates = [
    join(APP, '(dashboard)', ...segments, 'page.tsx'),
    join(APP, ...segments, 'page.tsx'),
    join(APP, '(customer)', ...segments, 'page.tsx'),
    join(APP, '(auth)', ...segments, 'page.tsx'),
  ]
  if (!candidates.some((c) => existsSync(c))) return false
  if (query) {
    const tab = new URLSearchParams(query).get('tab')
    if (tab && !validTabs.includes(tab)) return false
  }
  return true
}

const allHrefs = BUSINESS_STAGES.flatMap((s) => s.capabilities.map((c) => c.href)).filter((h): h is string => Boolean(h))
ok('there are links to check', allHrefs.length > 10, String(allHrefs.length))
for (const href of [...new Set(allHrefs)]) {
  ok(`link resolves: ${href}`, pageExists(href))
}

// ─── Declared direction ─────────────────────────────────────────────────────

ok('five directions are offered', INTENT_OPTIONS.length === 5, String(INTENT_OPTIONS.length))
ok(
  'every stage can be declared',
  BUSINESS_STAGES.every((s) => INTENT_OPTIONS.some((o) => o.stage === s.id)),
)
ok(
  'every direction names a stage that exists',
  INTENT_OPTIONS.every((o) => isBusinessStage(o.stage)),
)
ok('intent maps back to its stage', stageForIntent('hiring') === 'growing')
ok('an unknown intent is not a stage', stageForIntent('nonsense') === null)
ok('no intent is null', stageForIntent(null) === null)
ok('a stage has a matching direction', intentForStage('multi-location')?.id === 'another-shop')
ok('isBusinessStage rejects junk', !isBusinessStage('enterprise') && !isBusinessStage(42) && !isBusinessStage(null))

// ─── Resolution: intention never invents evidence, evidence never overrules ──

const declared = resolveStage('starting', 'franchise')
ok('the declared direction is the one shown', declared.effective === 'franchise')
ok('the records still say where the shop is', declared.current === 'starting')
ok('a declared direction ahead of the records is named as such', declared.aheadOfEvidence === true)
ok('the note explains the gap plainly', /heading for/i.test(declared.note), declared.note)
ok('the note never claims the future is built', !/you can now|is ready/i.test(declared.note), declared.note)

const noChoice = resolveStage('growing', null)
ok('with no declared direction, evidence decides', noChoice.effective === 'growing')
ok('with no declared direction, the owner is invited to say', /say so below/i.test(noChoice.note), noChoice.note)

const nothingKnown = resolveStage(null, null)
ok('with nothing known, the first stage is shown', nothingKnown.effective === 'starting')
ok('with nothing known, the owner is told it is unknown', /could not read/i.test(nothingKnown.note), nothingKnown.note)
ok('with nothing known, no stage is claimed as current', nothingKnown.current === null)

const unknownButDeclared = resolveStage(null, 'established')
ok('a declared direction works without evidence', unknownButDeclared.effective === 'established')
ok('the note admits the records could not be read', /could not read/i.test(unknownButDeclared.note), unknownButDeclared.note)

const agreeing = resolveStage('growing', 'growing')
ok('agreement is stated as agreement', /agree/i.test(agreeing.note), agreeing.note)
ok('agreement is not flagged as ahead', agreeing.aheadOfEvidence === false)

const behind = resolveStage('established', 'growing')
ok('a declared direction behind the records is still shown', behind.effective === 'growing')
ok('a declared direction behind the records is not called ahead', behind.aheadOfEvidence === false)
ok('the note does not scold the owner', !/wrong|mistake|fail/i.test(behind.note), behind.note)

// ─── Available capability counts are what the page prints ───────────────────

ok('a starting shop has capabilities ready today', availableCapabilities('starting').length >= 8)
ok(
  'franchise claims nothing as fully available',
  stageDefinition('franchise').capabilities.every((c) => c.availability !== 'available'),
)
ok(
  'franchise offers no corporate screen to open',
  availableCapabilities('franchise').every((c) => c.href === null || c.availability === 'partial'),
)
ok(
  'franchise planned count is honest',
  plannedCapabilities('franchise').length >= 3,
  String(plannedCapabilities('franchise').length),
)

console.log(`\nGrowth stages: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

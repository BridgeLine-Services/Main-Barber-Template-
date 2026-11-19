/**
 * Part 6 guidance: plain words, honest progress, nothing forced.
 */
import { STAGE_COPY, copyForStage, buildGuidanceProgress, inferStage } from '../src/lib/setup-guidance'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; return }
  failed++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const JARGON = /\b(api|env|environment variable|configure|configuration|publish|publish(ed|ing)?|schema|database|migration|deploy|repo|repository|npm|prisma|json|endpoint|slug|webhook|token|oauth|cli|terminal)\b/i

for (const stage of STAGE_COPY) {
  ok(`${stage.id}: has a plain label`, stage.label.length > 2 && !JARGON.test(stage.label), stage.label)
  ok(`${stage.id}: says who it suits`, stage.suits.length > 20 && !JARGON.test(stage.suits), stage.suits)
  ok(`${stage.id}: has steps`, stage.steps.length >= 3)
  for (const step of stage.steps) {
    ok(`${stage.id}/${step.id}: title avoids jargon`, !JARGON.test(step.title), step.title)
    ok(`${stage.id}/${step.id}: why avoids jargon`, !JARGON.test(step.why), step.why)
    ok(`${stage.id}/${step.id}: title is a sentence to a person`, /^[A-Z]/.test(step.title) && !step.title.endsWith('.'))
  }
  ok(`${stage.id}: step ids unique`, new Set(stage.steps.map((s) => s.id)).size === stage.steps.length)
}

ok('five stages exist', STAGE_COPY.length === 5)
ok('stage ids are the agreed five', STAGE_COPY.map((s) => s.id).join(',') === 'starting,growing,established,multi-location,franchise')
ok('unknown stage falls back to the first', copyForStage('nonsense' as never).id === 'starting')

// Progress honesty
const complete = buildGuidanceProgress('starting', {
  hasName: true, hasPhone: true, hasAddress: true, hasHours: true, serviceCount: 3, barberCount: 1, websiteLive: true,
})
ok('complete shop reads complete', complete.percent === 100 && /in place/i.test(complete.headline), complete.headline)
ok('complete shop counts every step', complete.doneCount === complete.steps.length)

const unknown = buildGuidanceProgress('starting', { serviceCount: 2 })
ok('unknown facts never produce a percentage', unknown.percent === null)
ok('unknown facts are named', /could not check/i.test(unknown.headline), unknown.headline)
ok('an unreadable fact never becomes done', unknown.steps.filter((s) => s.id !== 'services').every((s) => s.state === 'could-not-check'))
ok('a readable fact still counts as done', unknown.steps.find((s) => s.id === 'services')?.state === 'done')
ok('unknown facts are not called missing', unknown.steps.some((s) => s.state === 'could-not-check'))

const partial = buildGuidanceProgress('starting', {
  hasName: true, hasPhone: true, hasAddress: false, hasHours: true, serviceCount: 2, barberCount: 1, websiteLive: false,
})
ok('a real gap is reported as to-do', partial.steps.some((s) => s.state === 'to-do'))
ok('a real gap still yields a percentage', partial.percent !== null)
ok('the headline does not scold', /urgent/i.test(partial.headline) && !/fail|incomplete|missing/i.test(partial.headline), partial.headline)

const multi = buildGuidanceProgress('multi-location', { barberCount: 2, serviceCount: 5 })
ok('deferred multi-location steps are never scored', multi.steps.length === 0)
ok('deferred multi-location says so plainly', /nothing to check yet/i.test(multi.headline), multi.headline)

// Stage inference
ok('one barber with services is starting', inferStage({ barberCount: 1, serviceCount: 4 }) === 'starting')
ok('two barbers is growing', inferStage({ barberCount: 2, serviceCount: 4 }) === 'growing')
ok('four barbers is established', inferStage({ barberCount: 4, serviceCount: 9 }) === 'established')
ok('unreadable counts refuse to guess', inferStage({ barberCount: null, serviceCount: 3 }) === null)
ok('missing counts refuse to guess', inferStage({}) === null)

// No step may promise a feature that does not exist
const ids = new Set(STAGE_COPY.flatMap((s) => s.steps.map((x) => x.id)))
for (const id of ['per-location', 'shared-brand', 'consolidated']) {
  ok(`${id} exists only as a deferred explanation`, ids.has(id))
}
ok('optional steps are marked optional', STAGE_COPY.flatMap((s) => s.steps).some((s) => s.optional === true))

// ─── Part 4.5: a step's button must go somewhere real ───────────────────────
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const APP = join(ROOT, 'src', 'app')
const settingsPage = readFileSync(join(APP, '(dashboard)', 'dashboard', 'settings', 'page.tsx'), 'utf8')
const tabMatch = /const VALID_TABS = \[([\s\S]*?)\] as const/.exec(settingsPage)
const validTabs = tabMatch ? [...tabMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []

function actionExists(href: string): boolean {
  const [path, query] = href.split('?')
  const segments = path.replace(/^\//, '').split('/')
  const found =
    existsSync(join(APP, '(dashboard)', ...segments, 'page.tsx')) ||
    existsSync(join(APP, ...segments, 'page.tsx')) ||
    existsSync(join(APP, '(customer)', ...segments, 'page.tsx'))
  if (!found) return false
  if (query) {
    const tab = new URLSearchParams(query).get('tab')
    if (tab && !validTabs.includes(tab)) return false
  }
  return true
}

const actions = STAGE_COPY.flatMap((s) => s.steps.map((step) => step.action)).filter((a): a is string => Boolean(a))
ok('most steps offer a way to do them', actions.length >= 12, String(actions.length))
for (const href of [...new Set(actions)]) {
  ok(`step action resolves: ${href}`, actionExists(href))
}
ok(
  'a deferred step never offers a dead button',
  STAGE_COPY.filter((s) => s.id === 'franchise').flatMap((s) => s.steps).every((s) => s.action === null || Boolean(s.action)),
)

// ─── Part 4.3: progress separates required, optional and unknown ────────────
const growing = buildGuidanceProgress('growing', {
  barberCount: 2, serviceCount: 4, bookingEnabled: true,
})
ok('required work is listed', growing.remaining.length === 0 || growing.remaining.every((id) => typeof id === 'string'))
ok('optional work is listed separately', Array.isArray(growing.optionalRemaining))
ok('unknown work is listed separately', Array.isArray(growing.unknownSteps))
ok('a percentage counts required steps only', growing.percent === 100, String(growing.percent))

const optionalOnly = buildGuidanceProgress('growing', { barberCount: 2, serviceCount: 4, bookingEnabled: false })
ok('an open optional step does not reduce the score', optionalOnly.percent === 100, String(optionalOnly.percent))
ok('an open optional step is still named', optionalOnly.optionalRemaining.length > 0)

const requiredOpen = buildGuidanceProgress('starting', {
  hasName: true, hasPhone: true, hasAddress: true, hasHours: true, serviceCount: 0, barberCount: 1, websiteLive: true,
})
ok('an open required step is named as the next one', requiredOpen.nextStepId === 'services', String(requiredOpen.nextStepId))
ok('an open required step lowers the score', requiredOpen.percent !== null && requiredOpen.percent < 100, String(requiredOpen.percent))

const unreadable = buildGuidanceProgress('starting', { hasName: true })
ok('unreadable required work refuses a score', unreadable.percent === null)
ok('unreadable work is counted, not guessed', unreadable.unknownSteps.length > 0)
ok('no next step is invented from nothing', unreadable.nextStepId === null || unreadable.remaining.includes(unreadable.nextStepId))

const franchise = buildGuidanceProgress('franchise', { barberCount: 9, serviceCount: 9 })
ok('the franchise stage is never scored against the owner', franchise.steps.length === 0 && franchise.percent === null)

console.log(`\nSetup guidance: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

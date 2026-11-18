/**
 * SEO health report and homepage stage recommendations.
 *
 * Pins the two promises that make these safe to show an owner:
 *   - the SEO report only reports what the records support, never invents a
 *     rating, hours or address, and never promises a ranking
 *   - the recommendations only ever mention existing module ids, always start
 *     with hero, and change nothing by themselves
 *
 * Pure logic. No database.
 * Run: npx tsx tests/seo-health.test.ts
 */

import { buildSeoHealthReport, groupSeoIssues, type SeoHealthInput } from '../src/lib/seo-health'
import { HOME_MODULE_IDS } from '../src/lib/home-modules'
import {
  inferStage,
  recommendForStage,
  recommendationDiff,
  stageRecommendations,
} from '../src/lib/home-recommendations'

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

const COMPLETE: SeoHealthInput = {
  pageTitle: 'Precision fades and beard work in Camden',
  description: 'A two-chair barbershop in Camden. Skin fades, beard shaping and hot towel shaves, walk-ins welcome six days a week.',
  businessName: 'Camden Cuts',
  phone: '020 7946 0000',
  address: '12 Camden Road',
  city: 'London',
  hours: { mon: { open: '09:00', close: '18:00' }, sun: { isOff: true } },
  services: [{ name: 'Skin fade', description: 'Clipper fade with a razor finish.' }],
  barbers: [{ name: 'Sam', bio: 'Twelve years on the chair, specialising in fades.' }],
  hasPhotos: true,
  canonicalBase: 'https://camdencuts.example.com',
}

console.log('--- a complete listing reports nothing wrong ---')
const good = buildSeoHealthReport(COMPLETE)
ok('a complete business has no issues', good.issues.length === 0, good.issues.map((i) => i.id).join(', '))
ok('a complete business is healthy', good.isHealthy === true)
ok('the summary does not promise a ranking', !/will rank|you will|first page|top of google|guaranteed/i.test(good.summary), good.summary.slice(0, 80))
ok('the summary says plainly that a ranking is not guaranteed', /does not guarantee/i.test(good.summary))
ok('checks ran and passed', good.checksRun > 0 && good.checksPassed === good.checksRun)

console.log('--- an empty business reports everything, in plain words ---')
const empty = buildSeoHealthReport({})
ok('an empty business is not healthy', empty.isHealthy === false)
ok('it flags the missing title', empty.issues.some((i) => i.id === 'missing-title'))
ok('it flags the missing description', empty.issues.some((i) => i.id === 'missing-description'))
ok('it flags the missing phone', empty.issues.some((i) => i.id === 'missing-phone'))
ok('it flags the missing address', empty.issues.some((i) => i.id === 'missing-address'))
ok('it flags the missing services', empty.issues.some((i) => i.id === 'no-services'))
ok('it flags the missing photos', empty.issues.some((i) => i.id === 'no-photos'))
ok('it flags the unset site address', empty.issues.some((i) => i.id === 'missing-canonical'))
ok('every issue explains why it matters', empty.issues.every((i) => i.why.length > 30))
ok('every issue says what to do next', empty.issues.every((i) => i.fix.length > 15))
ok('nothing is described as broken because of these', !empty.issues.some((i) => /broken|critical|urgent|error/i.test(i.why)), '')
ok('the summary says the site still works', /still works/i.test(empty.summary), empty.summary.slice(0, 90))
ok('the summary never promises a ranking', !/will rank|you will|first page|top of google|guaranteed/i.test(empty.summary))

console.log('--- it only reports what the records support ---')
const partial = buildSeoHealthReport({ ...COMPLETE, phone: null, hours: null })
ok('a missing phone is reported even when everything else is fine', partial.issues.some((i) => i.id === 'missing-phone'))
ok('missing hours is only a nice-to-have', partial.issues.find((i) => i.id === 'missing-hours')?.severity === 'nice-to-have')
ok('an off-day does not count as opening hours', buildSeoHealthReport({ ...COMPLETE, hours: { sun: { isOff: true } } }).issues.some((i) => i.id === 'missing-hours'))
ok('a localhost address is not treated as a real site address', buildSeoHealthReport({ ...COMPLETE, canonicalBase: 'http://localhost:3000' }).issues.some((i) => i.id === 'missing-canonical'))
ok('a placeholder address is not treated as real', buildSeoHealthReport({ ...COMPLETE, canonicalBase: 'https://barber-template.invalid' }).issues.some((i) => i.id === 'missing-canonical'))

console.log('--- length guidance is advisory, not binary failure ---')
const longTitle = buildSeoHealthReport({ ...COMPLETE, pageTitle: 'A'.repeat(90) })
ok('an over-long title is reported', longTitle.issues.some((i) => i.id === 'title-too-long'))
ok('an over-long title is not a hard blocker', longTitle.issues.find((i) => i.id === 'title-too-long')?.severity === 'nice-to-have')
const shortDesc = buildSeoHealthReport({ ...COMPLETE, description: 'Good cuts.' })
ok('a very short description is reported', shortDesc.issues.some((i) => i.id === 'missing-description'))

console.log('--- grouping keeps urgent ahead of optional ---')
const grouped = groupSeoIssues(empty)
ok('urgent items are grouped first', grouped.worthFixing.length > 0)
ok('optional items are separate', grouped.niceToHave.length > 0)
ok('the groups cover every issue', grouped.worthFixing.length + grouped.niceToHave.length === empty.issues.length)

console.log('--- stage recommendations only use existing modules ---')
for (const rec of stageRecommendations()) {
  ok(`${rec.stage}: every module exists`, rec.modules.every((m) => (HOME_MODULE_IDS as readonly string[]).includes(m)), rec.modules.join(', '))
  ok(`${rec.stage}: hero is first`, rec.modules[0] === 'hero')
  ok(`${rec.stage}: has a plain-language reason per section`, rec.reasons.length === rec.modules.length)
  ok(`${rec.stage}: describes who it suits`, rec.suits.length > 20)
  ok(`${rec.stage}: no duplicate modules`, new Set(rec.modules).size === rec.modules.length)
}
ok('there are three stages', stageRecommendations().length === 3)
ok('an unknown stage falls back safely', recommendForStage('franchise').stage === 'independent')
ok('a missing stage falls back safely', recommendForStage(undefined).stage === 'independent')

console.log('--- stage inference does not guess without evidence ---')
ok('no barbers and no services means no guess', inferStage({}) === null)
ok('a single chair is independent', inferStage({ barbers: 1, services: 5 }) === 'independent')
ok('a small team is growing', inferStage({ barbers: 3, services: 8 }) === 'growing')
ok('a full team is established', inferStage({ barbers: 7, services: 12 }) === 'established')

console.log('--- a recommendation never silently replaces anything ---')
const diffAdd = recommendationDiff(['hero', 'services'], ['hero', 'quickBook', 'services', 'team'])
ok('new sections are listed as additions', diffAdd.add.includes('quickBook') && diffAdd.add.includes('team'))
ok('nothing is removed when nothing conflicts', diffAdd.remove.length === 0)
ok('kept sections are identified', diffAdd.keep.includes('services'))
const diffEmpty = recommendationDiff([], ['hero', 'quickBook', 'services'])
ok('an unsaved homepage is offered additions only', diffEmpty.remove.length === 0 && diffEmpty.add.includes('services'))
ok('hero is never offered as a new addition', !diffEmpty.add.includes('hero'))
const diffRemove = recommendationDiff(['hero', 'faq', 'services'], ['hero', 'services'])
ok('sections not in the recommendation are named as removable', diffRemove.remove.includes('faq'))
ok('a recommendation does not touch hero', !diffRemove.remove.includes('hero'))

console.log(`\nSEO and homepage guidance tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

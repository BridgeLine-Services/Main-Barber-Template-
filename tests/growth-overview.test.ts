/** Priority 3: the growth centre may not invent a number or a reassurance. */
import { buildGrowthCards, summariseGrowth, type GrowthInput } from '../src/lib/growth/overview'

let passed = 0
const failures: string[] = []
function ok(name: string, condition: boolean, detail?: string) {
  if (condition) passed += 1
  else failures.push(name + (detail ? ' — ' + detail : ''))
}

const base: GrowthInput = {
  audienceCount: 40,
  dueCount: 0,
  atRiskCount: 0,
  rebookingWaiting: 0,
  campaignCount: 0,
  lastCampaignSentAt: null,
  reviewInvitesSent: 3,
  emailConfigured: true,
}

const cards = buildGrowthCards(base)
const by = (id: string) => buildGrowthCards(base).find((c) => c.id === id)!

ok('seven cards, one per topic', cards.length === 7)
ok('every card has a title and a headline', cards.every((c) => c.title.length > 2 && c.headline.length > 5))

// Nothing unreadable is ever called healthy.
const broken = buildGrowthCards({
  audienceCount: null,
  dueCount: null,
  atRiskCount: null,
  rebookingWaiting: null,
  campaignCount: null,
  lastCampaignSentAt: null,
  reviewInvitesSent: null,
  emailConfigured: null,
})
ok('an unreadable reach is could-not-check', broken.find((c) => c.id === 'reach')!.state === 'could-not-check')
ok('an unreadable rebooking count is could-not-check', broken.find((c) => c.id === 'rebooking')!.state === 'could-not-check')
ok('no card is healthy when every read failed', broken.every((c) => c.state !== 'healthy'))
ok('the summary says how many checks failed', /could not be read/.test(summariseGrowth(broken)))
ok('a zero is never shown for an unreadable count', !/^0 /.test(broken.find((c) => c.id === 'rebooking')!.headline))
ok('an unreadable count still reassures about the records', /untouched|not affected|accurate/i.test(
  broken.map((c) => c.detail).join(' ')))

// Real numbers read plainly.
ok('reach states the count', /40 customers/.test(by('reach').headline))
ok('singular reads correctly', /1 customer\./.test(buildGrowthCards({ ...base, audienceCount: 1 }).find((c) => c.id === 'reach')!.headline))
ok('nobody due back is healthy', by('returning').state === 'healthy')
ok('someone due back needs attention', buildGrowthCards({ ...base, dueCount: 2 }).find((c) => c.id === 'returning')!.state === 'needs-attention')
ok('due back names both numbers', /2 customers are due back and 3 drifting away/.test(
  buildGrowthCards({ ...base, dueCount: 2, atRiskCount: 3 }).find((c) => c.id === 'returning')!.headline))
ok('no campaigns is not-configured, not healthy', by('campaigns').state === 'not-configured')
ok('a recorded campaign is healthy', buildGrowthCards({ ...base, campaignCount: 2, lastCampaignSentAt: '2026-11-01T10:00:00.000Z' }).find((c) => c.id === 'campaigns')!.state === 'healthy')
ok('review invitations state the count', /3 invitations have/.test(by('reviews').headline))
ok('no invitations points at the review link', /review link/i.test(buildGrowthCards({ ...base, reviewInvitesSent: 0 }).find((c) => c.id === 'reviews')!.action || ''))

// The two honest refusals.
ok('automatic wording is never claimed', by('copy').state === 'not-configured')
ok('the copy card says nothing is pretended', /pretended/i.test(by('copy').detail))
ok('Google sync is never claimed', by('google').state === 'not-configured')
ok('Google status points at the connection screen', /Google connection screen/.test(by('google').action || ''))

// Plain words only.
const visible = cards.map((c) => c.title + ' ' + c.headline + ' ' + c.detail + ' ' + (c.action || '')).join(' ').toLowerCase()
for (const jargon of ['api', 'env', 'webhook', 'cron', 'prisma', 'sql', 'null', 'undefined', 'segment']) {
  ok('no jargon: ' + jargon, !visible.includes(jargon))
}

// The summary never overstates.
ok('clean summary is calm', summariseGrowth(buildGrowthCards({ ...base, reviewInvitesSent: 1 })).includes('Nothing needs your attention'))
ok('one item reads as one', summariseGrowth(buildGrowthCards({ ...base, dueCount: 1 })).includes('One thing'))

console.log('\nGrowth overview: ' + passed + ' passed, ' + failures.length + ' failed')
if (failures.length) {
  console.log('\nFAILURES:')
  for (const f of failures) console.log('  ' + f)
  process.exit(1)
}

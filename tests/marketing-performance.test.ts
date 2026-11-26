/**
 * Marketing performance (Section 12). Counts what exists, and refuses to invent the rest.
 */
import {
  NOT_MEASURABLE,
  marketingPerformance,
  summariseCampaigns,
  summariseSources,
  type AttributionRow,
  type CampaignRow,
  type VisitRow,
} from '../src/lib/marketing/performance'

let passed = 0
const failures: string[] = []
function ok(name: string, condition: boolean) {
  if (condition) passed += 1
  else failures.push(name)
}

const campaign = (over: Partial<CampaignRow> = {}): CampaignRow => ({
  id: 'c1',
  name: 'November regulars',
  audience: 'INACTIVE_60',
  status: 'SENT',
  sentAt: '2026-11-02T10:00:00.000Z',
  recipientCount: 40,
  ...over,
})

const attribution = (customerId: string, source: string | null): AttributionRow => ({
  customerId,
  source,
  referrerCustomerId: 'r1',
})

const visit = (customerId: string, status = 'COMPLETED'): VisitRow => ({
  customerId,
  status,
  startTime: '2026-11-10T10:00:00.000Z',
})

// --- campaigns ---
const campaigns = summariseCampaigns([
  campaign(),
  campaign({ id: 'c2', audience: 'BIRTHDAY_MONTH', recipientCount: 10 }),
  campaign({ id: 'c3', status: 'DRAFT', sentAt: null, recipientCount: null }),
  campaign({ id: 'c4', status: 'SENT', sentAt: null, recipientCount: 99 }),
])
ok('only sent campaigns with a send time count', campaigns.sent === 2)
ok('drafts are counted separately', campaigns.drafts === 1)
ok('recipients sum the sent ones only', campaigns.recipientsReached === 50)
ok('audiences are grouped', campaigns.byAudience.length === 2)
ok('audiences are ordered by volume, ties alphabetically', campaigns.byAudience[0]?.audience === 'BIRTHDAY_MONTH')
ok('a missing recipient count counts as zero', summariseCampaigns([campaign({ recipientCount: null })]).recipientsReached === 0)
ok('no campaigns means no numbers', summariseCampaigns([]).sent === 0)

// --- sources and repeat visits ---
const sources = summariseSources(
  [attribution('a', 'referral'), attribution('b', 'REFERRAL'), attribution('c', null), attribution('d', 'instagram')],
  [visit('a'), visit('a'), visit('b'), visit('c'), visit('d'), visit('d'), visit('d', 'CANCELLED')],
)
ok('source names are normalised', sources.map((s) => s.source).sort().join(',') === 'INSTAGRAM,REFERRAL,UNKNOWN')
ok('case variants are one source', sources.find((s) => s.source === 'REFERRAL')?.customers === 2)
ok('a null source is unknown, not dropped', sources.some((s) => s.source === 'UNKNOWN' && s.customers === 1))
ok('returning means two completed visits', sources.find((s) => s.source === 'REFERRAL')?.returning === 1)
ok('a cancelled visit does not count as returning', sources.find((s) => s.source === 'INSTAGRAM')?.returning === 1)
ok('repeat rate is a share', sources.find((s) => s.source === 'REFERRAL')?.repeatRate === 0.5)
ok('no attributions means no rows', summariseSources([], []).length === 0)

// --- the whole view ---
const view = marketingPerformance({
  campaigns: [campaign(), campaign({ id: 'c2', status: 'DRAFT', sentAt: null })],
  attributions: [attribution('a', 'referral'), attribution('b', 'referral'), attribution('c', 'instagram')],
  visits: [visit('a'), visit('a'), visit('b'), visit('c')],
})
ok('totals add up across sources', view.totals.attributedCustomers === 3)
ok('returning customers are counted once', view.totals.returningCustomers === 1)
ok('overall repeat rate is a share', view.totals.repeatRate === 0.33)
ok('campaign and source halves are both present', view.campaigns.sent === 1 && view.sources.length === 2)
ok('what cannot be measured is stated', view.notMeasurable.length === 3)
ok('the unmeasurable list names revenue honestly', view.notMeasurable.some((line) => /Revenue is not recorded/.test(line)))
ok('no fabricated revenue field exists', !('revenue' in view) && !('roi' in view))
ok('an empty shop reports zeros, not errors', marketingPerformance({ campaigns: [], attributions: [], visits: [] }).totals.repeatRate === 0)
ok('the unmeasurable list is a fixed fact, not per-shop', NOT_MEASURABLE.length === 3)

console.log(`\nMarketing performance: ${passed} passed, ${failures.length} failed`)
for (const failure of failures) console.log(`  FAIL ${failure}`)
if (failures.length > 0) process.exit(1)

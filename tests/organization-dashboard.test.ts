/**
 * The organization overview page: what it says, and what it must never say.
 *
 * Two kinds of assertion here. The first kind exercises the presentation functions
 * directly: unknown is never zero, a stale or partial report names what is missing, and a
 * person without an organization gets a plain sentence rather than an error. The second
 * kind reads the page source, because some guarantees are structural: the organization
 * comes from the session and never from the URL, the page renders no control that changes
 * anything, and no customer identity is mentioned anywhere in it.
 *
 * Run: npx tsx tests/organization-dashboard.test.ts  (no server or database needed)
 */

import { readFileSync } from 'node:fs'
import { aggregateOnlyGuard } from '../src/lib/organization/privacy'
import { can, CORPORATE_ROLES, describeRole } from '../src/lib/organization/capabilities'
import { hasLocationAccess, type OrgContext } from '../src/lib/organization/resolve'
import { buildOrganizationReport, type LocationRollup } from '../src/lib/organization/reporting'
import {
  RANGE_OPTIONS,
  UNVERIFIED,
  describeLocationStatus,
  describeOrganizationHeadline,
  formatCount,
  formatMoney,
  locationViews,
  noOrganizationCopy,
  summaryMetrics,
  unverifiedNotice,
} from '../src/lib/organization/dashboard-view'

let passed = 0
let failed = 0
function ok(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const page = readFileSync('src/app/(dashboard)/dashboard/organization/page.tsx', 'utf8')
const view = readFileSync('src/lib/organization/dashboard-view.ts', 'utf8')

function rollup(overrides: Partial<LocationRollup> = {}): LocationRollup {
  return {
    businessId: 'biz_a',
    name: 'Downtown',
    region: 'North',
    status: 'ACTIVE',
    grossRevenueCents: 120000,
    refundsCents: 5000,
    netRevenueCents: 115000,
    commissionsCents: 30000,
    recordedExpensesCents: null,
    appointments: 40,
    completed: 36,
    cancelled: 4,
    newCustomers: 9,
    returningCustomers: 31,
    activeMemberships: 12,
    membershipRevenueCents: 40000,
    utilisationPercent: 62,
    staffCount: 4,
    ...overrides,
  }
}

function report(locations: LocationRollup[]) {
  return buildOrganizationReport('org_1', locations, {
    generatedAt: '2026-11-22T12:00:00.000Z',
    rangeLabel: 'the last 30 days',
  })
}

// ─── unknown is never healthy, and never zero ──────────────────────────────
console.log('\n--- a figure nobody could read is not a zero ---')
ok(formatMoney(null) === UNVERIFIED, 'a missing money figure says "Could not verify"')
ok(formatCount(null) === UNVERIFIED, 'a missing count says "Could not verify"')
ok(formatMoney(0) === '$0.00', 'a real zero still reads as zero')
ok(formatCount(0) === '0', 'a real zero count still reads as zero')
ok(formatMoney(123456) === '$1,234.56', 'money is shown in pounds-free dollars and cents')
ok(formatMoney(-500) === '-$5.00', 'a negative figure keeps its sign rather than being hidden')

const partial = report([rollup(), rollup({ businessId: 'biz_b', name: 'Uptown', netRevenueCents: null, completed: null })])
const partialMetrics = summaryMetrics(partial)
ok(partialMetrics.some((m) => m.unverified), 'a partial report marks the affected totals as unverified')
ok(partialMetrics.every((m) => m.unverified || m.value !== '0'), 'no unverified total is rendered as a bare zero')
ok(partial.unverifiedLocations.includes('Uptown'), 'the location that could not be read is named')
const notice = unverifiedNotice(partial)
ok(!!notice && notice.includes('Uptown'), 'the page names which location is missing')
ok(!!notice && /not the organization total/.test(notice), 'and says a smaller total is not the organization total')
ok(unverifiedNotice(report([rollup()])) === null, 'a fully readable report carries no warning box')

console.log('\n--- the location list is per-location and honest ---')
const views = locationViews(partial)
ok(views.length === 2, 'every readable location gets a card')
ok(views[1].hasUnverifiedFigures, 'a location with an unreadable figure is flagged')
ok(!views[0].hasUnverifiedFigures, 'a fully readable location is not flagged')
ok(views[0].metrics.some((m) => m.label === 'Money taken after refunds'), 'money after refunds is labelled in plain words')
ok(!views[0].metrics.some((m) => /net revenue/i.test(m.label)), 'the phrase "net revenue" is not used')
ok(describeLocationStatus('ACTIVE') === 'Open for bookings', 'an active location is described in words')
ok(describeLocationStatus('INACTIVE') === 'Not taking bookings', 'a paused location is described in words')
ok(describeLocationStatus(null) === 'Status could not be read', 'an unknown status is never shown as open')
ok(describeLocationStatus('ARCHIVED') === 'Status not recognised', 'an unexpected status is not guessed at')
ok(describeOrganizationHeadline(report([rollup()]), 1).includes('1 location'), 'the headline says "1 location" for one shop')
ok(describeOrganizationHeadline(partial, 2).includes('could not be read'), 'the headline mentions unreadable figures')

// ─── privacy: aggregates only ──────────────────────────────────────────────
console.log('\n--- no customer identity can reach this page ---')
ok(aggregateOnlyGuard(report([rollup()])).safe, 'a real report passes the aggregate-only guard')
const leaky = { ...report([rollup()]), locations: [{ ...rollup(), customerName: 'Ada Lovelace' }] }
ok(!aggregateOnlyGuard(leaky).safe, 'a report carrying a customer name is refused')
ok(!page.includes('customerName') && !page.includes('customerEmail') && !page.includes('customerPhone'), 'the page renders no customer identity field')
ok(!/\.customer\b/.test(page), 'the page never queries customer records')
for (const role of CORPORATE_ROLES) {
  ok(!can(role, 'reporting.customer.read'), `${role} cannot read individual customer records`)
}
ok(can('ORGANIZATION_OWNER', 'reporting.aggregate.read'), 'an organization owner may read aggregate reporting')
ok(can('LOCATION_MANAGER', 'reporting.aggregate.read'), 'a location manager may read totals for their own location')
ok(!can('CUSTOMER', 'reporting.aggregate.read'), 'a customer account cannot read organization reporting')
ok(describeRole('REGIONAL_MANAGER').length > 0, 'each role has a plain-language description')

// ─── access: the session decides, never the URL ────────────────────────────
console.log('\n--- the organization comes from the session ---')
ok(page.includes('resolveOrganizationContext(auth.user.id)'), 'the organization is resolved from the signed-in user')
ok(!/searchParams[^\n]*organization/i.test(page), 'no organization id is read from the URL')
ok(!/params\.(org|organization|businessId)/.test(page), 'no organization or business id is taken from a query parameter')
ok(page.includes('aggregateOnlyGuard'), 'the page runs the aggregate-only guard itself')
ok(page.includes("redirect('/login')"), 'an unauthenticated visitor is sent to the login page')
ok(!page.includes('requireOwner'), 'the page is not limited to a single-shop owner')

const owner: OrgContext = {
  organizationId: 'org_1', organizationName: 'Bridge Line', membershipId: 'm1', role: 'ORGANIZATION_OWNER',
  regions: [], locationBusinessIds: ['biz_a', 'biz_b'], homeBusinessId: null,
}
const regional: OrgContext = { ...owner, role: 'REGIONAL_MANAGER', regions: ['North'], locationBusinessIds: ['biz_a'] }
const local: OrgContext = { ...owner, role: 'LOCATION_MANAGER', regions: [], locationBusinessIds: ['biz_b'], homeBusinessId: 'biz_b' }
ok(hasLocationAccess(owner, 'biz_a') && hasLocationAccess(owner, 'biz_b'), 'an organization owner may see both of their locations')
ok(hasLocationAccess(regional, 'biz_a') && !hasLocationAccess(regional, 'biz_b'), 'a regional manager sees only their assigned region')
ok(hasLocationAccess(local, 'biz_b') && !hasLocationAccess(local, 'biz_a'), 'a location user sees only their own location')
ok(page.includes('context.locationBusinessIds'), 'the page loads exactly the locations the context allows')

// ─── single-shop users keep their own dashboard ────────────────────────────
console.log('\n--- a shop without an organization is not an error ---')
ok(noOrganizationCopy('no-membership').includes('your own shop dashboard'), 'a single-shop user is pointed at their shop dashboard')
ok(noOrganizationCopy('read-failed').includes('not a statement that you have no organization'), 'a failed read is not reported as "no organization"')
ok(noOrganizationCopy('suspended').includes('still works'), 'a paused membership says the shop dashboard still works')
ok(page.includes('Go to my shop dashboard'), 'the page offers a way back to the single-shop dashboard')
ok(!page.includes('OrganizationError'), 'there is no error page competing with the shop dashboard')

// ─── read-only, and safe on a phone ────────────────────────────────────────
console.log('\n--- the page only looks ---')
ok(!/<form/.test(page), 'the page renders no form')
ok(!/<button/.test(page), 'the page renders no button that could change something')
ok(!/fetch\(/.test(page) && !/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(page), 'the page issues no write request')
ok(!/prisma\.\w+\.(create|update|delete|upsert)/.test(page), 'the page writes no record')
ok(!/\$executeRaw|\$queryRaw/.test(page), 'the page runs no raw SQL')
ok(page.includes('This page only looks'), 'the page says so')

console.log('\n--- usable on a phone, labelled for a screen reader ---')
ok(page.includes('sm:grid-cols-2') && page.includes('lg:grid-cols-3'), 'cards stack on a phone and spread on larger screens')
ok(!/\bw-\[\d{3,}px\]/.test(page), 'no fixed pixel width that would overflow a phone')
ok(page.includes('min-h-11'), 'the period links are large enough to tap')
ok(page.includes('aria-label="Reporting period"'), 'the period selector is labelled')
ok(page.includes("aria-current={current ? 'true' : undefined}"), 'the current period is announced')
ok(page.includes('<dl') && page.includes('<dt') && page.includes('<dd'), 'each location is a description list, not a table of loose divs')
ok(page.includes('aria-labelledby="unverified"'), 'the warning section is labelled by its heading')
ok(RANGE_OPTIONS.length === 4 && RANGE_OPTIONS.every((o) => o.href.startsWith('/dashboard/organization?days=')), 'the period links use the supported range parameter')
ok(RANGE_OPTIONS.every((o) => o.days >= 1 && o.days <= 365), 'every offered period is inside the supported 1-365 day range')
ok(!view.includes('dangerouslySetInnerHTML'), 'no raw HTML is produced')

console.log(`\nOrganization dashboard: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)

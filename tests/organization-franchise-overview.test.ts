/**
 * The franchise overview: one page, five roles, and no guessing.
 *
 * The labels come from the lifecycle, branding and pricing rules; this suite checks that
 * the page reports what those rules decided and that nothing on it writes.
 */

import { readFileSync } from 'node:fs'
import nodeAssert from 'node:assert/strict'
import {
  describeAnnouncement,
  describeBranding,
  describeLocationStatus,
  describePricing,
  describeRegion,
  summariseStaff,
  summariseStructure,
} from '../src/lib/organization/franchise-view'
import { can } from '../src/lib/organization/capabilities'
import { hasLocationAccess, type OrgContext } from '../src/lib/organization/resolve'
import { resolveBrandField } from '../src/lib/organization/branding'
import { resolveServicePrice } from '../src/lib/organization/service-templates'

const PAGE = readFileSync('src/app/(dashboard)/dashboard/organization/structure/page.tsx', 'utf8')
const VIEW = readFileSync('src/lib/organization/franchise-view.ts', 'utf8')

let passed = 0
const failures: string[] = []
function ok(condition: boolean, name: string) {
  if (condition) { passed += 1; console.log(`  PASS ${name}`) } else { failures.push(name); console.log(`  FAIL ${name}`) }
}
function eq<T>(actual: T, expected: T, name: string) {
  try { nodeAssert.deepEqual(actual, expected); passed += 1; console.log(`  PASS ${name}`) }
  catch { failures.push(name); console.log(`  FAIL ${name} — got ${JSON.stringify(actual)}`) }
}

console.log('\n--- location statuses are the lifecycle words ---')
eq(describeLocationStatus('onboarding').label, 'Location is being prepared', 'a new location is being prepared')
eq(describeLocationStatus('active').label, 'Location is open', 'an active location is open')
eq(describeLocationStatus('closing').label, 'Location is closing', 'a closing location is closing')
eq(describeLocationStatus('closed').label, 'Location is closed', 'a closed location is closed')
ok(describeLocationStatus('banana').label === 'Status could not be read', 'an unrecognised status is never called open')
ok(!/open/i.test(describeLocationStatus(null).label), 'a missing status is never called open')
ok(/not a statement that the location is open/.test(describeLocationStatus(undefined).detail), 'and it says so plainly')

console.log('\n--- regions ---')
eq(describeRegion('North London'), 'North London', 'a region is shown as recorded')
eq(describeRegion(null), 'No region set', 'a missing region says so instead of inventing one')
eq(describeRegion('   '), 'No region set', 'blank is missing')

console.log('\n--- branding, decided by the existing resolver ---')
const settings = { logoUrl: 'https://cdn.example/logo.png', primaryColor: '#111111', accentColor: null, brandGuidelinesUrl: null, allowedOverrides: ['logoUrl'] as Array<'logoUrl'> }
eq(describeBranding(settings, null).label, 'Standard company branding', 'no override is standard branding')
eq(describeBranding(settings, { logoUrl: 'https://cdn.example/other.png' }).label, 'Approved location-specific change', 'an allowed override is an approved change')
eq(describeBranding(null, null).label, 'No company branding set up yet', 'no settings is not "standard", it is unset')
ok(!/standard/i.test(describeBranding(null, null).label), 'unset branding is never called standard')
eq(resolveBrandField(settings as never, { logoUrl: 'https://cdn.example/other.png' }, 'logoUrl').source, 'location', 'the resolver is what allows it')

console.log('\n--- prices, decided by the existing resolver ---')
const templates = [{ id: 't1', name: 'Cut', durationMinutes: 30, defaultPriceCents: 3000 }]
eq(describePricing(templates as never, [], 'b1').label, 'Standard service prices', 'no exception is standard prices')
eq(describePricing(templates as never, [{ templateId: 't1', businessId: 'b1', priceCents: 3500, reason: 'city centre' }] as never, 'b1').label, 'Approved price exception', 'an exception is an approved price exception')
eq(describePricing([], [], 'b1').label, 'No standard prices set up yet', 'no templates is unset, not standard')
ok(describePricing(templates as never, [{ templateId: 't1', businessId: 'b2', priceCents: 3500, reason: null }] as never, 'b1').tone === 'standard', "another shop's exception does not touch this one")
eq(resolveServicePrice(templates[0] as never, { templateId: 't1', businessId: 'b1', priceCents: 3500, reason: null } as never, 'b1').source, 'location-exception', 'the resolver is what decides it')

console.log('\n--- staff are counted, never named ---')
const at = new Date('2026-11-23T12:00:00Z')
const assignments = [
  { userId: 'u1', businessId: 'b1', role: 'LOCATION_MANAGER', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null },
  { userId: 'u2', businessId: 'b1', role: 'BARBER', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null },
  { userId: 'u3', businessId: 'b1', role: 'BARBER', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: '2026-02-01T00:00:00Z' },
  { userId: 'u4', businessId: 'b2', role: 'BARBER', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null },
]
const staff = summariseStaff(assignments, 'b1', at)
eq(staff.total, 2, 'only current assignments count')
ok(!staff.label.includes('u1') && !staff.label.includes('u2'), 'no user id appears in the sentence')
ok(/1 location managers, 1 barbers/.test(staff.label), 'the sentence counts each role')
eq(summariseStaff([], 'b1', at).label, 'Nobody is assigned here yet.', 'an empty location says so')

console.log('\n--- announcements ---')
eq(describeAnnouncement({ title: 'X', audienceType: 'all', audienceValues: [], publishedAt: null, createdAt: at }).label, 'Draft, not sent', 'an unpublished announcement is a draft')
ok(/Sent on 2026-11-20/.test(describeAnnouncement({ title: 'X', audienceType: 'region', audienceValues: ['North'], publishedAt: '2026-11-20T09:00:00Z', createdAt: at }).label), 'a sent one shows its date')
ok(/North region/.test(describeAnnouncement({ title: 'X', audienceType: 'region', audienceValues: ['North'], publishedAt: null, createdAt: at }).detail), 'the audience is named')

console.log('\n--- the headline ---')
ok(/no locations you can see yet/.test(summariseStructure({ organizationName: 'Acme', locations: [], regions: [] })), 'an empty organization says it has none')
ok(/3 locations, 2 open, 1 being prepared/.test(summariseStructure({ organizationName: 'Acme', locations: [{ status: 'active' }, { status: 'active' }, { status: 'onboarding' }], regions: [] })), 'the counts are stated')

console.log('\n--- every role sees only its own locations ---')
const ctx = (role: OrgContext['role'], ids: string[], regions: string[] = []): OrgContext => ({
  organizationId: 'o1', organizationName: 'Acme', membershipId: 'm1', role, regions, locationBusinessIds: ids, homeBusinessId: ids[0] ?? null,
})
const owner = ctx('ORGANIZATION_OWNER', ['b1', 'b2', 'b3'])
const regional = ctx('REGIONAL_MANAGER', ['b1'], ['North'])
const franchise = ctx('FRANCHISE_OWNER', ['b2'])
const admin = ctx('CORPORATE_ADMIN', ['b1', 'b2', 'b3'])
ok(hasLocationAccess(owner, 'b3'), 'an owner reaches every assigned location')
ok(!hasLocationAccess(regional, 'b2'), 'a regional manager cannot reach another region')
ok(!hasLocationAccess(franchise, 'b1'), 'a franchise owner cannot reach another shop')
ok(hasLocationAccess(franchise, 'b2'), 'a franchise owner reaches their own shop')
ok(hasLocationAccess(admin, 'b1'), 'a corporate admin reaches assigned locations')
ok(!hasLocationAccess(ctx('LOCATION_MANAGER', ['b1']), 'b2'), 'a location manager reaches one location')
ok(can('ORGANIZATION_OWNER', 'staff.assign'), 'only roles with staff.assign see the manager name')
ok(!can('CORPORATE_ADMIN', 'staff.assign'), 'a corporate admin does not see manager names')
ok(can('REGIONAL_MANAGER', 'staff.assign'), 'a regional manager may see a manager name, for their own locations only')

console.log('\n--- the page is read-only and privacy-safe ---')
ok(/resolveOrganizationContext\(auth\.user\.id\)/.test(PAGE), 'the organization comes from the session')
ok(!/searchParams/.test(PAGE), 'no organization id is taken from the browser')
ok(/businessId: \{ in: context\.locationBusinessIds \}/.test(PAGE), 'only authorized locations are loaded')
ok(/prisma\.organizationLocation\.create|prisma\.organizationLocation\.update|prisma\.organizationLocation\.delete/.test(PAGE) === false, 'the page never writes a location')
ok(!/organizationServiceTemplate\.(create|update|delete)|organizationBrandSettings\.(create|update|delete)/.test(PAGE), 'the page never changes prices or branding')
ok(!/staffLocationAssignment\.(create|update|delete)/.test(PAGE), 'the page never changes an assignment')
ok(!/organizationMember\.(create|update|delete)/.test(PAGE), 'the page never changes a membership')
ok(!/organizationAnnouncement\.(create|update|delete)/.test(PAGE), 'the page never sends an announcement')
ok(!/customer\.findMany|customer\.findFirst/.test(PAGE), 'no customer record is read')
ok(/never shows a customer/.test(PAGE), 'the page says so')
ok(!/<form|type="submit"/.test(PAGE), 'there is no form on the page')
ok(/min-h-11/.test(PAGE), 'touch targets are large enough on a phone')
ok(/sm:grid-cols-2/.test(PAGE), 'the cards stack on a phone and spread on a tablet')
ok(/<dl|<dt|<dd/.test(PAGE), 'each fact is a definition list a screen reader can follow')
ok(/aria-labelledby="announcements"/.test(PAGE), 'the announcements section is labelled')
ok(!/useEffect|fetch\(/.test(PAGE), 'the page runs nothing on load and calls no API')
ok(/role: 'LOCATION_MANAGER'/.test(PAGE) && /organizationId: context\.organizationId/.test(PAGE), 'the manager lookup is scoped to the organization')
ok(/maySeeManagers/.test(PAGE), 'manager names are gated by a capability')
ok(!/fake|placeholder|demo/i.test(VIEW), 'the wording module carries no demo data')

console.log(`\nFranchise overview: ${passed} passed, ${failures.length} failed`)
if (failures.length > 0) process.exitCode = 1

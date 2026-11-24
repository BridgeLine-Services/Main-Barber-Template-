/**
 * Location management rules, pinned.
 *
 * The important assertions here are the refusals: a half-finished shop cannot open, a
 * duplicate name cannot be created, a shop cannot be moved into a region the person does
 * not hold, and closing cannot finish while money is unsettled.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activationVerdict,
  buildClosureReview,
  findDuplicateLocation,
  isValidTimezone,
  planRegionRename,
  regionChangeVerdict,
  regionNames,
  reopenGuidance,
  slugFromName,
  statusCounts,
  validateLocationDraft,
  type LocationFacts,
} from '../src/lib/organization/location-management'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; return }
  failed++
  console.log('  FAIL ' + name + (detail ? ' - ' + detail : ''))
}

const ROOT = join(__dirname, '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

const shop = (over: Partial<LocationFacts> = {}): LocationFacts => ({
  businessId: 'b1', name: 'Downtown', region: 'West', status: 'onboarding', ...over,
})

const ready = { brandSet: true, servicesSet: true, managerAssigned: true }

// --- draft validation -------------------------------------------------------

const good = { name: 'Downtown', timezone: 'America/Los_Angeles' }
ok('a complete draft is accepted', validateLocationDraft(good).allowed)
ok('a one-letter name is refused', !validateLocationDraft({ ...good, name: 'A' }).allowed)
ok('a 300-character name is refused', !validateLocationDraft({ ...good, name: 'x'.repeat(300) }).allowed)
ok('a missing timezone is refused', !validateLocationDraft({ ...good, timezone: '' }).allowed)
ok('a made-up timezone is refused', !validateLocationDraft({ ...good, timezone: 'Mars/Olympus' }).allowed)
ok('a real timezone passes the formatter', isValidTimezone('Europe/Berlin'))
ok('a bare word is not a timezone', !isValidTimezone('Pacific'))
ok('a bad email is refused', !validateLocationDraft({ ...good, email: 'not-an-email' }).allowed)
ok('a good email is accepted', validateLocationDraft({ ...good, email: 'a@b.co' }).allowed)
ok('a short phone is refused', !validateLocationDraft({ ...good, phone: '123' }).allowed)
ok('a full phone is accepted', validateLocationDraft({ ...good, phone: '(415) 555-0134' }).allowed)
ok('an over-long region is refused', !validateLocationDraft({ ...good, region: 'r'.repeat(80) }).allowed)
ok('every refusal explains itself', validateLocationDraft({ name: '' }).reasons.length > 0)

// --- slugs and duplicates ---------------------------------------------------

ok('a slug is made from the name', slugFromName('Downtown Barbers') === 'downtown-barbers')
ok('accents are folded', slugFromName('Café Noir') === 'cafe-noir')
ok('punctuation collapses', slugFromName('  Bob & Co!! ') === 'bob-co')
ok('an empty name still yields a slug', slugFromName('!!!') === 'shop')
ok('a taken slug gets a suffix', slugFromName('Downtown', ['downtown']) === 'downtown-2')
ok('two taken slugs skip to three', slugFromName('Downtown', ['downtown', 'downtown-2']) === 'downtown-3')

const existing = [shop({ businessId: 'b1', name: 'Downtown' }), shop({ businessId: 'b2', name: 'Airport' })]
ok('an exact duplicate is found', findDuplicateLocation('Downtown', existing)?.businessId === 'b1')
ok('case and spaces do not hide a duplicate', findDuplicateLocation('  downtown  ', existing)?.businessId === 'b1')
ok('a different name is not a duplicate', findDuplicateLocation('Harbor', existing) === null)
ok('an empty name is not a duplicate', findDuplicateLocation('   ', existing) === null)

// --- regions ----------------------------------------------------------------

ok('regions are unique and sorted', regionNames([shop({ region: 'West' }), shop({ businessId: 'b2', region: 'East' }), shop({ businessId: 'b3', region: 'West' })]).join(',') === 'East,West')
ok('a null region is not a region name', regionNames([shop({ region: null })]).length === 0)

ok('an unrestricted actor may use any region', regionChangeVerdict([], 'North').allowed)
ok('a regional manager may use their own region', regionChangeVerdict(['West'], 'west').allowed)
const outside = regionChangeVerdict(['West'], 'East')
ok('a regional manager may not use another region', !outside.allowed)
ok('the refusal names their regions', /West/.test(outside.reasons[0]))
ok('clearing a region is always allowed', regionChangeVerdict(['West'], null).allowed)

const westLocations = [
  shop({ businessId: 'b1', region: 'West' }),
  shop({ businessId: 'b2', region: 'West' }),
  shop({ businessId: 'b3', region: 'East' }),
]
const rename = planRegionRename(westLocations, 'West', 'Western')
ok('a rename moves every location in the region', rename.allowed && rename.affectedBusinessIds.length === 2)
ok('a rename does not touch other regions', !rename.affectedBusinessIds.includes('b3'))
ok('renaming to the same name is refused', !planRegionRename(westLocations, 'West', 'west').allowed)
ok('renaming an unknown region is refused', !planRegionRename(westLocations, 'North', 'South').allowed)
ok('a regional manager cannot rename into a region they lack', !planRegionRename(westLocations, 'West', 'East', ['West']).allowed)

// --- opening ----------------------------------------------------------------

ok('a ready onboarding location may open', activationVerdict(shop(), ready).allowed)
const noBrand = activationVerdict(shop(), { ...ready, brandSet: false })
ok('an unbranded location may not open', !noBrand.allowed)
ok('the refusal says brand', /brand/i.test(noBrand.reasons[0]))
const noServices = activationVerdict(shop(), { ...ready, servicesSet: false })
ok('a location with no services may not open', !noServices.allowed)
ok('the refusal says services', /service/i.test(noServices.reasons[0]))
const noManager = activationVerdict(shop(), { ...ready, managerAssigned: false })
ok('a location with no manager may not open', !noManager.allowed)
ok('the refusal says manager', /manager/i.test(noManager.reasons[0]))
ok('an active location cannot be activated again', !activationVerdict(shop({ status: 'active' }), ready).allowed)
ok('a closed location cannot be activated', !activationVerdict(shop({ status: 'closed' }), ready).allowed)
ok('a closed location says why', /cannot move/.test(activationVerdict(shop({ status: 'closed' }), ready).reasons[0]))

// --- closing ----------------------------------------------------------------

const settledFacts = {
  location: shop({ status: 'closing' }),
  upcomingAppointments: 3, pastAppointments: 412, activeEmployees: 4, staffAssignments: 5,
  outstandingCommissions: 0, unsettledPayments: 0, customers: 180, settled: true, exported: true,
}
const canClose = buildClosureReview(settledFacts)
ok('a settled, exported closing is allowed', canClose.allowed)
ok('every consequence is listed', canClose.lines.length === 7)
ok('the headline names the shop', /Downtown/.test(canClose.headline))
ok('it says records are kept', canClose.keeps.some((line) => /kept, not deleted/i.test(line)))
ok('it says nothing is sent to customers', canClose.keeps.some((line) => /nothing is sent/i.test(line)))
ok('unsettled commissions block closing', !buildClosureReview({ ...settledFacts, outstandingCommissions: 4, settled: false }).allowed)
ok('unsettled payments block closing', !buildClosureReview({ ...settledFacts, unsettledPayments: 2, settled: false }).allowed)
ok('an unexported closing is blocked', !buildClosureReview({ ...settledFacts, exported: false }).allowed)
ok('an unreadable count says so', buildClosureReview({ ...settledFacts, customers: null }).lines.some((line) => line.value === null && /could not be checked/i.test(line.note)))
ok('a null count is never shown as zero', buildClosureReview({ ...settledFacts, customers: null }).lines.find((line) => line.label === 'Customer records')?.value !== 0)
ok('an active location may not close directly', !buildClosureReview({ ...settledFacts, location: shop({ status: 'active' }) }).allowed)
ok('an onboarding location may close directly', buildClosureReview({ ...settledFacts, location: shop({ status: 'onboarding' }) }).allowed)

// --- reopening --------------------------------------------------------------

ok('a closed location cannot reopen itself', !reopenGuidance('closed').allowed)
ok('the refusal points at the proposal', /docs\/ORGANIZATION-MANAGEMENT\.md/.test(reopenGuidance('closed').message))
ok('an active location has nothing to reopen', !reopenGuidance('active').allowed)

// --- counts -----------------------------------------------------------------

const counts = statusCounts([shop(), shop({ status: 'active' }), shop({ status: 'closing' }), shop({ status: 'closed' }), shop({ status: 'closed' })])
ok('total counts every location', counts.total === 5)
ok('active is counted', counts.active === 1)
ok('onboarding is counted', counts.onboarding === 1)
ok('closing is counted', counts.closing === 1)
ok('closed is counted', counts.closed === 2)

// --- the server boundary ----------------------------------------------------

const locationRoutes = [
  'src/app/api/dashboard/organization/locations/route.ts',
  'src/app/api/dashboard/organization/locations/[id]/route.ts',
]
for (const path of locationRoutes) {
  const source = read(path)
  ok(path + ' resolves the organization from the session', source.includes('resolveOrganizationContext(auth.user.id)'))
  ok(path + ' never trusts an organization id from the body', !/body\.organizationId|body\.organization_id/.test(source))
  ok(path + ' requires authentication', source.includes('requireAuth()'))
}
const transitionRoute = read('src/app/api/dashboard/organization/locations/[id]/route.ts')
ok('the lifecycle route checks the capability itself', transitionRoute.includes("can(resolved.context.role, 'locations.manage')"))
ok('the lifecycle route refuses unknown actions', /not recognised/.test(transitionRoute))
const service = read('src/lib/organization/location-service.ts')
ok('the service re-checks the capability on every write', (service.match(/can\(context\.role, 'locations\.manage'\)/g) ?? []).length >= 4)
ok('creating a location writes it in onboarding', /status: 'onboarding'/.test(service))
ok('creating a location is one transaction', /prisma\.\$transaction/.test(service))
ok('creating a location copies the templates', /organizationServiceTemplate\.findMany/.test(service))
ok('nothing deletes a location record', !/organizationLocation\.delete|business\.delete/.test(service))
ok('every write is audited', (service.match(/organizationConfigAudit\.create/g) ?? []).length >= 4)

console.log('')
console.log('Location management: ' + passed + ' passed, ' + failed + ' failed')
if (failed > 0) process.exit(1)

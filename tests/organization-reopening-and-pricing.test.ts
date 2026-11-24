/**
 * Reopening a closed location, and the price approval workflow.
 *
 * Both are consequential: reopening decides whether a shop can take bookings again, and a
 * price approval decides what a customer is charged. Every refusal is pinned here, along
 * with the two source-level guarantees that matter most: an unapproved request cannot reach
 * the table the price resolver reads, and no route takes an organization from the browser.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canTransition, checklistFor, OPENING_STEPS } from '../src/lib/organization/locations'
import { REOPEN_STEPS, reopenGuidance, reopenPlan } from '../src/lib/organization/location-management'
import {
  decisionVerdict,
  describePriceChange,
  describeTemplateChange,
  MAX_PRICE_CENTS,
  money,
  requestVerdict,
  revokeVerdict,
  statusWords,
  summariseRequests,
  validatePriceRequest,
  type PriceRequestRow,
} from '../src/lib/organization/pricing-approvals'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
    return
  }
  failed++
  console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`)
}

// --- the reopening path ---------------------------------------------------

ok('a closed location can begin reopening', canTransition('closed', 'reopening').allowed)
ok('reopening cannot jump to active', !canTransition('reopening', 'active').allowed)
ok('reopening goes to onboarding', canTransition('reopening', 'onboarding').allowed)
ok('reopening can be abandoned', canTransition('reopening', 'closed').allowed)
ok('closed still cannot become active directly', !canTransition('closed', 'active').allowed)
ok('the direct refusal points at reopening', /reopen/i.test(canTransition('closed', 'active').reason))
ok('the direct refusal keeps its warning about identity', /identity/i.test(canTransition('closed', 'active').reason))
ok('reopening uses the opening checklist', checklistFor('reopening') === OPENING_STEPS)
ok('the reopening steps are in order', REOPEN_STEPS.join('>') === 'reopening>onboarding>active')

const goodReopen = reopenPlan({ status: 'closed', reason: 'The landlord renewed the lease and we have staff again.', acknowledged: true })
ok('a reason and an acknowledgement are enough', goodReopen.ok)
ok('the plan lists every step', goodReopen.steps.length === 3)
ok('the message says it cannot take bookings yet', /cannot take bookings/i.test(goodReopen.message))

const noReason = reopenPlan({ status: 'closed', reason: 'soon', acknowledged: true })
ok('a short reason is refused', !noReason.ok)
ok('the refusal says how long the reason must be', /at least 10/i.test(noReason.errors.join(' ')))
const noAck = reopenPlan({ status: 'closed', reason: 'We have staff and a renewed lease now.', acknowledged: false })
ok('without an acknowledgement it is refused', !noAck.ok)
ok('the refusal says what to confirm', /records and history/i.test(noAck.errors.join(' ')))
const wrongState = reopenPlan({ status: 'active', reason: 'We have staff and a renewed lease now.', acknowledged: true })
ok('an active location is not reopened', !wrongState.ok)
ok('no steps are returned when refused', wrongState.steps.length === 0)
ok('the refusal is plain about nothing happening', /was not reopened/i.test(wrongState.message))
ok('a reopening location is told to finish the checklist', /checklist/i.test(reopenGuidance('reopening').message))
ok('an active location has nothing to reopen', !reopenGuidance('active').allowed)

// --- asking for a price ---------------------------------------------------

const base = {
  templateName: 'Skin fade',
  templateActive: true,
  standardPriceCents: 1800,
  requestedPriceCents: 2000,
  reason: 'City centre rent is higher here.',
  businessId: 'b-downtown',
  allowedBusinessIds: ['b-downtown', 'b-airport'],
}

ok('a complete request validates', validatePriceRequest(base).valid)
ok('a missing service is refused', !validatePriceRequest({ ...base, templateName: null }).valid)
ok('a switched-off service is refused', !validatePriceRequest({ ...base, templateActive: false }).valid)
ok('the same price is refused', !validatePriceRequest({ ...base, requestedPriceCents: 1800 }).valid)
ok('a zero price is refused', !validatePriceRequest({ ...base, requestedPriceCents: 0 }).valid)
ok('a negative price is refused', !validatePriceRequest({ ...base, requestedPriceCents: -500 }).valid)
ok('fractional cents are refused', !validatePriceRequest({ ...base, requestedPriceCents: 2000.5 }).valid)
ok('an absurd price is refused', !validatePriceRequest({ ...base, requestedPriceCents: MAX_PRICE_CENTS + 1 }).valid)
ok('the cap is allowed', validatePriceRequest({ ...base, requestedPriceCents: MAX_PRICE_CENTS }).valid)
ok('a short reason is refused', !validatePriceRequest({ ...base, reason: 'rent' }).valid)
ok('a location outside scope is refused', !validatePriceRequest({ ...base, businessId: 'b-harbor' }).valid)
ok('a missing location is refused', !validatePriceRequest({ ...base, businessId: null }).valid)
ok('the scope refusal is explained', /assigned to/i.test(validatePriceRequest({ ...base, businessId: 'b-harbor' }).errors.join(' ')))

ok('a location manager may ask', requestVerdict('LOCATION_MANAGER', base).allowed)
ok('a barber may ask at their own location', requestVerdict('BARBER', base).allowed)
ok('a customer may not ask', !requestVerdict('CUSTOMER', base).allowed)
ok('asking outside scope is refused', !requestVerdict('LOCATION_MANAGER', { ...base, businessId: 'b-harbor' }).allowed)
ok('the scope refusal does not leak other locations', !/harbor/i.test(requestVerdict('LOCATION_MANAGER', { ...base, businessId: 'b-harbor' }).reason))

ok('an owner may decide', decisionVerdict('ORGANIZATION_OWNER', 'PENDING').allowed)
ok('a corporate admin may decide', decisionVerdict('CORPORATE_ADMIN', 'PENDING').allowed)
ok('a regional manager may not decide', !decisionVerdict('REGIONAL_MANAGER', 'PENDING').allowed)
ok('a location manager may not decide', !decisionVerdict('LOCATION_MANAGER', 'PENDING').allowed)
ok('a franchise owner may not decide', !decisionVerdict('FRANCHISE_OWNER', 'PENDING').allowed)
ok('a decided request cannot be decided again', !decisionVerdict('ORGANIZATION_OWNER', 'APPROVED').allowed)
ok('a revoked request cannot be approved', !decisionVerdict('ORGANIZATION_OWNER', 'REVOKED').allowed)
ok('only an approved price is revocable', !revokeVerdict('ORGANIZATION_OWNER', 'PENDING').allowed)
ok('an approved price is revocable by an owner', revokeVerdict('ORGANIZATION_OWNER', 'APPROVED').allowed)
ok('a location manager cannot revoke', !revokeVerdict('LOCATION_MANAGER', 'APPROVED').allowed)

ok('pending is described in words a person uses', statusWords('PENDING') === 'Waiting for a decision')
ok('an unknown state is admitted', /could not be read/i.test(statusWords('SOMETHING')))

ok('money is two decimals', money(1850) === '$18.50')
ok('missing money says so', money(null) === 'Not available')
ok('a rise is described in words', /From \$18\.00 to \$20\.00, \$2\.00 more\./.test(describePriceChange(1800, 2000)))
ok('a cut is described in words', /\$2\.50 less/.test(describePriceChange(2000, 1750)))
ok('no change says the same', /the same/.test(describePriceChange(1800, 1800)))

// --- summaries ------------------------------------------------------------

function row(overrides: Partial<PriceRequestRow>): PriceRequestRow {
  return {
    id: 'r1',
    status: 'PENDING',
    requestedAt: '2026-11-20T12:00:00.000Z',
    templateName: 'Skin fade',
    locationName: 'Downtown',
    standardPriceCents: 1800,
    requestedPriceCents: 2000,
    reason: 'Higher rent.',
    requestedByName: 'Sam',
    approvedByName: null,
    decidedAt: null,
    ...overrides,
  }
}

const emptySummary = summariseRequests([], new Date('2026-11-24T12:00:00.000Z'))
ok('nothing asked is said plainly', /No location has asked/i.test(emptySummary.headline))
ok('an empty list has no age', emptySummary.oldestPendingDays === null)

const onePending = summariseRequests([row({})], new Date('2026-11-24T12:00:00.000Z'))
ok('one waiting is counted', onePending.pending === 1)
ok('its age is counted in days', onePending.oldestPendingDays === 4)
ok('one waiting reads naturally', /One request is waiting/i.test(onePending.headline))

const decided = summariseRequests(
  [row({ id: 'a', status: 'APPROVED' }), row({ id: 'b', status: 'DECLINED' }), row({ id: 'c', status: 'REVOKED' })],
  new Date('2026-11-24T12:00:00.000Z'),
)
ok('decided requests are counted by outcome', decided.approved === 1 && decided.declined === 1 && decided.revoked === 1)
ok('nothing pending says so', /Nothing is waiting/i.test(decided.headline))
ok('no pending means no age', decided.oldestPendingDays === null)

const impact = describeTemplateChange('t1', 'Skin fade', 1800, 2000, 5, 2)
ok('the impact counts locations on the standard price', impact.locationsAtStandardPrice === 3)
ok('approved exceptions are preserved', impact.locationsWithApprovedException === 2)
ok('the note says exceptions keep their price', /keep it/i.test(impact.note))
ok('an unchanged price changes nothing', !describeTemplateChange('t1', 'x', 1800, 1800, 5, 0).changesWhatSomeoneCharges)
ok('a changed price changes what people pay', impact.changesWhatSomeoneCharges)

// --- source guarantees ----------------------------------------------------

const root = join(__dirname, '..')
const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')
ok('requests live in their own table', /model OrganizationServicePriceRequest/.test(schema))
ok('the exception table is not overloaded with request state', !/model OrganizationServicePriceException \{[\s\S]{0,900}status\s+String/.test(schema))

const resolver = readFileSync(join(root, 'src/lib/organization/service-templates.ts'), 'utf8')
ok('the price resolver still applies an approved exception', /source: 'location-exception'/.test(resolver))

const listRoute = readFileSync(join(root, 'src/app/api/dashboard/organization/pricing-requests/route.ts'), 'utf8')
const decideRoute = readFileSync(join(root, 'src/app/api/dashboard/organization/pricing-requests/[id]/route.ts'), 'utf8')
for (const [name, source] of [
  ['list route', listRoute],
  ['decide route', decideRoute],
] as const) {
  ok(`${name} resolves the organization from the session`, /resolveOrganizationContext\(auth\.user\.id\)/.test(source))
  ok(`${name} never reads an organization id from the body`, !/body\.organizationId/.test(source))
  ok(`${name} never reads an organization id from the query`, !/searchParams\.get\('organizationId'\)/.test(source))
}
ok('approval writes the exception and the decision together', /\$transaction/.test(decideRoute) && /organizationServicePriceException\.upsert/.test(decideRoute))
ok('a request cannot be created as approved', !/status: 'APPROVED'/.test(listRoute))
ok('revoking removes the exception', /organizationServicePriceException\.deleteMany/.test(decideRoute))

const locationRoute = readFileSync(join(root, 'src/app/api/dashboard/organization/locations/[id]/route.ts'), 'utf8')
ok('the location route knows the reopening actions', /prepare-reopening/.test(locationRoute))
ok('the location route resolves the organization from the session', /resolveOrganizationContext\(auth\.user\.id\)/.test(locationRoute))

const service = readFileSync(join(root, 'src/lib/organization/location-service.ts'), 'utf8')
ok('reopening records the reason in the audit', /Began reopening/.test(service) && /reason/.test(service))
ok('reopening stamps the row', /reopenedAt/.test(service))
ok('no lifecycle path deletes a location', !/organizationLocation\.delete/.test(service))

console.log(`Reopening and price approvals: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

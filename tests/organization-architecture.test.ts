/**
 * Priorities 2 and 3: the organization layer's rules, pinned.
 *
 * The most important assertion in this file is the one that stops a corporate role from
 * reading an individual customer record. Everything else in the franchise layer depends on
 * that boundary holding, so it is tested from several directions.
 */

import {
  can,
  capabilitiesFor,
  CORPORATE_ROLES,
  CUSTOMER_RECORD_CAPABILITY,
  describeRole,
  isCorporateRole,
  normaliseRole,
  type OrgRole,
} from '../src/lib/organization/capabilities'
import { aggregateOnlyGuard, canReadCustomerRecord, canShareHistoryAcrossLocations, CUSTOMER_LINK_CONSENT_TEXT, IDENTITY_FIELDS } from '../src/lib/organization/privacy'
import { buildOrganizationReport, describeOrganizationReport, REPORT_LABELS, type LocationRollup } from '../src/lib/organization/reporting'
import { describeBrandBoundary, isValidBrandValue, requestLocationOverride, resolveBrandField } from '../src/lib/organization/branding'
import { describeServiceChanges, formatCents, resolveServicePrice, validatePriceException, validateServiceTemplate } from '../src/lib/organization/service-templates'
import { canTransition, checklistFor, CLOSING_STEPS, OPENING_STEPS } from '../src/lib/organization/locations'
import { activeAssignmentsFor, auditEntry, findOverlap, isAssignmentActive, validateAssignment } from '../src/lib/organization/assignments'
import { limitToSenderScope, maySendAnnouncement, resolveAudience, validateAnnouncement } from '../src/lib/organization/announcements'
import { buildConfigAuditEntry, summariseConfigChange } from '../src/lib/organization/config-audit'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; return }
  failed++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const ALL_ROLES: OrgRole[] = ['ORGANIZATION_OWNER', 'CORPORATE_ADMIN', 'REGIONAL_MANAGER', 'FRANCHISE_OWNER', 'LOCATION_MANAGER', 'BARBER', 'CUSTOMER']

// ─── The privacy boundary ──────────────────────────────────────────────────

for (const role of CORPORATE_ROLES) {
  ok(`${role} cannot read an individual customer record`, can(role, CUSTOMER_RECORD_CAPABILITY) === false)
  ok(`${role} is a corporate role`, isCorporateRole(role) === true)
  ok(`${role} can read aggregate reporting`, can(role, 'reporting.aggregate.read') === true)
}
ok('a location manager can read customer records', can('LOCATION_MANAGER', CUSTOMER_RECORD_CAPABILITY) === true)
ok('a barber can read customer records at their location', can('BARBER', CUSTOMER_RECORD_CAPABILITY) === true)
ok('a customer has no organization capabilities', capabilitiesFor('CUSTOMER').length === 0)
ok('an unknown role is refused', normaliseRole('SUPERUSER') === null)
ok('an unknown role normalises to null, not to owner', normaliseRole('') === null)

const corporateRead = canReadCustomerRecord({ role: 'ORGANIZATION_OWNER', recordBusinessId: 'b1', actingBusinessId: 'b1' })
ok('the organization owner is refused a customer record even at their own location', corporateRead.allowed === false)
ok('the refusal explains the separate permission', /separate grant|totals, not individual/i.test(corporateRead.reason))
const managerOther = canReadCustomerRecord({ role: 'LOCATION_MANAGER', recordBusinessId: 'b2', actingBusinessId: 'b1' })
ok('a location manager is refused another location’s customer', managerOther.allowed === false)
const managerOwn = canReadCustomerRecord({ role: 'LOCATION_MANAGER', recordBusinessId: 'b1', actingBusinessId: 'b1' })
ok('a location manager is allowed their own location’s customer', managerOwn.allowed === true)
const self = canReadCustomerRecord({ role: 'CUSTOMER', recordBusinessId: 'b1', actingBusinessId: null, isSelf: true })
ok('a customer may read their own record', self.allowed === true)

const leaky = { locations: [{ name: 'Downtown', customerId: 'c1', metrics: { revenue: 1 } }] }
const guard = aggregateOnlyGuard(leaky)
ok('the aggregate guard finds a customer id', guard.safe === false)
ok('the aggregate guard names the path', guard.offending.some((p) => p.endsWith('customerId')))
const clean = { locations: [{ name: 'Downtown', metrics: { revenue: 1 } }], totals: { netRevenueCents: 100 } }
ok('a clean aggregate passes the guard', aggregateOnlyGuard(clean).safe === true)
ok('the guard knows every identity field', ['email', 'phone', 'firstName', 'lastName'].every((f) => IDENTITY_FIELDS.includes(f)))

const consentText = CUSTOMER_LINK_CONSENT_TEXT
ok('the consent wording says what is shared', /visit history/i.test(consentText))
ok('the consent wording says it can be withdrawn', /withdraw/i.test(consentText))

const link = { customerId: 'c1', businessId: 'b1', organizationId: 'o1', consentText, consentedAt: '2026-01-01T00:00:00.000Z', revokedAt: null }
const shareOk = canShareHistoryAcrossLocations(link, { customerId: 'c1', fromBusinessId: 'b1', toBusinessId: 'b2', organizationId: 'o1' })
ok('history sharing is allowed with consent', shareOk.allowed === true)
const noLink = canShareHistoryAcrossLocations(null, { customerId: 'c1', fromBusinessId: 'b1', toBusinessId: 'b2', organizationId: 'o1' })
ok('history sharing is refused without consent', noLink.allowed === false)
const revoked = canShareHistoryAcrossLocations({ ...link, revokedAt: '2026-02-01T00:00:00.000Z' }, { customerId: 'c1', fromBusinessId: 'b1', toBusinessId: 'b2', organizationId: 'o1' })
ok('history sharing stops when consent is withdrawn', revoked.allowed === false)
const wrongOrg = canShareHistoryAcrossLocations(link, { customerId: 'c1', fromBusinessId: 'b1', toBusinessId: 'b2', organizationId: 'o2' })
ok('history sharing is refused across organizations', wrongOrg.allowed === false)
const unrelatedLocation = canShareHistoryAcrossLocations(link, { customerId: 'c1', fromBusinessId: 'b3', toBusinessId: 'b4', organizationId: 'o1' })
ok('history sharing is refused when the consent names neither location', unrelatedLocation.allowed === false)

// ─── Consolidated reporting ────────────────────────────────────────────────

const base: LocationRollup = {
  businessId: 'b1', name: 'Downtown', region: 'North', status: 'active',
  grossRevenueCents: 100000, refundsCents: 5000, netRevenueCents: 95000,
  commissionsCents: 30000, recordedExpensesCents: null,
  appointments: 40, completed: 35, cancelled: 3,
  newCustomers: 10, returningCustomers: 20,
  activeMemberships: 5, membershipRevenueCents: null,
  utilisationPercent: 62, staffCount: 4,
}
const second: LocationRollup = { ...base, businessId: 'b2', name: 'Uptown', grossRevenueCents: 50000, refundsCents: 0, netRevenueCents: 50000, commissionsCents: 15000 }

const report = buildOrganizationReport('o1', [base, second], { generatedAt: '2026-11-20T00:00:00.000Z', rangeLabel: 'the last 30 days' })
ok('the report totals net revenue across locations', report.totals.netRevenueCents === 145000)
ok('the report totals appointments', report.totals.appointments === 80)
ok('the report has no profit figure', report.totals.profitCents === null)
ok('the report is aggregate only', report.aggregateOnly === true)
ok('the report never contains the word profit as a value', !JSON.stringify(report).toLowerCase().includes('profitcents":1'))
ok('the report labels gross and refunds separately', Boolean(REPORT_LABELS.grossRevenueCents) && Boolean(REPORT_LABELS.refundsCents))
ok('the report labels commissions as not yours to keep', /not yours to keep/i.test(REPORT_LABELS.commissionsCents))
ok('the report labels utilisation as an estimate', /estimate/i.test(REPORT_LABELS.utilisationPercent))
ok('the report explains why there is no profit figure', report.notes.some((n) => /no profit figure/i.test(n)))

const withUnknown = buildOrganizationReport('o1', [base, { ...second, netRevenueCents: null }], { generatedAt: '2026-11-20T00:00:00.000Z', rangeLabel: 'the last 30 days' })
ok('an unreadable location makes the total unknown, not smaller', withUnknown.totals.netRevenueCents === null)
ok('the unknown location is named', withUnknown.unverifiedLocations.includes('Uptown'))
ok('the unknown total is explained', withUnknown.notes.some((n) => /could not be read/i.test(n)))
ok('a report with no locations still describes itself', describeOrganizationReport(buildOrganizationReport('o1', [], { generatedAt: 'x', rangeLabel: 'today' })).includes('0 locations'))

// ─── Branding ──────────────────────────────────────────────────────────────

ok('a hex colour is valid', isValidBrandValue('primaryColor', '#1a1a1a'))
ok('a named colour is not a hex value', isValidBrandValue('primaryColor', 'black') === false)
ok('an https logo is valid', isValidBrandValue('logoUrl', 'https://cdn.example.com/logo.png'))
ok('a javascript logo url is refused', isValidBrandValue('logoUrl', 'javascript:alert(1)') === false)

const settings = { logoUrl: 'https://cdn.example.com/shared.png', primaryColor: '#111111', accentColor: '#d4af37', brandGuidelinesUrl: null, allowedOverrides: ['accentColor'] }
ok('an allowed override is accepted', requestLocationOverride(settings, 'accentColor', '#ff0000').accepted === true)
ok('a disallowed override is refused', requestLocationOverride(settings, 'primaryColor', '#ff0000').accepted === false)
ok('an invalid override value is refused', requestLocationOverride(settings, 'accentColor', 'red').accepted === false)
const resolvedOverride = resolveBrandField(settings, { accentColor: '#ff0000' }, 'accentColor')
ok('an approved override resolves to the location', resolvedOverride.source === 'location' && resolvedOverride.value === '#ff0000')
const resolvedShared = resolveBrandField(settings, { primaryColor: '#ff0000' }, 'primaryColor')
ok('a disallowed location value is ignored', resolvedShared.source === 'organization' && resolvedShared.value === '#111111')
ok('an unset field says unset, not black', resolveBrandField(null, null, 'primaryColor').source === 'unset')
ok('the boundary is explained in words', /may change/i.test(describeBrandBoundary(settings)))

// ─── Services and pricing ──────────────────────────────────────────────────

const template = { id: 't1', name: 'Skin fade', description: null, durationMinutes: 45, defaultPriceCents: 4000, active: true }
const defaultPrice = resolveServicePrice(template, null, 'b1')
ok('no exception means the default price', defaultPrice.priceCents === 4000 && defaultPrice.source === 'default')
const exceptionPrice = resolveServicePrice(template, { templateId: 't1', businessId: 'b1', priceCents: 3500, reason: 'Senior barber', approvedById: 'u1' }, 'b1')
ok('an exception changes the location price', exceptionPrice.priceCents === 3500 && exceptionPrice.source === 'location-exception')
ok('the exception explains itself', /Senior barber/.test(exceptionPrice.explanation))
const otherLocation = resolveServicePrice(template, { templateId: 't1', businessId: 'b1', priceCents: 3500, reason: 'x', approvedById: 'u1' }, 'b2')
ok('another location does not inherit the exception', otherLocation.priceCents === 4000)
ok('money is formatted for a person', formatCents(4000).includes('40'))

ok('a service needs a name', validateServiceTemplate({ durationMinutes: 30, defaultPriceCents: 100 }).valid === false)
ok('a service needs a positive duration', validateServiceTemplate({ name: 'Cut', durationMinutes: 0, defaultPriceCents: 100 }).valid === false)
ok('a negative price is refused', validateServiceTemplate({ name: 'Cut', durationMinutes: 30, defaultPriceCents: -1 }).valid === false)
ok('a complete service validates', validateServiceTemplate({ name: 'Cut', durationMinutes: 30, defaultPriceCents: 100 }).valid === true)
ok('an exception needs a reason', validatePriceException({ priceCents: 3000, approvedById: 'u1' }).valid === false)
ok('an exception needs an approver', validatePriceException({ priceCents: 3000, reason: 'x' }).valid === false)

const changed = describeServiceChanges(template, { ...template, defaultPriceCents: 4500, durationMinutes: 50 })
ok('a price change is recorded', changed.some((c) => c.field === 'defaultPriceCents' && c.after.includes('45')))
ok('a duration change is recorded', changed.some((c) => c.field === 'durationMinutes'))
ok('an unchanged field is not recorded', !changed.some((c) => c.field === 'name'))

// ─── Location lifecycle ────────────────────────────────────────────────────

ok('onboarding can become active', canTransition('onboarding', 'active').allowed === true)
ok('active cannot jump straight to closed', canTransition('active', 'closed').allowed === false)
ok('active can begin closing', canTransition('active', 'closing').allowed === true)
ok('closing can go back to active', canTransition('closing', 'active').allowed === true)
ok('closed cannot reopen', canTransition('closed', 'active').allowed === false)
ok('the refusal explains a closed location', /reopen/i.test(canTransition('closed', 'active').reason))
ok('a closed location may begin reopening', canTransition('closed', 'reopening').allowed)
ok('reopening must pass through onboarding', canTransition('reopening', 'active').allowed === false && canTransition('reopening', 'onboarding').allowed)
ok('reopening can be abandoned back to closed', canTransition('reopening', 'closed').allowed)
ok('onboarding offers the opening checklist', checklistFor('onboarding') === OPENING_STEPS)
ok('closing offers the closing checklist', checklistFor('closing') === CLOSING_STEPS)
ok('an active location needs no checklist', checklistFor('active').length === 0)
for (const step of [...OPENING_STEPS, ...CLOSING_STEPS]) {
  ok(`checklist step ${step.key} says what it does`, step.whatItDoes.length > 0)
  ok(`checklist step ${step.key} says what changes`, step.whatChanges.length > 0)
  ok(`checklist step ${step.key} says who may do it`, step.whoMayDoIt.length > 0)
  ok(`checklist step ${step.key} says whether it can be undone`, step.canBeUndone.length > 0)
  ok(`checklist step ${step.key} says what happens if it goes wrong`, step.ifSomethingGoesWrong.length > 0)
}

// ─── Assignments ───────────────────────────────────────────────────────────

const at = new Date('2026-11-20T12:00:00.000Z')
ok('an open assignment is active after its start', isAssignmentActive({ effectiveFrom: '2026-11-01T00:00:00.000Z', effectiveTo: null }, at) === true)
ok('an assignment is not active before its start', isAssignmentActive({ effectiveFrom: '2026-12-01T00:00:00.000Z', effectiveTo: null }, at) === false)
ok('an ended assignment is not active', isAssignmentActive({ effectiveFrom: '2026-10-01T00:00:00.000Z', effectiveTo: '2026-11-01T00:00:00.000Z' }, at) === false)
ok('an assignment needs a person', validateAssignment({ businessId: 'b1', role: 'BARBER', effectiveFrom: '2026-11-01T00:00:00.000Z' }).valid === false)
ok('an assignment needs a known role', validateAssignment({ userId: 'u1', businessId: 'b1', role: 'WIZARD', effectiveFrom: '2026-11-01T00:00:00.000Z' }).valid === false)
ok('an end before the start is refused', validateAssignment({ userId: 'u1', businessId: 'b1', role: 'BARBER', effectiveFrom: '2026-11-10T00:00:00.000Z', effectiveTo: '2026-11-01T00:00:00.000Z' }).valid === false)
ok('a clean assignment validates', validateAssignment({ userId: 'u1', businessId: 'b1', role: 'BARBER', effectiveFrom: '2026-11-10T00:00:00.000Z' }).valid === true)

const existing = [{ userId: 'u1', businessId: 'b1', role: 'BARBER', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null, createdById: null }]
ok('an overlapping assignment is found', findOverlap(existing, { userId: 'u1', businessId: 'b1', effectiveFrom: '2026-06-01T00:00:00.000Z', effectiveTo: null }) !== null)
ok('an assignment at another location does not overlap', findOverlap(existing, { userId: 'u1', businessId: 'b2', effectiveFrom: '2026-06-01T00:00:00.000Z', effectiveTo: null }) === null)
ok('a non-overlapping period is clean', findOverlap(existing, { userId: 'u1', businessId: 'b1', effectiveFrom: '2025-01-01T00:00:00.000Z', effectiveTo: '2025-06-01T00:00:00.000Z' }) === null)
ok('active assignments are filtered by person and time', activeAssignmentsFor(existing, 'u1', at).length === 1)
const ending = auditEntry('assignment.ended', existing[0], at.toISOString())
ok('ending an assignment says access stops', /loses access/i.test(ending.summary))

// ─── Announcements ─────────────────────────────────────────────────────────

const locations = [
  { businessId: 'b1', region: 'North', status: 'active' },
  { businessId: 'b2', region: 'South', status: 'active' },
  { businessId: 'b3', region: 'North', status: 'closed' },
]
ok('an all-locations audience excludes closed locations', resolveAudience({ type: 'all', values: [] }, locations).businessIds.join(',') === 'b1,b2')
ok('a region audience matches by name', resolveAudience({ type: 'region', values: ['north'] }, locations).businessIds.join(',') === 'b1')
ok('a location audience matches by id', resolveAudience({ type: 'location', values: ['b2'] }, locations).businessIds.join(',') === 'b2')
ok('an unknown location id is dropped', resolveAudience({ type: 'location', values: ['b9'] }, locations).empty === true)
ok('an empty audience is reported as empty', resolveAudience({ type: 'region', values: ['West'] }, locations).empty === true)

ok('a barber cannot send an announcement', maySendAnnouncement('BARBER').allowed === false)
ok('a corporate admin can send an announcement', maySendAnnouncement('CORPORATE_ADMIN').allowed === true)
ok('an announcement needs a title and body', validateAnnouncement({ audience: { type: 'all', values: [] } }).valid === false)
ok('a targeted announcement needs a target', validateAnnouncement({ title: 'x', body: 'y', audience: { type: 'region', values: [] } }).valid === false)
ok('a complete announcement validates', validateAnnouncement({ title: 'x', body: 'y', audience: { type: 'all', values: [] } }).valid === true)
const limited = limitToSenderScope(['b1', 'b2', 'b3'], ['b1', 'b2'])
ok('a sender cannot reach outside their scope', limited.businessIds.join(',') === 'b1,b2' && limited.dropped === 1)

// ─── Configuration audit ───────────────────────────────────────────────────

const entry = buildConfigAuditEntry({
  organizationId: 'o1', actorId: 'u1', action: 'branding.update', entity: 'OrganizationBrandSettings', entityId: 's1',
  summary: 'Changed the shared logo.', previousValue: { logoUrl: 'https://a.example/old.png' },
  newValue: { logoUrl: 'https://a.example/new.png', apiKey: 'sk_live_abcdefghijklmnop' },
  at: '2026-11-20T12:00:00.000Z',
})
ok('a config change records who did it', entry.actorId === 'u1')
ok('a config change records what it was', Boolean(entry.previousValue))
ok('a config change redacts a secret', !JSON.stringify(entry).includes('sk_live_abcdefghijklmnop'))
const summary = summariseConfigChange({ logoUrl: 'a', color: '#111' }, { logoUrl: 'b', color: '#111' })
ok('a change summary names the changed field', summary.changedFields.includes('logoUrl'))
ok('a change summary ignores an unchanged field', !summary.changedFields.includes('color'))
ok('an unchanged configuration says so', summariseConfigChange({ a: 1 }, { a: 1 }).headline === 'Nothing changed.')
ok('every role has a description', ALL_ROLES.every((r) => describeRole(r).length > 10))

console.log(`\nOrganization architecture: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

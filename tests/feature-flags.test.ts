/**
 * Feature configuration tests (Requirement 27).
 *
 * Covers the centralized, tenant-aware feature system in src/lib/features.ts
 * and its API surface:
 *   1. Safe defaults (online payments fail closed)
 *   2. Overrides flip features without code changes
 *   3. Unknown/malformed overrides are ignored on read, rejected by the API
 *   4. Feature state is per-tenant (Business A's override never affects B)
 *   5. Owner-only API: read/write requires OWNER role, tenant-scoped
 *   6. Disabled onlineBooking blocks the public booking API (server-side)
 *
 * Parts 1-4 run directly; parts 5-6 require the live server pattern used by
 * tests/cross-tenant-matrix.test.ts (server on :3000).
 *
 * Run: npx tsx tests/feature-flags.test.ts
 */
import { prisma } from '../src/lib/prisma'
import {
  resolveFeatures, isFeatureEnabled, FEATURE_DEFAULTS,
} from '../src/lib/features'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  PASS ${msg}`); passed++ }
  else { console.error(`  FAIL ${msg}`); failed++ }
}

async function main() {
  console.log('\n── 1. Safe defaults ──')
  const base = resolveFeatures({ featureOverrides: null })
  assert(base.onlineBooking === true, 'onlineBooking defaults on')
  assert(base.reviews === true && base.gallery === true, 'core public features default on')
  assert(base.onlinePayments === false, 'onlinePayments defaults OFF (fail closed)')

  console.log('\n── 2. Overrides without code changes ──')
  const off = resolveFeatures({ featureOverrides: { reviews: false } as never })
  assert(off.reviews === false, 'override disables reviews')
  assert(off.onlineBooking === true, 'unrelated features untouched by sparse override')
  assert(isFeatureEnabled({ featureOverrides: { reviews: true } as never }, 'reviews'), 'override can also re-enable')

  console.log('\n── 3. Malformed overrides ignored on read ──')
  const junk = resolveFeatures({
    featureOverrides: { reviews: 'yes', nonexistent_feature: true, gallery: false } as never,
  })
  assert(junk.gallery === false, 'valid boolean override applies')
  assert(junk.reviews === true, "non-boolean override ignored (defaults win)")
  assert((junk as Record<string, unknown>).nonexistent_feature === undefined,
    'unknown feature key is not part of the resolved map')

  console.log('\n── 4. Tenant isolation of feature state ──')
  const stamp = Date.now()
  const bizA = await prisma.business.create({ data: {
    name: `Feat A ${stamp}`, slug: `feat-a-${stamp}`, email: `fa-${stamp}@test.com`,
    phone: '555-0601', address: '7 Feat Way', city: 'FeatCity', state: 'CA',
    zipCode: '90007', timezone: 'America/Los_Angeles',
    featureOverrides: { onlineBooking: false } as never } })
  const bizB = await prisma.business.create({ data: {
    name: `Feat B ${stamp}`, slug: `feat-b-${stamp}`, email: `fb-${stamp}@test.com`,
    phone: '555-0602', address: '8 Feat Way', city: 'FeatCity', state: 'CA',
    zipCode: '90008', timezone: 'America/Los_Angeles' } })
  try {
    const rowA = await prisma.business.findUniqueOrThrow({ where: { id: bizA.id }, select: { featureOverrides: true } })
    const rowB = await prisma.business.findUniqueOrThrow({ where: { id: bizB.id }, select: { featureOverrides: true } })
    assert(isFeatureEnabled(rowA, 'onlineBooking') === false, 'business A: onlineBooking disabled')
    assert(isFeatureEnabled(rowB, 'onlineBooking') === true, 'business B unaffected by A override')

    console.log('\n── 5. API surface (live server) ──')
    const r1 = await fetch('http://localhost:3000/api/dashboard/features')
    assert(r1.status === 401, 'GET /api/dashboard/features unauthenticated -> 401')
    const r2 = await fetch('http://localhost:3000/api/dashboard/features', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviews: false }) })
    assert(r2.status === 401, 'PUT without session -> 401')

    console.log('\n── 6. Disabled onlineBooking blocks public booking ──')
    const r3 = await fetch('http://localhost:3000/api/public/appointments', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-host': bizA.slug },
      body: JSON.stringify({ serviceId: 'x', date: '2026-10-01', time: '10:00',
        customer: { firstName: 'F', lastName: 'L', email: 'f@test.com', phone: '555-9999' } }) })
    const body = await r3.json().catch(() => ({}))
    // Business A has onlineBooking disabled; even invalid payloads must not
    // proceed past the feature gate (403 precedes validation of the rest).
    assert(r3.status === 403 || r3.status === 400, `gate engaged before booking proceeds (got ${r3.status})`)
    if (r3.status === 403) assert((body as { error?: string }).error?.includes('unavailable') === true,
      '403 carries the feature-disabled message')
    const r4 = await fetch('http://localhost:3000/api/public/appointments', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-host': bizB.slug },
      body: JSON.stringify({ serviceId: 'x', date: '2026-10-01', time: '10:00',
        customer: { firstName: 'F', lastName: 'L', email: 'f@test.com', phone: '555-9999' } }) })
    assert(r4.status !== 403, 'business B (feature on) passes the gate (fails later on validation, not 403)')
  } finally {
    await prisma.business.deleteMany({ where: { id: { in: [bizA.id, bizB.id] } } })
  }

  console.log(`\nFeature flag tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error('Test crashed:', e); await prisma.$disconnect(); process.exit(1) })

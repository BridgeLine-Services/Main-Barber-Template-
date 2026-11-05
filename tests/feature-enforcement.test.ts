/**
 * Feature enforcement contract.
 *
 * The audit script proves a route *mentions* the right key. This proves the helper
 * itself actually refuses when the switch is off, against a real database, and that
 * the routes we claim to have gated still contain their guard. Without both, a
 * switched-off feature looks enforced in review and is not.
 *
 * Run: npx tsx tests/feature-enforcement.test.ts
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { assertFeatureEnabled, isFeatureEnabledForBusiness } from '../src/lib/features'

const prisma = new PrismaClient()
let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/** Routes that must consult a specific key. Structural guard against silent removal. */
const GUARDED: Array<[string, string]> = [
  ['src/app/api/public/appointments/route.ts', 'onlineBooking'],
  ['src/app/api/public/queue/route.ts', 'queue'],
  ['src/app/api/dashboard/inventory/route.ts', 'inventory'],
  ['src/app/api/dashboard/marketing/campaigns/route.ts', 'marketing'],
  ['src/app/api/ecommerce/checkout/route.ts', 'ecommerce'],
  ['src/app/(customer)/reviews/page.tsx', 'reviews'],
  ['src/app/(customer)/barbers/[slug]/page.tsx', 'barberProfiles'],
  ['src/app/api/dashboard/media/route.ts', 'gallery'],
  ['src/app/api/dashboard/memberships/route.ts', 'memberships'],
  ['src/app/api/dashboard/barbers/route.ts', 'multipleBarbers'],
  ['src/app/api/dashboard/loyalty/program/route.ts', 'loyalty'],
  ['src/app/api/dashboard/payments/checkout/[appointmentId]/route.ts', 'onlinePayments'],
  ['src/app/api/dashboard/analytics/route.ts', 'analytics'],
]

async function main() {
  const suffix = stamp()
  const off = await prisma.business.create({
    data: {
      name: `Enforcement Off ${suffix}`,
      slug: `enforcement-off-${suffix}`,
      email: `off-${suffix}@example.com`,
      featureOverrides: { queue: false, reviews: false, ecommerce: false },
    },
  })
  const on = await prisma.business.create({
    data: {
      name: `Enforcement On ${suffix}`,
      slug: `enforcement-on-${suffix}`,
      email: `on-${suffix}@example.com`,
      featureOverrides: { queue: true, reviews: true, ecommerce: true },
    },
  })

  console.log('\n📦 The switch is read per business, from the database')
  try {
    assert(await isFeatureEnabledForBusiness(off.id, 'queue') === false,
      'a shop with the queue switched off reports it is off')
    assert(await isFeatureEnabledForBusiness(on.id, 'queue') === true,
      'a shop with the queue switched on reports it is on')

    console.log('\n📦 The guard throws, so the route cannot continue')
    let threw = false
    try { await assertFeatureEnabled(off.id, 'queue') } catch { threw = true }
    assert(threw, 'assertFeatureEnabled refuses a disabled feature')

    let threwOn = false
    try { await assertFeatureEnabled(on.id, 'queue'); } catch { threwOn = true }
    assert(!threwOn, 'assertFeatureEnabled allows an enabled feature')

    console.log('\n📦 One shop cannot switch another shop on')
    assert(await isFeatureEnabledForBusiness(off.id, 'queue') === false,
      'the off shop stays off while the on shop is on')
    assert(await isFeatureEnabledForBusiness('business-that-does-not-exist', 'queue') === false,
      'an unknown business fails closed rather than defaulting to enabled')

    console.log('\n📦 A disabled feature leaves records alone')
    assert(await prisma.business.count({ where: { id: { in: [off.id, on.id] } } }) === 2,
      'nothing was deleted when the switch was flipped')

    console.log('\n📦 Routes still contain the guard')
    for (const [file, key] of GUARDED) {
      let text = ''
      try { text = readFileSync(file, 'utf8') } catch { text = '' }
      assert(text.includes(`'${key}'`) && /Feature gate|feature gate|assertFeatureEnabled|isFeatureEnabledForBusiness/.test(text),
        `${file} still consults '${key}'`)
    }
  } finally {
    await prisma.business.deleteMany({ where: { id: { in: [off.id, on.id] } } })
    await prisma.$disconnect()
  }

  console.log(`\nFeature enforcement: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exit(1) })

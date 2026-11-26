/**
 * Cross-tenant isolation, against a real database (Section 5 of the platform brief).
 *
 * These are the assertions a static check cannot make: two shops, one database, and proof
 * that neither can read, change or delete the other's customers through the tenant helper.
 * Without DATABASE_URL the suite says so and exits clean rather than pretending.
 */
import { prisma } from '../src/lib/prisma'
import { TenantContextError, assertTenantId, withTenant } from '../src/lib/tenant-context'

let pass = 0
let fail = 0
function ok(name: string, condition: boolean) {
  if (condition) pass++
  else {
    fail++
    console.error('  FAIL', name)
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('Tenant isolation: skipped (no DATABASE_URL). Runs in CI against Postgres.')
    return
  }

  const stamp = Date.now()
  const shopA = await prisma.business.create({
    data: { name: `Tenant A ${stamp}`, slug: `tenant-a-${stamp}`, phone: '5550000001', email: `a${stamp}@example.test` },
  })
  const shopB = await prisma.business.create({
    data: { name: `Tenant B ${stamp}`, slug: `tenant-b-${stamp}`, phone: '5550000002', email: `b${stamp}@example.test` },
  })

  try {
    const customerA = await prisma.customer.create({
      data: { businessId: shopA.id, firstName: 'Alice', lastName: 'A', phone: '5551110001', email: `alice${stamp}@example.test` },
    })
    const customerB = await prisma.customer.create({
      data: { businessId: shopB.id, firstName: 'Bob', lastName: 'B', phone: '5551110002', email: `bob${stamp}@example.test` },
    })

    const seenByA = await withTenant(shopA.id, (tx) => tx.customer.findMany({ where: { businessId: shopA.id }, select: { id: true } }))
    const seenByB = await withTenant(shopB.id, (tx) => tx.customer.findMany({ where: { businessId: shopB.id }, select: { id: true } }))

    ok('shop A reads its own customer', seenByA.some((row) => row.id === customerA.id))
    ok('shop A cannot read shop B through its own scope', !seenByA.some((row) => row.id === customerB.id))
    ok('shop B reads its own customer', seenByB.some((row) => row.id === customerB.id))
    ok('shop B cannot read shop A through its own scope', !seenByB.some((row) => row.id === customerA.id))

    const crossUpdate = await withTenant(shopA.id, (tx) =>
      tx.customer.updateMany({ where: { id: customerB.id, businessId: shopA.id }, data: { firstName: 'Hijacked' } }),
    )
    ok('shop A cannot update shop B customer', crossUpdate.count === 0)

    const crossDelete = await withTenant(shopA.id, (tx) =>
      tx.customer.deleteMany({ where: { id: customerB.id, businessId: shopA.id } }),
    )
    ok('shop A cannot delete shop B customer', crossDelete.count === 0)

    const stillThere = await prisma.customer.findUnique({ where: { id: customerB.id }, select: { firstName: true } })
    ok('shop B customer is untouched', stillThere?.firstName === 'Bob')

    let threw = false
    try {
      await withTenant('', (tx) => tx.customer.count())
    } catch (error) {
      threw = error instanceof TenantContextError
    }
    ok('missing tenant context fails closed', threw)

    let invalidThrew = false
    try {
      assertTenantId('not a valid id!')
    } catch (error) {
      invalidThrew = error instanceof TenantContextError
    }
    ok('invalid tenant id is refused', invalidThrew)
  } finally {
    await prisma.customer.deleteMany({ where: { businessId: { in: [shopA.id, shopB.id] } } }).catch(() => {})
    await prisma.business.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } }).catch(() => {})
    await prisma.$disconnect()
  }

  console.log(`Tenant isolation: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('Tenant isolation could not run:', error instanceof Error ? error.message : 'unknown error')
  process.exitCode = 1
})

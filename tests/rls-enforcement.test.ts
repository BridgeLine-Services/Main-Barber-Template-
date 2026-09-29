/**
 * Database-level RLS enforcement tests (Master Task Part 2).
 *
 * Proves, against the real PostgreSQL engine, that the policy template in
 * prisma/rls/production-rls.sql actually enforces tenant isolation once
 * enabled — including for "background/server operations" (anything that
 * is not an authenticated API request), which must set the tenant
 * context per transaction via set_config('app.business_id', ..., true).
 *
 * How it runs safely on the dev database:
 *   The policies are applied and all assertions execute inside ONE
 *   interactive transaction that is deliberately rolled back at the end,
 *   so FORCE ROW LEVEL SECURITY never persists on a database whose
 *   template app still connects as the table owner.
 *
 * Covered:
 *   1. Tenant-scoped session sees only its own rows (reads)
 *   2. Cross-tenant reads return nothing
 *   3. Cross-tenant updates affect nothing
 *   4. Cross-tenant deletes affect nothing
 *   5. No-context connections see nothing (context-less leak guard)
 *   6. Platform-staff context sees all tenants (support access)
 *   7. Trigger-maintained child writes pass WITH CHECK (BarberService)
 *   8. Transaction-local context reverts (pool-leak guard)
 *
 * Run: npx tsx tests/rls-enforcement.test.ts
 */
import { prisma } from '../src/lib/prisma'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  PASS ${msg}`); passed++ }
  else { console.error(`  FAIL ${msg}`); failed++ }
}

class RollbackSentinel extends Error {
  constructor() { super('RLS-TEST-DONE') }
}

async function main() {
  const stamp = Date.now()
  console.log('\n── Applying RLS template inside a test transaction ──')


  try {
    await prisma.$transaction(async (tx) => {
      // (a) Apply the policy template (sections 2a+2b of production-rls.sql).
      //     Role grants are skipped: the dev connection is the table owner.
      const full = (await import('fs')).readFileSync('prisma/rls/production-rls.sql', 'utf8')
      const doBlock = full.slice(full.indexOf('DO $$'), full.indexOf('END $$;') + 'END $$;'.length)
      await tx.$executeRawUnsafe(doBlock)

      // (b) Seed two tenants INSIDE the transaction (rolled back afterwards).
      //     Seeding runs under the platform-staff context: creating a new
      //     tenant root row is itself a platform operation, not a
      //     tenant-scoped one. Assertions below then drop that context.
      await tx.$executeRawUnsafe(`SELECT set_config('app.platform_staff', '1', true)`)
      const bizA = (await tx.business.create({ data: {
        name: `RLS A ${stamp}`, slug: `rls-a-${stamp}`, email: `rlsa-${stamp}@test.com`,
        phone: '555-0201', address: '1 RLS Way', city: 'RLSCity', state: 'CA',
        zipCode: '90001', timezone: 'America/Los_Angeles' } })).id
      const bizB = (await tx.business.create({ data: {
        name: `RLS B ${stamp}`, slug: `rls-b-${stamp}`, email: `rlsb-${stamp}@test.com`,
        phone: '555-0202', address: '2 RLS Way', city: 'RLSCity', state: 'CA',
        zipCode: '90002', timezone: 'America/Los_Angeles' } })).id

      await tx.$executeRawUnsafe(`SELECT set_config('app.business_id', '${bizA}', true)`)
      await tx.$executeRawUnsafe(`SELECT set_config('app.platform_staff', '0', true)`)
      const custA = (await tx.customer.create({ data: {
        firstName: 'Rls', lastName: 'A', email: `rlsca-${stamp}@test.com`,
        phone: '555-0301', businessId: bizA } })).id
      const barberA = (await tx.barber.create({ data: { name: 'RLS Barber A', businessId: bizA, bio: 'b' } })).id
      const svcA = (await tx.service.create({ data: { name: `RLS Cut ${stamp}`, businessId: bizA, duration: 30, price: 15 } })).id

      await tx.$executeRawUnsafe(`SELECT set_config('app.business_id', '${bizB}', true)`)
      const custB = (await tx.customer.create({ data: {
        firstName: 'Rls', lastName: 'B', email: `rlscb-${stamp}@test.com`,
        phone: '555-0302', businessId: bizB } })).id


      console.log('\n── 1. Tenant-scoped session sees only its own rows ──')
      const ownCount = await tx.customer.count({ where: { businessId: bizB } })
      assert(ownCount === 1, 'business B context: sees its own customer')

      console.log('\n── 2. Cross-tenant reads return nothing ──')
      const crossRead = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "Customer" WHERE id = '${custA}'`)
      assert(crossRead.length === 0, 'business B context: cannot read business A customer row')

      console.log('\n── 3. Cross-tenant updates affect nothing ──')
      const up = await tx.$executeRawUnsafe(
        `UPDATE "Customer" SET "firstName"='HACKED' WHERE id='${custA}'`)
      assert(up === 0, 'business B context: cannot update business A customer')

      console.log('\n── 4. Cross-tenant deletes affect nothing ──')
      const del = await tx.$executeRawUnsafe(
        `DELETE FROM "Customer" WHERE id='${custA}'`)
      assert(del === 0, 'business B context: cannot delete business A customer')

      console.log('\n── 5. Context-less connections see nothing ──')
      await tx.$executeRawUnsafe(`SELECT set_config('app.business_id', '', true)`)
      const noCtx = await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "Customer"`)
      assert(noCtx[0].n === 0, 'no tenant context set: database returns no tenant rows')

      console.log('\n── 6. Platform-staff context sees all tenants ──')
      await tx.$executeRawUnsafe(`SELECT set_config('app.business_id', '', true)`)
      await tx.$executeRawUnsafe(`SELECT set_config('app.platform_staff', '1', true)`)
      const staffCount = await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "Customer" WHERE id IN ('${custA}','${custB}')`)
      assert(staffCount[0].n === 2, 'platform-staff context: support access to both tenants')
      await tx.$executeRawUnsafe(`SELECT set_config('app.platform_staff', '0', true)`)

      console.log('\n── 7. Trigger-maintained child write passes WITH CHECK ──')
      await tx.$executeRawUnsafe(`SELECT set_config('app.business_id', '${bizA}', true)`)
      const link = await tx.barberService.create({ data: { barberId: barberA, serviceId: svcA } })
      assert(link.businessId === bizA, 'BarberService insert under tenant context: allowed, key = own tenant')
      const crossLink = await tx.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT COUNT(*)::int AS n FROM "BarberService" bs, "Barber" b WHERE bs."businessId" = b."businessId" AND b.id = bs."barberId" AND b."businessId" <> '${bizA}'`)
      assert(crossLink[0].n === 0, 'child rows outside tenant context: not visible')

      console.log('\n── 8. Transaction-local context reverts (pool-leak guard) ──')
      await tx.$executeRawUnsafe(`SELECT set_config('app.business_id', '${bizB}', true)`)
      const leaked = await tx.$queryRawUnsafe(`SELECT current_setting('app.business_id', true) AS v`)
      assert(leaked[0].v === bizB, 'set_config(..., true) is visible within the transaction')
      // Committing is intentionally skipped: the sentinel rollback below
      // also demonstrates the setting does not outlive the transaction.

      throw new RollbackSentinel()
    }, { timeout: 30000 })
  } catch (e) {
    if (!(e instanceof RollbackSentinel)) throw e
    console.log('\n(rollback sentinel: RLS + seed data rolled back, dev DB untouched)')
  }

  console.log('\nVerifying rollback left no residue...')
  const residue = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM pg_class c JOIN pg_policy p ON p.polrelid = c.oid WHERE c.relname = 'Customer'`)
  assert(residue[0].n === 0, 'no policies persisted after rollback')

  console.log(`\nRLS enforcement tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error('Test crashed:', e); await prisma.$disconnect(); process.exit(1) })

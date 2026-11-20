/**
 * Gift-card RLS reconciliation report.
 *
 * The `add_gift_cards` migration turned on Row-Level Security for three tables but, like
 * every other table, left the policies to the staged plan in `prisma/rls/production-rls.sql`.
 * On the owner connection that is harmless, because a table owner bypasses RLS. The moment
 * the runtime is switched to `barber_app` it stops being harmless: a table with RLS on and no
 * policy returns nothing, so gift cards would silently stop working.
 *
 * This script finds that exact state and prints the policy that closes it. It is
 * report-only by design: applying a policy is a production change and belongs in a reviewed
 * migration, not in a script someone ran to see what was wrong.
 *
 *   npx tsx scripts/rls-reconcile.ts             # report
 *   npx tsx scripts/rls-reconcile.ts --enforce   # exit 1 when a table has RLS but no policy
 */
import { PrismaClient } from '@prisma/client'

interface GapRow {
  relname: string
  rls: boolean
  policies: number
}

async function main() {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL
  if (!url) {
    console.error('No database URL configured')
    process.exit(1)
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  const enforce = process.argv.includes('--enforce')

  try {
    const rows = await prisma.$queryRawUnsafe<GapRow[]>(`
      SELECT c.relname,
             c.relrowsecurity AS rls,
             COUNT(p.polname)::int AS policies
        FROM pg_class c
        LEFT JOIN pg_policy p ON p.polrelid = c.oid
       WHERE c.relkind = 'r'
         AND c.relnamespace = 'public'::regnamespace
       GROUP BY c.relname, c.relrowsecurity
      HAVING c.relrowsecurity = true AND COUNT(p.polname) = 0
       ORDER BY c.relname`)

    if (rows.length === 0) {
      console.log('No table has Row-Level Security enabled without a policy. Nothing to reconcile.')
      return
    }

    console.log(`${rows.length} table${rows.length === 1 ? '' : 's'} have Row-Level Security enabled and no policy:\n`)
    for (const row of rows) {
      console.log(`  ${row.relname}`)
      console.log(`    -- closes the gap for ${row.relname} (review, then apply in a migration)`)
      console.log(`    ALTER TABLE "${row.relname}" FORCE ROW LEVEL SECURITY;`)
      console.log(`    DROP POLICY IF EXISTS tenant_isolation ON "${row.relname}";`)
      console.log(`    CREATE POLICY tenant_isolation ON "${row.relname}"`)
      console.log(`      USING ("businessId" = NULLIF(current_setting('app.current_business_id', true), ''))`)
      console.log(`      WITH CHECK ("businessId" = NULLIF(current_setting('app.current_business_id', true), ''));`)
      console.log('')
    }
    console.log('Nothing was changed. Until these policies exist, the runtime must stay on the owner role.')
    if (enforce) {
      console.log('--enforce set: failing.')
      process.exitCode = 1
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

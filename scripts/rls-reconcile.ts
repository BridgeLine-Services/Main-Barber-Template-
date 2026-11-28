/**
 * Report-only RLS status for tables that have RLS enabled but lack FORCE or a
 * recognized tenant policy. It never writes SQL or infers its target from the
 * application's ordinary database connection.
 *
 * Set RLS_RECONCILIATION_DATABASE_URL only in a positively identified
 * disposable/staging environment, then run:
 *   npx tsx scripts/rls-reconcile.ts
 *   npx tsx scripts/rls-reconcile.ts --enforce
 */
import { PrismaClient } from '@prisma/client'

interface GapRow {
  relname: string
  rls: boolean
  forced: boolean
  policies: number
}

async function main() {
  const url = process.env.RLS_RECONCILIATION_DATABASE_URL
  if (!url) {
    console.error('Set RLS_RECONCILIATION_DATABASE_URL to a positively identified disposable or staging database')
    process.exit(1)
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  const enforce = process.argv.includes('--enforce')

  try {
    const rows = await prisma.$queryRawUnsafe<GapRow[]>(`
      SELECT c.relname,
             c.relrowsecurity AS rls,
             c.relforcerowsecurity AS forced,
             COUNT(p.polname) FILTER (WHERE p.polname IN ('tenant_isolation', 'organization_isolation'))::int AS policies
        FROM pg_class c
        LEFT JOIN pg_policy p ON p.polrelid = c.oid
       WHERE c.relkind = 'r'
         AND c.relnamespace = 'public'::regnamespace
       GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
      HAVING c.relrowsecurity = true
         AND (c.relforcerowsecurity = false OR COUNT(p.polname) FILTER (WHERE p.polname IN ('tenant_isolation', 'organization_isolation')) = 0)
       ORDER BY c.relname`)

    if (rows.length === 0) {
      console.log('No enabled table is missing FORCE RLS or all policies. This report does not prove complete model coverage.')
      return
    }

    console.log(`${rows.length} table${rows.length === 1 ? '' : 's'} have enabled RLS but are missing FORCE RLS or every policy:\n`)
    for (const row of rows) {
      console.log(`  ${row.relname}${row.forced ? '' : ' (FORCE RLS disabled)'}${row.policies > 0 ? '' : ' (no policy)'}`)
      console.log('    Review the model classification and corresponding policy in prisma/rls/production-rls.sql; no generic SQL is safe for every tenant key.')
      console.log('')
    }
    console.log('Nothing was changed. Do not switch the runtime role or enable RLS until the exact policy gap is resolved and verified on isolated staging.')
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

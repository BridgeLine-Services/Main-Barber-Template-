/**
 * Applies prisma/rls/production-rls.sql to a production database.
 *
 * Purpose (Master Task Part 2): make database-level tenant isolation a
 * real, reproducible deployment step instead of a SQL file a human must
 * remember to run.
 *
 * Usage:
 *   DATABASE_ADMIN_URL=<owner-role connection URL> npx tsx scripts/apply-rls.ts
 *
 * Safety rules:
 *  - Requires DATABASE_ADMIN_URL (the migration/owner connection), NOT
 *    the runtime DATABASE_URL. The script refuses to run against the
 *    runtime connection, because enabling FORCE ROW LEVEL SECURITY
 *    while the app still connects as the table owner would break every
 *    query. First switch the app to the dedicated runtime role and the
 *    per-transaction `set_config('app.business_id', ...)` pattern —
 *    see docs/TENANT-ISOLATION.md §"Database-level RLS".
 *  - Role names default to barbershop_owner / barbershop_app per the
 *    template; override with RLS_APP_ROLE / RLS_OWNER_ROLE env vars.
 */
import { PrismaClient } from '@prisma/client'

const adminUrl = process.env.DATABASE_ADMIN_URL
if (!adminUrl) {
  console.error(
    'Refusing to run: DATABASE_ADMIN_URL is not set.\n' +
    'Set it to the migrations/owner connection string of the PRODUCTION\n' +
    'database (not the runtime DATABASE_URL), and read the prerequisites\n' +
    'at the top of prisma/rls/production-rls.sql and docs/TENANT-ISOLATION.md\n' +
    'before applying. The runtime role must already be provisioned and the\n' +
    'application must already be switched to it.'
  )
  process.exit(1)
}
if (adminUrl === process.env.DATABASE_URL) {
  console.error('Refusing to run: DATABASE_ADMIN_URL equals DATABASE_URL.')
  process.exit(1)
}

const appRole = process.env.RLS_APP_ROLE ?? 'barbershop_app'

async function main() {
  const { readFileSync } = await import('fs')
  let sql = readFileSync('prisma/rls/production-rls.sql', 'utf8')
  sql = sql.replace(/barbershop_app/g, appRole)

  const prisma = new PrismaClient({ datasources: { db: { url: adminUrl } } })
  try {
    await prisma.$executeRawUnsafe(sql)
    console.log(`\u2705 RLS template applied as roles: app=${appRole}`)
    console.log('   Verify with: npm run db:rls-status')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })

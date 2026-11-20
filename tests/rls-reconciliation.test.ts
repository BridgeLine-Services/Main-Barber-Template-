/**
 * Priority 4: the gift-card Row-Level Security gap, and the rule that staged policies stay
 * staged.
 *
 * The gap is real and specific: `add_gift_cards` turned RLS on for three tables and left the
 * policies to the staged plan. On the owner role that is invisible; on the runtime role it
 * would return zero rows. This suite pins the gap, pins the fact that the staged plan closes
 * it, and pins that nothing in the repository applies it by accident.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let passed = 0
let failed = 0
let skipped = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; return }
  failed++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const ROOT = join(__dirname, '..')
const GIFT_CARD_TABLES = ['GiftCardSettings', 'GiftCard', 'GiftCardTransaction']
const BUSINESS_SCOPED_ORG_TABLES = ['OrganizationLocation', 'StaffLocationAssignment', 'OrganizationServicePriceException', 'CustomerLocationLink', 'ReferralProgram', 'ReferralCode', 'ReferralAttribution']
const ORG_SCOPED_TABLES = ['Organization', 'OrganizationMember', 'OrganizationBrandSettings', 'OrganizationReportingConfiguration', 'OrganizationServiceTemplate', 'OrganizationAnnouncement', 'OrganizationConfigAudit']

async function main() {
  const migrationsDir = join(ROOT, 'prisma', 'migrations')
  const migrationSql: Array<{ dir: string; sql: string }> = readdirSync(migrationsDir)
    .filter((entry) => statSync(join(migrationsDir, entry)).isDirectory())
    .map((entry) => ({ dir: entry, sql: (() => { try { return readFileSync(join(migrationsDir, entry, 'migration.sql'), 'utf8') } catch { return '' } })() }))
    .filter((row) => row.sql.length > 0)

  const enabling = migrationSql.filter((row) => /ENABLE ROW LEVEL SECURITY/i.test(row.sql))
  ok('exactly one migration enables row level security', enabling.length === 1, enabling.map((r) => r.dir).join(', '))
  ok('it is the gift-card migration', /add_gift_cards/.test(enabling[0]?.dir ?? ''))
  for (const table of GIFT_CARD_TABLES) {
    ok(`the gift-card migration enables RLS on ${table}`, new RegExp(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`).test(enabling[0]?.sql ?? ''))
  }
  ok('no migration creates a policy', !migrationSql.some((row) => /CREATE POLICY/i.test(row.sql)))
  ok('no migration forces row level security', !migrationSql.some((row) => /FORCE ROW LEVEL SECURITY/i.test(row.sql)))

  const staged = readFileSync(join(ROOT, 'prisma', 'rls', 'production-rls.sql'), 'utf8')
  for (const table of GIFT_CARD_TABLES) {
    ok(`the staged plan closes the ${table} gap`, new RegExp(`'${table}'`).test(staged))
  }
  for (const table of BUSINESS_SCOPED_ORG_TABLES) {
    ok(`the staged plan covers the shop-scoped ${table}`, new RegExp(`'${table}'`).test(staged))
  }
  for (const table of ORG_SCOPED_TABLES) {
    ok(`the staged plan covers the organization-scoped ${table}`, new RegExp(`'${table}'`).test(staged))
  }
  ok('the staged plan sets a tenant for each transaction', /set_config\('app\.current_business_id'/.test(staged))
  ok('the staged plan documents the organization tenant key', /app\.current_organization_id/.test(staged))
  ok('the staged plan still forces RLS once applied', /FORCE ROW LEVEL SECURITY/.test(staged))

  const reconcile = readFileSync(join(ROOT, 'scripts', 'rls-reconcile.ts'), 'utf8')
  ok('the reconciliation report exists', reconcile.length > 500)
  ok('the reconciliation report is read-only', !/\$executeRaw|\$executeRawUnsafe/.test(reconcile))
  ok('the reconciliation report says nothing was changed', /Nothing was changed/i.test(reconcile))
  ok('the reconciliation report can fail a build', /--enforce/.test(reconcile))

  const status = readFileSync(join(ROOT, 'scripts', 'rls-status.ts'), 'utf8')
  for (const table of BUSINESS_SCOPED_ORG_TABLES) {
    ok(`the RLS status report tracks ${table}`, new RegExp(`'${table}'`).test(status))
  }

  if (!process.env.DATABASE_URL) {
    skipped++
    console.log('  SKIP live gap check (no DATABASE_URL)')
    return
  }

  const { prisma } = await import('../src/lib/prisma')
  try {
    const gaps = await prisma.$queryRawUnsafe<Array<{ relname: string }>>(`
      SELECT c.relname
        FROM pg_class c
        LEFT JOIN pg_policy p ON p.polrelid = c.oid
       WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
       GROUP BY c.relname, c.relrowsecurity
      HAVING c.relrowsecurity = true AND COUNT(p.polname) = 0
       ORDER BY c.relname`)
    const names = gaps.map((row) => row.relname).sort()
    ok('the only tables with RLS and no policy are the gift-card tables', names.join(',') === [...GIFT_CARD_TABLES].sort().join(','), names.join(','))
    ok('no organization table has RLS enabled yet', !names.some((name) => BUSINESS_SCOPED_ORG_TABLES.includes(name) || ORG_SCOPED_TABLES.includes(name)))
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then(() => {
    console.log(`\nRLS reconciliation: ${passed} passed, ${failed} failed, ${skipped} skipped`)
    if (failed > 0) process.exit(1)
  })
  .catch((error) => {
    console.error('RLS reconciliation suite threw:', error)
    process.exit(1)
  })

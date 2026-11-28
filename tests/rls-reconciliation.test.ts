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
import { classify, parseModels } from '../scripts/rls-plan'

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
const ORG_SCOPED_TABLES = ['Organization', 'OrganizationMember', 'OrganizationInvitation', 'OrganizationBrandSettings', 'OrganizationReportingConfiguration', 'OrganizationServiceTemplate', 'OrganizationLocation', 'StaffLocationAssignment', 'CustomerLocationLink', 'OrganizationServicePriceRequest', 'OrganizationAnnouncement', 'OrganizationAnnouncementRead', 'OrganizationConfigAudit']

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

  const schemaModels = parseModels(readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8'))
  const models = classify(schemaModels)
  const policyArray = (name: string) => {
    const contents = (staged.match(new RegExp(`${name} TEXT\\[\\] := ARRAY\\[([\\s\\S]*?)\\];`))?.[1] ?? '')
      .replace(/--.*$/gm, '')
    return new Set(Array.from(contents.matchAll(/'([^']+)'/g), (match) => match[1]))
  }
  const directPolicies = policyArray('t_direct')
  const organizationPolicies = policyArray('t_org')
  const indirectContents = staged.match(/FROM \(VALUES([\s\S]*?)\) AS indirect\(/)?.[1] ?? ''
  const indirectPolicies = new Set(Array.from(indirectContents.matchAll(/\('([^']+)'\s*,/g), (match) => match[1]))
  const tenantRootContents = staged.match(/FOREACH tbl IN ARRAY ARRAY\[([\s\S]*?)\] LOOP/)?.[1] ?? ''
  const tenantRootPolicies = new Set(Array.from(tenantRootContents.matchAll(/'([^']+)'/g), (match) => match[1]))
  for (const model of models) {
    if (model.classification === 'global') continue
    if (model.classification === 'direct') {
      ok(`direct model ${model.model} has a businessId policy`, directPolicies.has(model.model))
    } else if (model.classification === 'tenant_root') {
      ok(`tenant root ${model.model} has a root policy`, tenantRootPolicies.has(model.model))
    } else if (model.classification === 'indirect') {
      ok(`indirect model ${model.model} has a parent policy`, indirectPolicies.has(model.model))
    } else {
      ok(`organization model ${model.model} has an organization policy`, organizationPolicies.has(model.model))
      if (model.classification === 'organization' && model.model !== 'OrganizationServicePriceRequest') {
        const schemaModel = schemaModels.find((entry) => entry.name === model.model)
        if (schemaModel?.fields.some((field) => field.name === 'businessId')) {
          ok(`dual-scoped model ${model.model} retains its shop policy`, directPolicies.has(model.model))
        }
      }
    }
  }
  ok('Schedule is not treated as a tenant root', !tenantRootPolicies.has('Schedule'))
  ok('the status command checks FORCE ROW LEVEL SECURITY', /relforcerowsecurity/.test(readFileSync(join(ROOT, 'scripts', 'rls-status.ts'), 'utf8')))
  ok('the staged plan sets a tenant for each transaction', /set_config\('app\.current_business_id'/.test(staged))
  ok('the staged plan documents the organization tenant key', /app\.current_organization_id/.test(staged))
  ok('the staged plan still forces RLS once applied', /FORCE ROW LEVEL SECURITY/.test(staged))

  const reconcile = readFileSync(join(ROOT, 'scripts', 'rls-reconcile.ts'), 'utf8')
  ok('the reconciliation report exists', reconcile.length > 500)
  ok('the reconciliation report is read-only', !/\$executeRaw|\$executeRawUnsafe/.test(reconcile))
  ok('the reconciliation report says nothing was changed', /Nothing was changed/i.test(reconcile))
  ok('the reconciliation report can fail a build', /--enforce/.test(reconcile))

  const status = readFileSync(join(ROOT, 'scripts', 'rls-status.ts'), 'utf8')
  const statusTables = new Set(Array.from((status.match(/const TENANT_TABLES = \[([\s\S]*?)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g), (match) => match[1]))
  for (const model of models.filter((row) => row.classification !== 'global')) {
    ok(`the status report tracks classified model ${model.model}`, statusTables.has(model.model))
  }
  for (const table of BUSINESS_SCOPED_ORG_TABLES) {
    ok(`the RLS status report tracks ${table}`, new RegExp(`'${table}'`).test(status))
  }
  ok('the RLS status report tracks OrganizationServicePriceRequest', /'OrganizationServicePriceRequest'/.test(status))

  const liveDatabaseUrl = process.env.RLS_RECONCILIATION_DATABASE_URL
  if (!liveDatabaseUrl) {
    skipped++
    console.log('  SKIP live policy check (set RLS_RECONCILIATION_DATABASE_URL only for a verified disposable/staging database)')
    return
  }

  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient({ datasources: { db: { url: liveDatabaseUrl } } })
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ relname: string; rls: boolean; forced: boolean; policies: number }>>(`
      SELECT c.relname,
             c.relrowsecurity AS rls,
             c.relforcerowsecurity AS forced,
             COUNT(p.polname) FILTER (WHERE p.polname IN ('tenant_isolation', 'organization_isolation'))::int AS policies
        FROM pg_class c
        LEFT JOIN pg_policy p ON p.polrelid = c.oid
       WHERE c.relnamespace = 'public'::regnamespace
         AND c.relname = ANY(ARRAY[${GIFT_CARD_TABLES.map((table) => `'${table}'`).join(',')}]::text[])
       GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity`)
    const byName = new Map(rows.map((row) => [row.relname, row]))
    for (const table of GIFT_CARD_TABLES) {
      const row = byName.get(table)
      ok(`the verified database enforces RLS with a policy on ${table}`, !!row?.rls && !!row.forced && row.policies > 0)
    }
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

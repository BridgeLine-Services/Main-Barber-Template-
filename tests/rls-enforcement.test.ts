/**
 * Proves that the RLS stage-2 policies actually enforce tenant isolation.
 *
 * Everything else in the RLS work is paperwork until this runs: a policy file
 * that has never been executed against a database is a wish. This test builds a
 * throwaway database from a copy of the development database, creates the stage-1
 * roles, applies prisma/rls/production-rls.sql exactly as a deployment would, then
 * connects as the runtime role and tries to see and write another tenant's data.
 *
 * It never touches the development database's data (it only reads a dump of it),
 * and it drops its scratch database at the end whether or not the run passed.
 *
 * Usage:
 *   npx tsx tests/rls-enforcement.test.ts
 *
 * Exit codes: 0 pass, 1 failures, 3 the local database is not available.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const HOST = process.env.RLS_TEST_HOST ?? '127.0.0.1'
const PORT = process.env.RLS_TEST_PORT ?? '5432'
const ADMIN_USER = process.env.RLS_TEST_ADMIN_USER ?? 'postgres'
const SOURCE_DB = process.env.RLS_TEST_SOURCE_DB ?? 'barber'
const PROBE_DB = process.env.RLS_TEST_PROBE_DB ?? 'barber_rls_probe'

const adminUrl = (db: string) => `postgresql://${ADMIN_USER}@${HOST}:${PORT}/${db}`
const appUrl = (db: string) => `postgresql://barber_app@${HOST}:${PORT}/${db}`

let passed = 0
let failed = 0
const failures: string[] = []

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++
    return true
  }
  failed++
  failures.push(message)
  console.log(`  FAIL ${message}`)
  return false
}

function psql(url: string, sql: string): string {
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', '\t', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function psqlFile(url: string, file: string): string {
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** Runs a multi-statement transaction probe and returns only the data lines.
 *  psql prints BEGIN/SET/COMMIT command tags on stdout, which are noise here. */
function psqlTx(url: string, sql: string): string {
  return psql(url, sql)
    .split('\n')
    .filter((line) => !/^(BEGIN|SET|COMMIT|ROLLBACK|SAVEPOINT|RESET)$/i.test(line.trim()))
    .join('\n')
    .trim()
}

function psqlExpectFailure(url: string, sql: string): string {
  try {
    execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return ''
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr
    return String(stderr ?? '')
  }
}

function canReachDatabase(): boolean {
  try {
    psql(adminUrl('postgres'), 'SELECT 1')
    return true
  } catch {
    return false
  }
}

function dumpSource(target: string) {
  // A logical copy, not a template copy: CREATE DATABASE ... TEMPLATE fails while
  // any other session is connected, which makes it unreliable in a test run.
  const dump = execFileSync('pg_dump', ['--no-owner', '--no-privileges', adminUrl(SOURCE_DB)], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  execFileSync('psql', [adminUrl(target), '-v', 'ON_ERROR_STOP=1', '-q'], {
    input: dump,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function ids(url: string, table: string, column: string, tenant: string): string[] {
  const raw = psql(url, `SELECT ${column} FROM "${table}" WHERE "businessId" = '${tenant}' ORDER BY ${column}`)
  return raw ? raw.split('\n') : []
}

function main() {
  if (!canReachDatabase()) {
    console.log('RLS enforcement tests: SKIPPED (no local PostgreSQL reachable)')
    process.exit(3)
  }
  for (const tool of ['pg_dump', 'psql']) {
    if (!execFileSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim()) {
      console.log(`RLS enforcement tests: SKIPPED (${tool} not installed)`)
      process.exit(3)
    }
  }
  if (!existsSync('prisma/rls/production-rls.sql') || !existsSync('prisma/rls/stage-1-roles.sql')) {
    console.log('RLS enforcement tests: FAIL (RLS SQL files are missing)')
    process.exit(1)
  }

  psql(adminUrl('postgres'), `DROP DATABASE IF EXISTS "${PROBE_DB}"`)
  psql(adminUrl('postgres'), `CREATE DATABASE "${PROBE_DB}"`)

  try {
    console.log('\n1. Building a throwaway database from a copy of the development data')
    dumpSource(PROBE_DB)
    const tables = Number(psql(adminUrl(PROBE_DB), `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`))
    assert(tables > 50, `copied the schema (${tables} tables)`)

    console.log('\n2. Applying stage 1 (roles) and stage 2 (policies) exactly as a deployment would')
    psqlFile(adminUrl(PROBE_DB), 'prisma/rls/stage-1-roles.sql')
    const roleRow = psql(adminUrl(PROBE_DB), `SELECT rolsuper::text || ',' || rolbypassrls::text FROM pg_roles WHERE rolname='barber_app'`)
    assert(roleRow === 'false,false', `barber_app is not a superuser and cannot bypass RLS (got "${roleRow}")`)
    psqlFile(adminUrl(PROBE_DB), 'prisma/rls/production-rls.sql')

    console.log('\n3. Every tenant table is protected, and protected against its owner too')
    const unprotected = psql(
      adminUrl(PROBE_DB),
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND EXISTS (SELECT 1 FROM information_schema.columns col
                       WHERE col.table_schema='public' AND col.table_name=c.relname
                         AND col.column_name='businessId')
          AND (c.relrowsecurity = false OR c.relforcerowsecurity = false)
        ORDER BY c.relname`,
    )
    assert(unprotected === '', `no table with a businessId column is left without forced RLS${unprotected ? `: ${unprotected.split('\n').join(', ')}` : ''}`)

    const tenantTables = Number(psql(
      adminUrl(PROBE_DB),
      `SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name='businessId'`,
    ))
    assert(tenantTables >= 50, `checked every tenant table (${tenantTables} carry businessId)`)

    const policyless = psql(
      adminUrl(PROBE_DB),
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'
          AND EXISTS (SELECT 1 FROM information_schema.columns col
                       WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='businessId')
          AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname AND p.policyname='tenant_isolation')
        ORDER BY c.relname`,
    )
    assert(policyless === '', `every tenant table has a tenant_isolation policy${policyless ? `: ${policyless.split('\n').join(', ')}` : ''}`)

    console.log('\n4. Choosing two real tenants from the copied data')
    const tenants = psql(adminUrl(PROBE_DB), `SELECT id FROM "Business" ORDER BY "createdAt" NULLS LAST, id LIMIT 2`).split('\n').filter(Boolean)
    if (tenants.length < 2) {
      // Nothing to isolate. Say so plainly rather than reporting a green run that
      // never proved anything: this is a skip, not a pass.
      console.log('RLS enforcement tests: SKIPPED (the source database holds fewer than two businesses)')
      process.exitCode = 3
      return
    }
    const [tenantA, tenantB] = tenants

    console.log('\n5. The runtime role only ever sees the tenant it was given')
    for (const [label, tenant] of [['A', tenantA], ['B', tenantB]] as const) {
      const expectedAppointments = ids(adminUrl(PROBE_DB), 'Appointment', 'id', tenant)
      const seen = psqlTx(
        appUrl(PROBE_DB),
        `BEGIN; SET LOCAL app.business_id = '${tenant}'; SELECT coalesce(string_agg(id, E'\\n' ORDER BY id), '') FROM "Appointment"; COMMIT;`,
      ).split('\n').filter(Boolean)
      assert(
        seen.length === expectedAppointments.length && seen.every((id, i) => id === expectedAppointments[i]),
        `tenant ${label} sees exactly its own ${expectedAppointments.length} appointment(s)`,
      )

      const businessRows = psqlTx(appUrl(PROBE_DB), `BEGIN; SET LOCAL app.business_id = '${tenant}'; SELECT count(*) FROM "Business"; COMMIT;`)
      assert(businessRows === '1', `tenant ${label} sees exactly one Business row (got ${businessRows})`)
    }

    console.log('\n6. A session with no tenant set sees nothing at all (fail closed)')
    const unset = psql(appUrl(PROBE_DB), `SELECT count(*) FROM "Appointment"`)
    assert(unset === '0', `no tenant set returns no appointments (got ${unset})`)

    console.log('\n7. A forged tenant cannot be written, updated or deleted')
    const foreignBarber = psql(adminUrl(PROBE_DB), `SELECT id FROM "Barber" WHERE "businessId" = '${tenantB}' LIMIT 1`)
    const foreignService = psql(adminUrl(PROBE_DB), `SELECT id FROM "Service" WHERE "businessId" = '${tenantB}' LIMIT 1`)
    if (foreignBarber && foreignService) {
      const insertError = psqlExpectFailure(
        appUrl(PROBE_DB),
        `BEGIN; SET LOCAL app.business_id = '${tenantA}';
         INSERT INTO "Service" (id, "businessId", name, duration, price, "isActive", "order", "createdAt", "updatedAt")
         VALUES ('rls_probe_service', '${tenantB}', 'Probe', 30, 10, true, 0, now(), now()); COMMIT;`,
      )
      assert(insertError !== '', 'a write into another tenant is refused by the database')
      const landed = psql(adminUrl(PROBE_DB), `SELECT count(*) FROM "Service" WHERE id = 'rls_probe_service'`)
      assert(landed === '0', 'the refused write left no row behind')

      const updated = psqlTx(
        appUrl(PROBE_DB),
        `BEGIN; SET LOCAL app.business_id = '${tenantA}';
         WITH changed AS (UPDATE "Service" SET name = 'Hijacked' WHERE "businessId" = '${tenantB}' RETURNING 1)
         SELECT count(*) FROM changed; COMMIT;`,
      )
      assert(updated === '0', `a cross-tenant update changes no rows (got ${updated})`)

      const deleted = psqlTx(
        appUrl(PROBE_DB),
        `BEGIN; SET LOCAL app.business_id = '${tenantA}';
         WITH gone AS (DELETE FROM "Service" WHERE "businessId" = '${tenantB}' RETURNING 1)
         SELECT count(*) FROM gone; COMMIT;`,
      )
      assert(deleted === '0', `a cross-tenant delete removes no rows (got ${deleted})`)
      const survived = psql(adminUrl(PROBE_DB), `SELECT count(*) FROM "Service" WHERE "businessId" = '${tenantB}'`)
      assert(Number(survived) > 0, 'the other tenant still has its services')
    }

    console.log('\n8. The tenant setting never survives its transaction (pooled connections stay safe)')
    const leaked = psqlTx(
      appUrl(PROBE_DB),
      `BEGIN; SET LOCAL app.business_id = '${tenantA}'; COMMIT; SELECT coalesce(current_setting('app.business_id', true), '')`,
    )
    assert(leaked === '', `app.business_id is cleared after commit (saw "${leaked}")`)

    console.log('\n9. The runtime role cannot change the schema')
    const ddlError = psqlExpectFailure(appUrl(PROBE_DB), 'CREATE TABLE rls_probe_ddl (id int)')
    assert(ddlError !== '', 'barber_app cannot create tables')

    console.log('\n10. Support access still works when it is asked for explicitly')
    const staff = psqlTx(
      appUrl(PROBE_DB),
      `BEGIN; SET LOCAL app.platform_staff = '1'; SELECT count(DISTINCT "businessId") FROM "Appointment"; COMMIT;`,
    )
    assert(Number(staff) >= 2, `platform staff sees every tenant when it sets app.platform_staff (${staff} tenants)`)
  } finally {
    try {
      psql(adminUrl('postgres'), `DROP DATABASE IF EXISTS "${PROBE_DB}"`)
    } catch {
      console.log(`  note: could not drop ${PROBE_DB}; drop it by hand`)
    }
  }

  if (process.exitCode === 3) return
  console.log(`\nRLS enforcement tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    for (const failure of failures) console.log(`  - ${failure}`)
  }
  process.exit(failed === 0 ? 0 : 1)
}

main()

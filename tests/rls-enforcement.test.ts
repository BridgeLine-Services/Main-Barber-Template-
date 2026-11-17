/**
 * Proves that the RLS stage-2 policies actually enforce tenant isolation.
 *
 * Everything else in the RLS work is paperwork until this runs: a policy file
 * that has never been executed against a database is a wish. This test builds a
 * throwaway database from the schema of the source database, inserts its OWN
 * synthetic tenants, creates the stage-1 roles, applies
 * prisma/rls/production-rls.sql exactly as a deployment would, then connects as
 * the runtime role and tries to see and write another tenant's data.
 *
 * Two properties matter more than the assertions:
 *
 *   1. It never depends on whatever records happen to be in the database. Two
 *      synthetic tenants are created here, so the run is identical on a developer
 *      machine, a fresh CI service and a laptop with an empty database. No real
 *      customer or shop data is read, copied or reported.
 *   2. It never touches the source database. Only its schema is dumped; the
 *      scratch database is dropped in a finally block.
 *
 * Connection settings come from explicit test-only variables. `DATABASE_URL` is
 * deliberately NOT used as a fallback: pointing a test that creates and drops
 * databases at whatever a shell happens to export is how a development machine
 * loses its data.
 *
 *   RLS_TEST_HOST            default 127.0.0.1
 *   RLS_TEST_PORT            default 5432
 *   RLS_TEST_ADMIN_USER      default postgres
 *   RLS_TEST_ADMIN_PASSWORD  default (none: peer/trust auth)
 *   RLS_TEST_APP_USER        default barber_app  (created by stage 1)
 *   RLS_TEST_APP_PASSWORD    default (generated per run)
 *   RLS_TEST_SOURCE_DB       default barber      (schema source, never modified)
 *   RLS_TEST_PROBE_DB        default barber_rls_probe (a unique suffix is added)
 *   RLS_TEST_REQUIRED        'true' makes a missing prerequisite a FAILURE
 *
 * Usage:
 *   npx tsx tests/rls-enforcement.test.ts
 *
 * Exit codes: 0 pass, 1 failures (or a missing prerequisite in required mode),
 * 3 skipped because a local PostgreSQL was intentionally not available.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const HOST = (process.env.RLS_TEST_HOST ?? '127.0.0.1').trim()
const PORT = (process.env.RLS_TEST_PORT ?? '5432').trim()
const ADMIN_USER = (process.env.RLS_TEST_ADMIN_USER ?? 'postgres').trim()
const ADMIN_PASSWORD = process.env.RLS_TEST_ADMIN_PASSWORD ?? ''
const APP_USER = (process.env.RLS_TEST_APP_USER ?? 'barber_app').trim()
let APP_PASSWORD = process.env.RLS_TEST_APP_PASSWORD ?? ''
const SOURCE_DB = (process.env.RLS_TEST_SOURCE_DB ?? 'barber').trim()
const PROBE_DB = (process.env.RLS_TEST_PROBE_DB ?? 'barber_rls_probe').trim()

/**
 * In CI a security test that did not run must never look like a green tick, so
 * the same conditions that are a polite skip locally are hard failures there.
 */
const MANDATORY =
  process.env.RLS_TEST_REQUIRED === 'true' ||
  process.env.GITHUB_ACTIONS === 'true' ||
  process.env.RLS_TEST_REQUIRED === '1'

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

/** A prerequisite is missing. Loud in CI, a labelled skip locally. */
function unavailable(reason: string): never {
  if (MANDATORY) {
    console.error(`RLS enforcement tests: FAIL (${reason})`)
    console.error('  This run is mandatory, so an unexecuted security test is a failure, not a skip.')
    process.exit(1)
  }
  console.log(`RLS enforcement tests: SKIPPED (${reason})`)
  console.log('  RLS enforcement was NOT verified by this run. Start a local PostgreSQL or set RLS_TEST_* to run it.')
  process.exit(3)
}

/**
 * Connection details are assembled with encodeURIComponent, and the password is
 * passed as PGPASSWORD in the child environment rather than in the URL, so a
 * credential cannot reach a process listing, a log line or an error message.
 */
function connectionUrl(db: string, user: string): string {
  const host = HOST.includes(':') && !HOST.startsWith('[') ? `[${HOST}]` : HOST
  return `postgresql://${encodeURIComponent(user)}@${host}:${encodeURIComponent(PORT)}/${encodeURIComponent(db)}`
}

function adminUrl(db: string): string {
  return connectionUrl(db, ADMIN_USER)
}

/** The scratch database for this run. Set in main() before any app connection. */
let activeScratch = PROBE_DB

function appUrl(db: string): string {
  return connectionUrl(db, APP_USER)
}

function adminEnv(): NodeJS.ProcessEnv {
  return ADMIN_PASSWORD ? { ...process.env, PGPASSWORD: ADMIN_PASSWORD } : process.env
}

function appEnv(): NodeJS.ProcessEnv {
  return APP_PASSWORD ? { ...process.env, PGPASSWORD: APP_PASSWORD } : process.env
}

/** Safe to print: strips anything that looks like a connection string or password. */
function redact(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '[connection string hidden]')
    .replace(/\b(password|pgpassword)\s*=\s*\S+/gi, '$1=[hidden]')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' | ')
}

function stderrOf(error: unknown): string {
  return String((error as { stderr?: Buffer | string })?.stderr ?? '')
}

/** psql against the administrative connection. */
function psql(url: string, sql: string): string {
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', '\t', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: adminEnv(),
  }).trim()
}

/** psql against the scratch database as the unprivileged runtime role. */
function psqlApp(sql: string): string {
  return execFileSync('psql', [appUrl(activeScratch), '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', '\t', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: appEnv(),
  }).trim()
}

function psqlFile(url: string, file: string): string {
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: adminEnv(),
  }).trim()
}

function psqlAppTx(sql: string): string {
  return psqlApp(sql)
    .split('\n')
    .filter((line) => !/^(BEGIN|SET|COMMIT|ROLLBACK|SAVEPOINT|RESET)$/i.test(line.trim()))
    .join('\n')
    .trim()
}

/**
 * Runs a multi-statement script without ON_ERROR_STOP, so a statement that is
 * SUPPOSED to fail (a deliberate 1/0) does not abort the rest of the script. Only
 * the data lines are returned, which is what the assertions look at.
 */
function psqlAppScript(sql: string): string {
  return execFileSync('psql', [appUrl(activeScratch), '-t', '-A', '-F', '\t'], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: appEnv(),
  })
    .split('\n')
    .filter((line) => !/^(BEGIN|SET|COMMIT|ROLLBACK|SAVEPOINT|RESET|ERROR)/i.test(line.trim()))
    .join('\n')
    .trim()
}

function psqlExpectFailure(url: string, sql: string, asApp = false): string {
  try {
    execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: asApp ? appEnv() : adminEnv(),
    })
    return ''
  } catch (error) {
    return stderrOf(error)
  }
}

/**
 * Can the administrative connection be opened? Returns a plain-language reason
 * instead of swallowing the error, because "no database" and "wrong password"
 * need completely different actions from whoever is reading the log.
 */
function diagnoseConnection(): { ok: true } | { ok: false; reason: string } {
  try {
    execFileSync('psql', [adminUrl('postgres'), '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', 'SELECT 1'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: adminEnv(),
    })
    return { ok: true }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { ok: false, reason: 'the psql client is not installed' }
    }
    const stderr = stderrOf(error).toLowerCase()
    if (/password authentication failed|no password supplied|authentication failed/.test(stderr)) {
      return { ok: false, reason: `PostgreSQL refused the administrator credentials for user "${ADMIN_USER}"` }
    }
    if (/role .* does not exist/.test(stderr)) {
      return { ok: false, reason: `PostgreSQL has no role named "${ADMIN_USER}"` }
    }
    if (/database .* does not exist/.test(stderr)) {
      return { ok: false, reason: 'the maintenance database "postgres" does not exist' }
    }
    if (/connection refused|could not connect|could not translate host|no such host|timeout|timed out/.test(stderr)) {
      return { ok: false, reason: `no PostgreSQL server is reachable at ${HOST}:${PORT}` }
    }
    if (/too many clients|remaining connection slots/.test(stderr)) {
      return { ok: false, reason: 'PostgreSQL is up but has no free connections' }
    }
    // Never echo the raw error: it can contain a connection string.
    return { ok: false, reason: 'the administrative connection failed for a reason this test does not recognise' }
  }
}

function requireTool(tool: string) {
  const found = execFileSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim()
  if (!found) unavailable(`the ${tool} client is not installed`)
}

/** Identifier safety: a generated name is only ever used after this check. */
function assertSafeIdentifier(name: string) {
  if (!/^[a-z0-9_]{1,63}$/.test(name)) {
    throw new Error(`refusing to use an unsafe database identifier: ${name.replace(/[^a-z0-9_]/gi, '?')}`)
  }
}

/**
 * A pg_dump NEWER than the server writes settings the server has never heard of.
 * PostgreSQL 18, for example, starts every dump with `SET transaction_timeout = 0;`
 * and a 15 server answers `ERROR: unrecognized configuration parameter
 * "transaction_timeout"` — which aborted the whole restore. Those lines are dropped
 * from the dump's leading block; every other statement is left exactly as dumped,
 * and an error anywhere else still stops the run.
 */
function preambleServerSafe(dump: string, known: Set<string>): { sql: string; removed: string[] } {
  const removed: string[] = []
  const out: string[] = []
  let inPreamble = true
  for (const line of dump.split('\n')) {
    const trimmed = line.trim()
    if (inPreamble) {
      if (trimmed === '' || trimmed.startsWith('--')) { out.push(line); continue }
      // psql meta-commands belong to the dump's opening block: recent pg_dump
      // versions emit `\restrict <token>` there for injection safety, and treating
      // that as "the preamble has ended" is what let a later SET slip through.
      if (trimmed.startsWith('\\')) { out.push(line); continue }
      const setting = /^SET\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/i.exec(trimmed)
      if (/^SELECT\s+pg_catalog\.set_config\(/i.test(trimmed)) { out.push(line); continue }
      if (setting) {
        if (known.has(setting[1].toLowerCase())) out.push(line)
        else removed.push(trimmed)
        continue
      }
      inPreamble = false
    }
    out.push(line)
  }
  return { sql: out.join('\n'), removed }
}

/** Every setting name the target server actually accepts. */
function knownServerParameters(target: string): Set<string> {
  return new Set(
    psql(adminUrl(target), `SELECT name FROM pg_settings`)
      .split('\n')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** The statement PostgreSQL 18's pg_dump writes and a 15 server rejects. */
const NEWER_CLIENT_PREAMBLE = 'SET transaction_timeout = 0;'

/**
 * A dump exactly as the CI client produces it: the same dump, with the one
 * statement a newer pg_dump adds and this server has never accepted. This is not a
 * mock of the restore, it is the real dump that failed in GitHub Actions.
 */
function asNewerClientDump(dump: string): string {
  const lines = dump.split('\n')
  const after = lines.findIndex((line) => /^SET\s+statement_timeout\s*=/i.test(line.trim()))
  lines.splice(after >= 0 ? after + 1 : 0, 0, NEWER_CLIENT_PREAMBLE)
  return lines.join('\n')
}

/** Schema only: no shop records, no customer records, no production data. */
function dumpSchema(): string {
  // --no-comments and --no-tablespaces keep the dump to statements that restore
  // anywhere: a COMMENT ON EXTENSION is owned by the extension, and a tablespace
  // only exists on the server that made it. Both are the classic reasons a
  // schema that dumps perfectly will not restore into a fresh database.
  const flags = ['--schema-only', '--no-owner', '--no-privileges', '--no-comments', '--no-tablespaces']
  try {
    return execFileSync('pg_dump', [...flags, adminUrl(SOURCE_DB)], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: adminEnv(),
    })
  } catch (error) {
    throw new Error(`dumping the schema of "${SOURCE_DB}" failed: ${redact(stderrOf(error)) || 'no diagnostic output'}`)
  }
}

/** True when the scratch database is still empty, i.e. a failed restore created nothing. */
function scratchTableCount(target: string): number {
  return Number(psql(adminUrl(target), `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`))
}

/** Restores a dump, dropping only the settings this server does not accept. */
function restoreSchema(target: string, dump: string, { filter = true }: { filter?: boolean } = {}) {  const { sql, removed } = filter ? preambleServerSafe(dump, knownServerParameters(target)) : { sql: dump, removed: [] as string[] }
  if (removed.length > 0) {
    // Reported, never silent: the operator should know the dump came from a newer
    // client than the server, even though the restore is unaffected by it.
    console.log(`  note: the dump carried ${removed.length} setting(s) this server does not accept; skipped ${removed.map((line) => line.split('=')[0].trim()).join(', ')}`)
  }
  try {
    execFileSync('psql', [adminUrl(target), '-v', 'ON_ERROR_STOP=1', '-q'], {
      input: sql,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: adminEnv(),
    })
  } catch (error) {
    const stderr = stderrOf(error)
    const reported = /(?:<stdin>|LINE)\s*:?\s*(\d+)/i.exec(stderr)
    const lineNumber = reported ? Number(reported[1]) : 0
    const statement = lineNumber > 0 ? (sql.split('\n')[lineNumber - 1] ?? '').trim() : ''
    const context = sql.split('\n').filter((line) => line.trim()).slice(0, 3).join(' | ')
    throw new Error(
      `restoring the schema into "${target}" failed: ${redact(stderr) || 'no diagnostic output'}` +
        (statement ? ` (statement: ${redact(statement)})` : ` (dump starts: ${redact(context)})`),
    )
  }
}

/**
 * Two synthetic tenants, built from the same tables the interface uses. The ids
 * are fixed so a failure names the same rows on every run, and the contact
 * details use the reserved .invalid domain so nothing can ever be delivered.
 */
export const FIXTURES = {
  tenants: [
    { id: 'rls_test_biz_a', slug: 'rls-test-tenant-a', name: 'RLS Test Shop A', customer: 'rls_test_cust_a', barber: 'rls_test_barber_a', service: 'rls_test_service_a', appointment: 'rls_test_appt_a' },
    { id: 'rls_test_biz_b', slug: 'rls-test-tenant-b', name: 'RLS Test Shop B', customer: 'rls_test_cust_b', barber: 'rls_test_barber_b', service: 'rls_test_service_b', appointment: 'rls_test_appt_b' },
  ],
} as const

function seedFixtures(target: string) {
  for (const tenant of FIXTURES.tenants) {
    const suffix = tenant.id.slice(-1)
    psql(
      adminUrl(target),
      `
      INSERT INTO "Business" (id, name, slug, "createdAt", "updatedAt")
      VALUES ('${tenant.id}', '${tenant.name}', '${tenant.slug}', now(), now());

      INSERT INTO "Customer" (id, "businessId", "firstName", "lastName", phone, email, "createdAt", "updatedAt")
      VALUES ('${tenant.customer}', '${tenant.id}', 'Test', 'Customer ${suffix.toUpperCase()}', '+1555000${suffix}000', 'tenant-${suffix}@example.invalid', now(), now());

      INSERT INTO "Barber" (id, "businessId", name, slug, "createdAt", "updatedAt")
      VALUES ('${tenant.barber}', '${tenant.id}', 'Test Barber ${suffix.toUpperCase()}', 'rls-test-barber-${suffix}', now(), now());

      INSERT INTO "Service" (id, "businessId", name, duration, price, "isActive", "order", "createdAt", "updatedAt")
      VALUES ('${tenant.service}', '${tenant.id}', 'Test Service ${suffix.toUpperCase()}', 30, 25, true, 0, now(), now());

      INSERT INTO "Appointment" (id, "confirmationNumber", "customerAccessToken", "businessId", "customerId", "barberId", "serviceId", "startTime", "endTime", "createdAt", "updatedAt")
      VALUES ('${tenant.appointment}', 'RLSTEST${suffix.toUpperCase()}', 'rls-test-token-${suffix}-${'0'.repeat(24)}', '${tenant.id}', '${tenant.customer}', '${tenant.barber}', '${tenant.service}', now() + interval '1 day', now() + interval '1 day 30 minutes', now(), now());
      `,
    )
  }
}

function ids(url: string, table: string, column: string, tenant: string): string[] {
  const raw = psql(url, `SELECT ${column} FROM "${table}" WHERE "businessId" = '${tenant}' ORDER BY ${column}`)
  return raw ? raw.split('\n') : []
}

function main() {
  // Runs before any connection: this is the logic that decides what the restore is
  // allowed to skip, and it must be verified even on a machine with no PostgreSQL.
  console.log('📦 The restore only drops settings the server does not accept')
  const pureChecksBefore = passed
  const pureFailuresBefore = failed
  {
    const known = new Set(['statement_timeout', 'search_path', 'client_encoding'])
    const dump = [
      '--',
      '-- PostgreSQL database dump',
      '--',
      '',
      'SET statement_timeout = 0;',
      'SET transaction_timeout = 0;',
      "SET client_encoding = 'UTF8';",
      "SELECT pg_catalog.set_config('search_path', '', false);",
      'CREATE TABLE "Probe" (id text);',
      'SET transaction_timeout = 0;',
    ].join('\n')
    const { sql, removed } = preambleServerSafe(dump, known)
    assert(removed.length === 1 && removed[0] === 'SET transaction_timeout = 0;', 'the one setting this server lacks is dropped')
    assert(sql.includes('SET statement_timeout = 0;'), 'a setting the server accepts is kept')
    assert(sql.includes('SET client_encoding'), 'the encoding is kept, so restored text is not reinterpreted')
    assert(sql.includes('SELECT pg_catalog.set_config'), 'the search_path reset is kept, so nothing is restored into the wrong schema')
    assert(sql.includes('CREATE TABLE "Probe"'), 'the schema statements are untouched')
    assert(sql.split('\n').filter((line) => line.includes('transaction_timeout')).length === 1, 'only the leading block is filtered: a later statement is left alone')
    const withMeta = ['\\restrict abc', 'SET statement_timeout = 0;', 'SET transaction_timeout = 0;', 'CREATE TABLE "X" (id text);'].join('\n')
    const metaResult = preambleServerSafe(withMeta, known)
    assert(metaResult.removed.length === 1, 'a psql meta-command at the top of the dump does not end the block being checked')
    assert(metaResult.sql.includes('\\restrict abc'), 'and the meta-command is preserved exactly')

    const untouched = preambleServerSafe(dump, new Set(['statement_timeout', 'transaction_timeout', 'client_encoding']))
    assert(untouched.removed.length === 0 && untouched.sql === dump, 'a client that matches the server changes nothing at all')
  }
  console.log(`  ${passed - pureChecksBefore} checks passed${failed > pureFailuresBefore ? `, ${failed - pureFailuresBefore} failed` : ''} (no database needed)\n`)

  const reachable = diagnoseConnection()
  if (reachable.ok === false) unavailable(reachable.reason)
  requireTool('psql')
  requireTool('pg_dump')

  if (!existsSync('prisma/rls/production-rls.sql') || !existsSync('prisma/rls/stage-1-roles.sql')) {
    console.error('RLS enforcement tests: FAIL (the RLS SQL files are missing from prisma/rls)')
    process.exit(1)
  }

  // A unique scratch name keeps two runs (CI matrix, two developers on one host)
  // from dropping each other's database.
  const scratch = `${PROBE_DB}_${randomBytes(3).toString('hex')}`
  assertSafeIdentifier(scratch)
  activeScratch = scratch

  const sourceExists = psql(adminUrl('postgres'), `SELECT count(*) FROM pg_database WHERE datname = '${SOURCE_DB.replace(/'/g, "''")}'`)
  if (sourceExists !== '1') {
    unavailable(`the source database "${SOURCE_DB}" does not exist, so there is no schema to copy`)
  }

  let created = false
  try {
    console.log(`\n1. Creating the scratch database ${scratch} and copying the schema only`)
    try {
      psql(adminUrl('postgres'), `CREATE DATABASE "${scratch}" TEMPLATE template0`)
      created = true
    } catch {
      unavailable('the scratch database could not be created (does this role have CREATEDB?)')
    }
    let dump: string
    try {
      dump = dumpSchema()
    } catch (error) {
      console.error('RLS enforcement tests: FAIL (the schema could not be copied into the scratch database)')
      console.error(`  ${error instanceof Error ? error.message : 'unknown error'}`)
      process.exitCode = 1
      return
    }

    console.log('\n1b. A dump from a newer client than the server restores anyway (the CI failure)')
    {
      // The exact failure that turned both GitHub jobs red: the runner's pg_dump was
      // 18.6 against a 15 server, so the dump began with a setting 15 has never had.
      // The negative control runs first, on the empty scratch database: it is the
      // real dump, restored without the compatibility step, and it must fail.
      let message = ''
      try {
        restoreSchema(scratch, asNewerClientDump(dump), { filter: false })
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      assert(message.includes('unrecognized configuration parameter'), 'the unfiltered dump fails the way CI failed, so this really is the same bug')
      assert(scratchTableCount(scratch) === 0, 'and the failed dump left the database untouched, not half-applied')
      restoreSchema(scratch, asNewerClientDump(dump))
      assert(scratchTableCount(scratch) > 50, 'the same dump restores once the unsupported setting is dropped')
    }

    const publicTables = (db: string) =>
      psql(adminUrl(db), `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`)
    const tables = Number(psql(adminUrl(scratch), `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`))
    if (!assert(tables > 50, `copied the schema (${tables} tables)`)) return
    // Assertions must never run against a partial schema, so the copy is compared
    // to the source table for table rather than trusted because psql exited 0.
    const copied = publicTables(scratch) === publicTables(SOURCE_DB)
    if (!assert(copied, `the scratch database has exactly the source's ${tables} tables, by name`)) return

    console.log('\n2. Creating two synthetic tenants (no real shop or customer data is used)')
    seedFixtures(scratch)
    const seeded = Number(psql(adminUrl(scratch), `SELECT count(*) FROM "Business"`))
    if (!assert(seeded === 2, `exactly two synthetic businesses exist (got ${seeded})`)) return

    console.log('\n3. Applying stage 1 (roles) and stage 2 (policies) exactly as a deployment would')
    psqlFile(adminUrl(scratch), 'prisma/rls/stage-1-roles.sql')

    // The role's password is set for this disposable run only; the SQL file keeps
    // its placeholder so no real credential lives in the repository.
    if (!APP_PASSWORD) {
      // Generated per run and never printed: the SQL file keeps its placeholder,
      // so no real credential exists in the repository or in the logs.
      APP_PASSWORD = `rls-${randomBytes(12).toString('hex')}`
      psql(adminUrl(scratch), `ALTER ROLE "${APP_USER.replace(/"/g, '""')}" WITH PASSWORD '${APP_PASSWORD}'`)
    }

    const roleRow = psql(adminUrl(scratch), `SELECT rolsuper::text || ',' || rolbypassrls::text FROM pg_roles WHERE rolname='${APP_USER.replace(/'/g, "''")}'`)
    assert(roleRow === 'false,false', `${APP_USER} is not a superuser and cannot bypass RLS (got "${roleRow}")`)

    const adminRole = psql(adminUrl(scratch), 'SELECT current_user')
    assert(adminRole === ADMIN_USER, `the administrative session is running as ${ADMIN_USER} (got "${adminRole}")`)

    psqlFile(adminUrl(scratch), 'prisma/rls/production-rls.sql')

    // Proof the two connections are genuinely different roles, not the same
    // superuser wearing two hats: this is the whole point of the test.
    const appRole = psqlApp('SELECT current_user')
    assert(appRole === APP_USER, `the runtime session runs as ${APP_USER} (got "${appRole}")`)
    assert(appRole !== adminRole, 'the runtime and administrative sessions use different roles')

    console.log('\n4. Every tenant table is protected, and protected against its owner too')
    const unprotected = psql(
      adminUrl(scratch),
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
      adminUrl(scratch),
      `SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name='businessId'`,
    ))
    assert(tenantTables >= 50, `checked every tenant table (${tenantTables} carry businessId)`)

    const policyless = psql(
      adminUrl(scratch),
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'
          AND EXISTS (SELECT 1 FROM information_schema.columns col
                       WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='businessId')
          AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname AND p.policyname='tenant_isolation')
        ORDER BY c.relname`,
    )
    assert(policyless === '', `every tenant table has a tenant_isolation policy${policyless ? `: ${policyless.split('\n').join(', ')}` : ''}`)

    console.log('\n5. The runtime role only ever sees the tenant it was given')
    const [tenantA, tenantB] = FIXTURES.tenants.map((t) => t.id)
    for (const [label, tenant] of [['A', tenantA], ['B', tenantB]] as const) {
      const expectedAppointments = ids(adminUrl(scratch), 'Appointment', 'id', tenant)
      assert(expectedAppointments.length === 1, `tenant ${label} has exactly one fixture appointment (got ${expectedAppointments.length})`)
      const seen = psqlAppTx(
        `BEGIN; SET LOCAL app.business_id = '${tenant}'; SELECT coalesce(string_agg(id, E'\\n' ORDER BY id), '') FROM "Appointment"; COMMIT;`,
      ).split('\n').filter(Boolean)
      assert(
        seen.length === expectedAppointments.length && seen.every((id, i) => id === expectedAppointments[i]),
        `tenant ${label} sees exactly its own ${expectedAppointments.length} appointment(s)`,
      )

      const businessRows = psqlAppTx(`BEGIN; SET LOCAL app.business_id = '${tenant}'; SELECT count(*) FROM "Business"; COMMIT;`)
      assert(businessRows === '1', `tenant ${label} sees exactly one Business row (got ${businessRows})`)
    }

    console.log('\n6. A session with no tenant set sees nothing at all (fail closed)')
    const unset = psqlApp(`SELECT count(*) FROM "Appointment"`)
    assert(unset === '0', `no tenant set returns no appointments (got ${unset})`)

    console.log('\n7. A forged tenant cannot be written, updated or deleted')
    const foreignBarber = psql(adminUrl(scratch), `SELECT id FROM "Barber" WHERE "businessId" = '${tenantB}' LIMIT 1`)
    const foreignService = psql(adminUrl(scratch), `SELECT id FROM "Service" WHERE "businessId" = '${tenantB}' LIMIT 1`)
    assert(foreignBarber !== '' && foreignService !== '', 'the other tenant has a barber and a service to attack')
    {
      const insertError = psqlExpectFailure(
        appUrl(scratch),
        `BEGIN; SET LOCAL app.business_id = '${tenantA}';
         INSERT INTO "Service" (id, "businessId", name, duration, price, "isActive", "order", "createdAt", "updatedAt")
         VALUES ('rls_probe_service', '${tenantB}', 'Probe', 30, 10, true, 0, now(), now()); COMMIT;`,
        true,
      )
      assert(insertError !== '', 'a write into another tenant is refused by the database')
      const landed = psql(adminUrl(scratch), `SELECT count(*) FROM "Service" WHERE id = 'rls_probe_service'`)
      assert(landed === '0', 'the refused write left no row behind')

      const updated = psqlAppTx(
        `BEGIN; SET LOCAL app.business_id = '${tenantA}';
         WITH changed AS (UPDATE "Service" SET name = 'Hijacked' WHERE "businessId" = '${tenantB}' RETURNING 1)
         SELECT count(*) FROM changed; COMMIT;`,
      )
      assert(updated === '0', `a cross-tenant update changes no rows (got ${updated})`)

      const deleted = psqlAppTx(
        `BEGIN; SET LOCAL app.business_id = '${tenantA}';
         WITH gone AS (DELETE FROM "Service" WHERE "businessId" = '${tenantB}' RETURNING 1)
         SELECT count(*) FROM gone; COMMIT;`,
      )
      assert(deleted === '0', `a cross-tenant delete removes no rows (got ${deleted})`)
      const survived = psql(adminUrl(scratch), `SELECT count(*) FROM "Service" WHERE "businessId" = '${tenantB}'`)
      assert(Number(survived) > 0, 'the other tenant still has its services')
    }

    console.log('\n8. The tenant setting never survives its transaction (pooled connections stay safe)')
    const leaked = psqlAppTx(
      `BEGIN; SET LOCAL app.business_id = '${tenantA}'; COMMIT; SELECT coalesce(current_setting('app.business_id', true), '')`,
    )
    assert(leaked === '', `app.business_id is cleared after commit (saw "${leaked}")`)

    const rolledBack = psqlAppTx(
      `BEGIN; SET LOCAL app.business_id = '${tenantB}'; ROLLBACK; SELECT coalesce(current_setting('app.business_id', true), '')`,
    )
    assert(rolledBack === '', `app.business_id is cleared after rollback (saw "${rolledBack}")`)

    const contamination = psqlAppTx(
      `BEGIN; SET LOCAL app.business_id = '${tenantA}'; COMMIT;
       BEGIN; SELECT count(*) FROM "Appointment"; COMMIT;`,
    )
    assert(contamination === '0', `the next transaction starts with no tenant (saw ${contamination})`)

    // One session: a transaction that blows up and is rolled back must leave no
    // tenant behind for the transaction that follows it on the same connection.
    const failedTx = psqlAppScript(
      `BEGIN; SET LOCAL app.business_id = '${tenantA}'; SELECT 1/0; ROLLBACK;
       BEGIN; SELECT count(*) FROM "Appointment"; COMMIT;`,
    )
    assert(failedTx === '0', `a failed transaction leaves no tenant context behind (saw ${failedTx})`)
    assert(failedTx === '0', 'a failed transaction leaves no tenant context behind')

    console.log('\n9. The runtime role cannot change the schema')
    const ddlError = psqlExpectFailure(appUrl(scratch), 'CREATE TABLE rls_probe_ddl (id int)', true)
    assert(ddlError !== '', `${APP_USER} cannot create tables`)

    console.log('\n10. Support access still works when it is asked for explicitly')
    const staff = psqlAppTx(
      `BEGIN; SET LOCAL app.platform_staff = '1'; SELECT count(DISTINCT "businessId") FROM "Appointment"; COMMIT;`,
    )
    assert(Number(staff) >= 2, `platform staff sees every tenant when it sets app.platform_staff (${staff} tenants)`)
  } finally {
    if (created) {
      try {
        psql(adminUrl('postgres'), `DROP DATABASE IF EXISTS "${scratch}"`)
      } catch {
        console.error(`  note: the scratch database ${scratch} could not be dropped; drop it by hand`)
        if (failed === 0 && !process.exitCode) process.exitCode = 1
      }
    }
  }

  console.log(`\nRLS enforcement tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    for (const failure of failures) console.log(`  - ${failure}`)
  }
  process.exit(failed === 0 ? 0 : 1)
}

try {
  main()
} catch (error) {
  // An unexpected throw is a failure, never a silent skip, and it must not hide
  // behind a stack trace: the scratch database has already been dropped by the
  // finally block above.
  console.error('RLS enforcement tests: FAIL (the run could not be completed)')
  console.error(`  ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`)
  process.exitCode = 1
}

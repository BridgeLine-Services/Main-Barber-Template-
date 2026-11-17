// ============================================================================
// Backup automation + verified restore testing (Operations Guide § Backups)
//
//   npm run db:backup                       dump DATABASE_URL -> backups/*.sql.gz
//   npm run db:backup-verify                dump + restore into a scratch
//                                          database + integrity checks, then
//                                          drop the scratch database
//
// Flags:
//   --url <conn>          connection string (default: DATABASE_URL)
//   --out <dir>           output directory (default: backups/)
//   --keep                in verify mode, keep the dump file instead of deleting it
//   --file <path>         verify an existing .sql or .sql.gz artifact instead of
//                         taking a fresh dump (used by the off-site pipeline)
//   --timeout-ms <n>      per-command timeout (default 15 minutes)
//   --json                print a machine-readable result line
//
// Requires pg_dump + psql on PATH (or set PGBIN_DIR to a bin directory).
// Verify mode needs CREATE DATABASE rights on the target server; production
// DATABASE_URL users may lack that — in that case run verify against a staging
// copy or an admin URL passed via --url.
//
// ── Why this file was rewritten (2026-11-17) ────────────────────────────────
// The previous version called process.exit() from inside helper functions. The
// cleanup in `finally` still ran, but every *other* exit path skipped it: a
// failed restore, a failed sanity check, or a failed pg_dump after the scratch
// database existed left a `barber_backup_verify_*` database behind on the server
// and left the temp dump on disk. Repeated nightly failures quietly accumulate
// databases until the server refuses new connections.
//
// The rule now: helpers THROW, only main() decides an exit code, and a cleanup
// registry runs on every path — including the paths where cleanup itself fails,
// which is reported alongside the original error instead of replacing it. A
// backup is never reported successful before it has been restored.
// ============================================================================

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { sendAlert } from '../src/lib/alerts'

const args = process.argv.slice(2)
function argValue(name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}
const VERIFY = args.includes('--verify')
const KEEP = args.includes('--keep')
const JSON_OUT = args.includes('--json')
const FILE_ARG = argValue('--file')
const TIMEOUT_MS = (() => {
  const raw = Number(argValue('--timeout-ms') ?? process.env.BACKUP_COMMAND_TIMEOUT_MS)
  return Number.isFinite(raw) && raw >= 5_000 ? raw : 15 * 60 * 1000
})()

const PGBIN_DIR = process.env.PGBIN_DIR || ''

/** A failure that carries the process exit code it should produce. */
export class BackupFailure extends Error {
  constructor(message: string, readonly exitCode: number = 1) {
    super(message)
    this.name = 'BackupFailure'
  }
}

/**
 * Remove everything that identifies the database, keeping the shape. Applied to
 * every message this script prints, so a driver error (which can echo the full
 * connection URL) can never reach a log drain, a CI annotation or an alert.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, (match) => {
      try {
        const url = new URL(match)
        if (url.password) url.password = '***'
        return url.toString()
      } catch {
        return 'postgres' + 'ql://[redacted]'
      }
    })
    .replace(/(password|pwd)\s*=\s*[^\s"']+/gi, '$1=***')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[redacted]')
}

function log(message: string) {
  if (!JSON_OUT) console.log(redactSecrets(message))
}

function bin(tool: string): string {
  const path = PGBIN_DIR ? join(PGBIN_DIR, tool) : tool
  const probe = spawnSync(path, ['--version'], { encoding: 'utf8', timeout: 30_000 })
  if (probe.error || probe.status !== 0) {
    throw new BackupFailure(
      `${tool} not found or not executable (tried: ${path}). Install PostgreSQL client tools or set PGBIN_DIR.`,
      2,
    )
  }
  return path
}

interface RunResult { stdout: string; stderr: string }

/** Run a client command, or throw. Never exits, so callers keep their cleanup. */
function run(tool: string, runArgs: string[], options: { timeoutMs?: number } = {}): RunResult {
  const result = spawnSync(bin(tool), runArgs, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    timeout: options.timeoutMs ?? TIMEOUT_MS,
  })
  if (result.error) {
    const timedOut = (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
    throw new BackupFailure(
      timedOut
        ? `${tool} timed out after ${Math.round((options.timeoutMs ?? TIMEOUT_MS) / 1000)}s.`
        : `${tool} could not run: ${result.error.message}`,
    )
  }
  if (result.status !== 0) {
    const detail = redactSecrets(String(result.stderr || '').slice(0, 4000)).trim()
    throw new BackupFailure(`${tool} exited ${result.status}${detail ? `: ${detail}` : '.'}`)
  }
  return { stdout: result.stdout || '', stderr: result.stderr || '' }
}

/**
 * Cleanup registry. Every resource acquired during verification registers its
 * own reversal here at the moment it is created, so there is no path where a
 * failure can skip it.
 */
interface CleanupTask { name: string; run: () => void }

export function createCleanupRegistry() {
  const tasks: CleanupTask[] = []
  return {
    add(name: string, run: () => void) { tasks.push({ name, run }) },
    /** Run every task; returns the failures instead of throwing them. */
    runAll(): Array<{ name: string; error: Error }> {
      const failures: Array<{ name: string; error: Error }> = []
      // Reverse order: later resources may depend on earlier ones.
      for (const task of [...tasks].reverse()) {
        try {
          task.run()
        } catch (error) {
          failures.push({ name: task.name, error: error instanceof Error ? error : new Error(String(error)) })
        }
      }
      tasks.length = 0
      return failures
    },
    get size() { return tasks.length },
  }
}

export type CleanupRegistry = ReturnType<typeof createCleanupRegistry>

/** Quote an identifier for DDL. Only generated names reach this. */
export function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    throw new BackupFailure(`Refusing unsafe database identifier: ${name}`)
  }
  return `"${name}"`
}

function maintenanceUrl(dbUrl: string): string {
  const url = new URL(dbUrl)
  url.pathname = '/postgres'
  return url.toString()
}

export function scratchDbName(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  return `barber_backup_verify_${stamp}_${Math.random().toString(36).slice(2, 8)}`
}

function ts(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

/** The connection string for the scratch database, derived without guessing. */
export function databaseUrlFor(dbUrl: string, database: string): string {
  const url = new URL(dbUrl)
  url.pathname = `/${database}`
  return url.toString()
}

/**
 * pg_dump writes plain SQL to stdout, so a dump can be validated before it is
 * ever written to disk or uploaded: an empty or schema-less output is a client
 * misconfiguration (wrong database, missing grants), not a backup.
 */
export function dumpToBuffer(dbUrl: string): Buffer {
  const result = spawnSync(bin('pg_dump'), [
    '--dbname', dbUrl, '--format=plain', '--no-owner', '--no-privileges', '--no-comments',
  ], { maxBuffer: 512 * 1024 * 1024, timeout: TIMEOUT_MS })
  if (result.error) {
    const timedOut = (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
    throw new BackupFailure(timedOut ? `pg_dump timed out after ${TIMEOUT_MS / 1000}s.` : `pg_dump could not run: ${result.error.message}`)
  }
  if (result.status !== 0 || !result.stdout) {
    throw new BackupFailure(`pg_dump exited ${result.status}. ${redactSecrets(String(result.stderr || '').slice(0, 2000))}`)
  }
  const dump = Buffer.from(result.stdout)
  if (dump.length < 1024) throw new BackupFailure(`pg_dump produced only ${dump.length} bytes: suspiciously small for a schema+data dump.`)
  const text = dump.toString('utf8')
  if (!text.includes('CREATE TABLE') || !text.includes('COPY ')) {
    throw new BackupFailure('dump does not look like a schema+data PostgreSQL dump.')
  }
  return dump
}

const UNSAFE_SESSION_SETTINGS =
  /^SET\s+(transaction_timeout|idle_session_timeout|idle_in_transaction_session_timeout)\s*=/i

/**
 * Cross-version compatibility: a pg_dump from a NEWER client emits session
 * settings the older server rejects (e.g. `SET transaction_timeout = 0;` from a
 * client 17 dump restored into a server 15), which aborts the whole restore.
 * These are per-session knobs with no bearing on the data, so drop them rather
 * than let a client/server version skew make a good backup look corrupt.
 */
export function sanitizeDumpForRestore(text: string): { text: string; droppedLines: number } {
  const lines = text.split('\n')
  const kept = lines.filter((line) => !UNSAFE_SESSION_SETTINGS.test(line))
  return { text: kept.join('\n'), droppedLines: lines.length - kept.length }
}

function scalar(dbUrl: string, sql: string): string {
  return run('psql', [dbUrl, '--no-psqlrc', '--tuples-only', '--no-align', '--quiet', '--command', sql], {
    timeoutMs: Math.min(TIMEOUT_MS, 120_000),
  }).stdout.trim()
}

function tableExists(dbUrl: string, table: string): boolean {
  const exists = scalar(dbUrl, `SELECT to_regclass('public."${table}"') IS NOT NULL;`)
  return exists.toLowerCase() === 't'
}

/**
 * Every single-column foreign key, with the row count that violates it. A
 * restored database with orphaned children is not a usable recovery copy: the
 * application would render half a tenant's history and then fail on write.
 * Constraints are read from the catalog rather than hard-coded, so a new model
 * is covered without touching this script.
 */
function foreignKeyViolations(dbUrl: string): Array<{ constraint: string; violations: number }> {
  const rows = scalar(dbUrl, `
    SELECT c.conname || '|' || c.conrelid::regclass::text || '|' || a.attname || '|' ||
           c.confrelid::regclass::text || '|' || af.attname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
    ORDER BY c.conname;`)
  if (!rows) return []
  const violations: Array<{ constraint: string; violations: number }> = []
  for (const line of rows.split('\n')) {
    const [name, table, column, refTable, refColumn] = line.split('|')
    if (!name || !table || !column || !refTable || !refColumn) continue
    const counts = scalar(
      dbUrl,
      `SELECT count(*) FROM ${table} t LEFT JOIN ${refTable} r ON t."${column}" = r."${refColumn}" ` +
      `WHERE t."${column}" IS NOT NULL AND r."${refColumn}" IS NULL;`,
    )
    const value = Number(counts)
    if (Number.isFinite(value) && value > 0) violations.push({ constraint: name, violations: value })
  }
  return violations
}

const KEY_TABLES = ['Business', 'User', 'Appointment', 'Customer', 'Barber', 'Service', 'Payment'] as const

export interface VerifyEvidence {
  restoredTables: number
  rowCounts: Record<string, number>
  foreignKeyViolations: Array<{ constraint: string; violations: number }>
  migrationsApplied: number
  dumpBytes: number
  dumpSha256: string
}

/**
 * Restore a dump into a disposable database and prove it is a faithful copy.
 * Returns evidence; throws BackupFailure on any mismatch. The caller owns
 * cleanup, and registers it before this is called.
 */
export function verifyRestore(sourceUrl: string, dumpText: string, cleanup: CleanupRegistry): VerifyEvidence {
  const scratch = scratchDbName()
  const scratchUrl = databaseUrlFor(sourceUrl, scratch)
  const maintenance = maintenanceUrl(sourceUrl)
  log(`[backup] verify: scratch database ${scratch}`)

  log('[backup] step 2/6: create scratch database')
  run('psql', [maintenance, '--no-psqlrc', '--quiet', '--command', `CREATE DATABASE ${quoteIdent(scratch)};`], {
    timeoutMs: 120_000,
  })
  // Registered immediately: from here on, every failure path drops it.
  cleanup.add(`drop scratch database ${scratch}`, () => {
    run('psql', [maintenance, '--no-psqlrc', '--quiet', '--command', `DROP DATABASE IF EXISTS ${quoteIdent(scratch)};`], {
      timeoutMs: 120_000,
    })
  })

  log('[backup] step 3/6: restore dump')
  const dumpPath = join(
    process.env.TMPDIR || '/tmp',
    `barber-restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sql`,
  )
  writeFileSync(dumpPath, dumpText)
  cleanup.add('remove temp restore file', () => { if (existsSync(dumpPath)) rmSync(dumpPath) })
  run('psql', [scratchUrl, '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--quiet', '--file', dumpPath])

  log('[backup] step 4/6: schema and row-count parity')
  const restoredTables = Number(scalar(scratchUrl,
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"))
  if (!Number.isFinite(restoredTables) || restoredTables < 10) {
    throw new BackupFailure(`restored copy exposes only ${restoredTables} base tables; expected the full application schema.`)
  }

  const rowCounts: Record<string, number> = {}
  for (const table of KEY_TABLES) {
    if (!tableExists(sourceUrl, table)) continue
    const fromSource = Number(scalar(sourceUrl, `SELECT count(*) FROM "${table}";`))
    const fromRestored = tableExists(scratchUrl, table)
      ? Number(scalar(scratchUrl, `SELECT count(*) FROM "${table}";`))
      : -1
    if (fromSource !== fromRestored) {
      throw new BackupFailure(`row-count mismatch on "${table}": source ${fromSource} vs restored ${fromRestored}.`)
    }
    rowCounts[table] = fromRestored
    log(`  ok  "${table}": ${fromRestored} rows match source`)
  }

  log('[backup] step 5/6: relationship and tenant integrity')
  const violations = foreignKeyViolations(scratchUrl)
  if (violations.length > 0) {
    const detail = violations.map((v) => `${v.constraint} (${v.violations})`).join(', ')
    throw new BackupFailure(`restored copy violates ${violations.length} foreign key(s): ${detail}`)
  }
  log('  ok  every foreign key holds in the restored copy')
  if (tableExists(scratchUrl, 'Appointment') && tableExists(scratchUrl, 'Business')) {
    const orphanAppointments = Number(scalar(scratchUrl,
      'SELECT count(*) FROM "Appointment" a LEFT JOIN "Business" b ON a."businessId" = b."id" WHERE b."id" IS NULL;'))
    if (orphanAppointments !== 0) {
      throw new BackupFailure(`restored copy has ${orphanAppointments} appointments without a business (tenant integrity).`)
    }
    log('  ok  no orphaned appointments (tenant integrity)')
  }

  let migrationsApplied = 0
  if (tableExists(scratchUrl, '_prisma_migrations')) {
    migrationsApplied = Number(scalar(scratchUrl,
      "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;"))
    const sourceMigrations = tableExists(sourceUrl, '_prisma_migrations')
      ? Number(scalar(sourceUrl, "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;"))
      : migrationsApplied
    if (migrationsApplied !== sourceMigrations) {
      throw new BackupFailure(`migration history mismatch: source ${sourceMigrations} applied vs restored ${migrationsApplied}.`)
    }
    log(`  ok  ${migrationsApplied} applied migrations restored (chain is portable)`)
  }

  log(`  ok  ${restoredTables} base tables restored`)

  log('[backup] step 6/6: drop scratch database')
  // Drop eagerly so the expensive resource is released even on a later failure;
  // the registry entry stays harmless because it uses IF EXISTS.
  run('psql', [maintenance, '--no-psqlrc', '--quiet', '--command', `DROP DATABASE ${quoteIdent(scratch)};`], {
    timeoutMs: 120_000,
  })

  return {
    restoredTables,
    rowCounts,
    foreignKeyViolations: violations,
    migrationsApplied,
    dumpBytes: Buffer.byteLength(dumpText, 'utf8'),
    dumpSha256: createHash('sha256').update(dumpText, 'utf8').digest('hex'),
  }
}

function verify(dbUrl: string, outDir: string, keep: boolean): void {
  const started = Date.now()
  log(`[backup] verify: source ${redactSecrets(databaseUrlFor(dbUrl, new URL(dbUrl).pathname.replace(/^\//, '') || 'postgres'))}`)

  // 1. Obtain the dump: from disk when verifying an artifact (this is how the
  //    off-site copy is proven restorable), otherwise fresh from the database.
  let dumpText: string
  if (FILE_ARG) {
    log(`[backup] step 1/6: read ${FILE_ARG}`)
    if (!existsSync(FILE_ARG)) throw new BackupFailure(`cannot verify ${FILE_ARG}: file not found.`, 2)
    const raw = readFileSync(FILE_ARG)
    let plain = raw
    if (FILE_ARG.endsWith('.gz') || (raw[0] === 0x1f && raw[1] === 0x8b)) {
      try {
        plain = gunzipSync(raw)
      } catch {
        throw new BackupFailure('the backup file is not a valid gzip archive (corrupted or truncated).')
      }
    }
    if (plain.length < 1024) throw new BackupFailure('the backup file is suspiciously small; refusing to call it a backup.')
    dumpText = plain.toString('utf8')
    if (!dumpText.includes('CREATE TABLE')) throw new BackupFailure('the backup file contains no schema; it cannot restore a database.')
  } else {
    log('[backup] step 1/6: pg_dump source database')
    dumpText = dumpToBuffer(dbUrl).toString('utf8')
  }

  const { text: sanitized, droppedLines } = sanitizeDumpForRestore(dumpText)
  if (droppedLines > 0) {
    log('[backup] note: dropped incompatible session settings from the dump (client/server version skew)')
  }

  const cleanup = createCleanupRegistry()
  let tempDump: string | null = null
  try {
    if (!FILE_ARG) {
      tempDump = join(outDir, `verify-${ts()}.sql`)
      writeFileSync(tempDump, sanitized)
      cleanup.add('remove temp dump', () => {
        if (tempDump && !keep && existsSync(tempDump)) rmSync(tempDump)
      })
    }
    const evidence = verifyRestore(dbUrl, sanitized, cleanup)
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    log(`[backup] PASS: backup verified by full restore (${seconds}s)${keep && tempDump ? ` — dump kept at ${tempDump}` : ''}`)
    if (JSON_OUT) {
      console.log(JSON.stringify({ ok: true, mode: 'verify', seconds: Number(seconds), evidence }))
    }
  } finally {
    const cleanupFailures = cleanup.runAll()
    if (cleanupFailures.length > 0) {
      // Report, never mask: the original error (if any) is already propagating.
      for (const failure of cleanupFailures) {
        console.error(`[backup] WARNING: cleanup step "${failure.name}" failed: ${redactSecrets(failure.error.message)}`)
      }
      if (tempDump && existsSync(tempDump)) {
        console.error(`[backup] WARNING: temp dump left behind at ${tempDump} (mode: manual cleanup required)`)
      }
    }
  }
}

function backup(dbUrl: string, outDir: string): void {
  const outFile = join(outDir, `barber-${ts()}.sql.gz`)
  log(`[backup] dumping to ${outFile}`)
  const dump = dumpToBuffer(dbUrl)
  const gz = gzipSync(dump)
  writeFileSync(outFile, gz)
  const size = statSync(outFile).size
  const checksum = createHash('sha256').update(gz).digest('hex')
  log(`[backup] OK: ${(size / 1024).toFixed(1)} KiB (gzip), sha256 ${checksum.slice(0, 16)}…`)
  log('[backup] Verify it with: npm run db:backup-verify -- --file <this file> (or without --file for a live restore test)')
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: true, mode: 'dump', file: outFile, sizeBytes: size, sha256: checksum }))
  }
}

async function main(): Promise<number> {
  const dbUrl = argValue('--url') || process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('[backup] ERROR: no --url and no DATABASE_URL set.')
    return 2
  }
  if (!/^postgres(ql)?:\/\//.test(dbUrl)) {
    console.error('[backup] ERROR: the connection string must start with postgresql:// (value redacted).')
    return 2
  }
  const outDir = argValue('--out') || 'backups'
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  // bin() is called by every operation; probing once here turns a missing
  // client into an immediate, obvious message instead of a mid-restore failure.
  bin('psql')
  bin('pg_dump')

  if (VERIFY) verify(dbUrl, outDir, KEEP)
  else backup(dbUrl, outDir)
  if (JSON_OUT) return 0
  return 0
}

// The ONLY place this script decides to exit, so cleanup inside main() can
// never be skipped by a helper.
if (process.argv[1] && /backup\.ts$|backup\.js$/.test(process.argv[1])) {
  main()
    .then((code) => { process.exitCode = code })
    .catch(async (error: unknown) => {
      const failure = error instanceof BackupFailure ? error : new BackupFailure(error instanceof Error ? error.message : String(error))
      const message = redactSecrets(failure.message)
      console.error(`[backup] FAILED: ${message}`)
      // Critical, deduped, and never allowed to change the exit code.
      try {
        await sendAlert({
          event: 'backup_failed',
          severity: 'critical',
          summary: 'A database backup could not be completed. The shop is operating normally, but the backup needs attention.',
          context: { operation: VERIFY ? 'verify' : 'dump', reason: message.slice(0, 200) },
          dedupeKey: 'backup_failed:database',
        })
      } catch { /* alerting must never mask the backup failure */ }
      if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: message }))
      process.exitCode = failure.exitCode
    })
}

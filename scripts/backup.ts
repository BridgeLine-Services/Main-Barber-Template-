// ============================================================================
// Backup automation + verified restore testing (Operations Guide § Backups)
//
//   npm run db:backup                       dump DATABASE_URL -> backups/*.sql.gz
//   npm run db:backup-verify                dump + restore into a scratch
//                                          database + sanity checks, then
//                                          drop the scratch database
//
// Flags:
//   --url <conn>   connection string (default: DATABASE_URL)
//   --out <dir>    output directory (default: backups/)
//   --keep         in verify mode, keep the dump file instead of deleting it
//
// Requires pg_dump + psql on PATH (or set PGBIN_DIR to a bin directory).
// Verify mode needs CREATE DATABASE rights on the target server; production
// DATABASE_URL users may lack that — in that case run verify against a
// staging copy or an admin URL passed via --url.
// ============================================================================

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const args = process.argv.slice(2)
function argValue(name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}
const VERIFY = args.includes('--verify')
const KEEP = args.includes('--keep')

const PGBIN_DIR = process.env.PGBIN_DIR || ''
function bin(tool: string): string {
  const p = PGBIN_DIR ? join(PGBIN_DIR, tool) : tool
  const probe = spawnSync(p, ['--version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    console.error(`[backup] ERROR: ${tool} not found or not executable (tried: ${p}).`)
    console.error('[backup] Install PostgreSQL client tools or set PGBIN_DIR.')
    process.exit(2)
  }
  return p
}

function run(tool: string, runArgs: string[], okStatus = 0): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(bin(tool), runArgs, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
  if (r.status !== okStatus) {
    console.error(`[backup] ERROR: ${tool} exited ${r.status}`)
    if (r.stderr) console.error(r.stderr.slice(0, 4000))
    process.exit(1)
  }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

function maintenanceUrl(dbUrl: string): string {
  const u = new URL(dbUrl)
  u.pathname = '/postgres'
  return u.toString()
}

function scratchDbName(): string {
  return `barber_backup_verify_${Date.now()}`
}

function ts(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

function dumpTo(dbUrl: string, outFile: string): number {
  const r = spawnSync(bin('pg_dump'), [
    '--dbname', dbUrl, '--format=plain', '--no-owner', '--no-privileges', '--no-comments',
  ], { maxBuffer: 512 * 1024 * 1024 })
  if (r.status !== 0 || !r.stdout || r.stdout.length < 1024) {
    console.error(`[backup] ERROR: pg_dump exited ${r.status} (or produced a suspiciously small dump).`)
    if (r.stderr) console.error(String(r.stderr).slice(0, 4000))
    process.exit(1)
  }
  const dump = String(r.stdout)
  if (!dump.includes('CREATE TABLE') || !dump.includes('COPY ')) {
    console.error('[backup] ERROR: dump does not look like a schema+data PostgreSQL dump.')
    process.exit(1)
  }
  const gz = gzipSync(Buffer.from(dump, 'utf8'))
  const { writeFileSync } = require('node:fs') as typeof import('node:fs')
  writeFileSync(outFile, gz)
  return statSync(outFile).size
}

function scalar(dbUrl: string, sql: string): string {
  const r = run('psql', [dbUrl, '--no-psqlrc', '--tuples-only', '--no-align', '--quiet', '--command', sql])
  return r.stdout.trim()
}

function verify(dbUrl: string, outDir: string, keep: boolean) {
  const started = Date.now()
  const maintenance = maintenanceUrl(dbUrl)
  const scratch = scratchDbName()
  const tempDump = join(outDir, `verify-${ts()}.sql`)
  console.log(`[backup] verify: source ${dbUrl.replace(/:[^:@/]+@/, ':***@')}`)
  console.log(`[backup] verify: scratch database ${scratch}`)

  // 1. Dump to a plain-SQL temp file.
  console.log('[backup] step 1/5: pg_dump source database')
  const dump = spawnSync(bin('pg_dump'), [
    '--dbname', dbUrl, '--format=plain', '--no-owner', '--no-privileges', '--no-comments',
  ], { maxBuffer: 512 * 1024 * 1024 })
  if (dump.status !== 0 || !dump.stdout) {
    console.error('[backup] ERROR: pg_dump failed during verification.')
    process.exit(1)
  }
  const { writeFileSync } = require('node:fs') as typeof import('node:fs')
  writeFileSync(tempDump, dump.stdout)

  try {
    // 2. Create scratch database.
    console.log('[backup] step 2/5: create scratch database')
    run('psql', [maintenance, '--no-psqlrc', '--quiet', '--command', `CREATE DATABASE "${scratch}";`])

    // 3. Restore into scratch with ON_ERROR_STOP.
    console.log('[backup] step 3/5: restore dump into scratch database')
    run('psql', [`${dbUrl.replace(/\/[^/]*$/, '')}/${scratch}`, '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--quiet', '--file', tempDump])

    // 4. Sanity checks on the restored copy.
    console.log('[backup] step 4/5: sanity checks')
    const scratchUrl = `${dbUrl.replace(/\/[^/]*$/, '')}/${scratch}`
    const tableCount = Number(scalar(scratchUrl, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"))
    if (!Number.isFinite(tableCount) || tableCount < 10) {
      console.error(`[backup] ERROR: restored copy exposes only ${tableCount} base tables; expected the full application schema.`)
      process.exit(1)
    }
    for (const table of ['Business', 'User', 'Appointment']) {
      const src = Number(scalar(dbUrl, `SELECT count(*) FROM "${table}";`))
      const dst = Number(scalar(scratchUrl, `SELECT count(*) FROM "${table}";`))
      if (src !== dst) {
        console.error(`[backup] ERROR: row-count mismatch on "${table}": source ${src} vs restored ${dst}.`)
        process.exit(1)
      }
      console.log(`  ok  "${table}": ${dst} rows match source`)
    }
    const noOrphans = scalar(scratchUrl, 'SELECT count(*) FROM "Appointment" a LEFT JOIN "Business" b ON a."businessId" = b."id" WHERE b."id" IS NULL;')
    if (Number(noOrphans) !== 0) {
      console.error(`[backup] ERROR: restored copy has ${noOrphans} appointments without a business (tenant integrity).`)
      process.exit(1)
    }
    console.log('  ok  no orphaned appointments (tenant integrity)')
    console.log(`  ok  ${tableCount} base tables restored`)

    // 5. Drop scratch database.
    console.log('[backup] step 5/5: drop scratch database')
    run('psql', [maintenance, '--no-psqlrc', '--quiet', '--command', `DROP DATABASE "${scratch}";`])
  } finally {
    if (!keep && existsSync(tempDump)) rmSync(tempDump)
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`[backup] PASS: backup verified by full restore (${seconds}s)${keep ? ` — dump kept at ${tempDump}` : ''}`)
}

function main() {
  const dbUrl = argValue('--url') || process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('[backup] ERROR: no --url and no DATABASE_URL set.')
    process.exit(2)
  }
  const outDir = argValue('--out') || 'backups'
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  if (VERIFY) {
    verify(dbUrl, outDir, KEEP)
    return
  }

  const outFile = join(outDir, `barber-${ts()}.sql.gz`)
  console.log(`[backup] dumping to ${outFile}`)
  const size = dumpTo(dbUrl, outFile)
  console.log(`[backup] OK: ${(size / 1024).toFixed(1)} KiB (gzip). Schedule this via cron; verify with: npm run db:backup-verify -- --url <same connection string>`)
}

main()

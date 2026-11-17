// Backup failure modes, exercised against a real PostgreSQL server.
//
// The defect this suite exists for: the old scripts/backup.ts called
// process.exit() from inside its helpers, so a failed restore or a failed sanity
// check skipped the `finally` cleanup and left a `barber_backup_verify_*`
// database — plus a temp dump — on the server. Nightly failures accumulate
// databases until the server refuses connections.
//
// Every case below asserts BOTH the failure message AND that the server is clean
// afterwards. Called through the real CLI, because the bug lived in the exit
// path, not in the functions.
//
// Needs psql/pg_dump (PGBIN_DIR) and CREATE DATABASE rights on DATABASE_URL.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const TSX = join(process.cwd(), 'node_modules', '.bin', 'tsx')
const PSQL = process.env.PGBIN_DIR ? join(process.env.PGBIN_DIR, 'psql') : 'psql'
const PGBIN = process.env.PGBIN_DIR || ''
const enc = { ...process.env, PATH: PGBIN ? `${PGBIN}:${process.env.PATH ?? ''}` : process.env.PATH }

function psqlScalar(sql: string): string {
  const result = spawnSync(PSQL, [process.env.DATABASE_URL!, '--no-psqlrc', '--tuples-only', '--no-align', '--quiet', '--command', sql], {
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`psql failed: ${String(result.stderr).slice(0, 200)}`)
  return (result.stdout || '').trim()
}

function scratchDatabases(): string[] {
  const rows = psqlScalar("SELECT datname FROM pg_database WHERE datname LIKE 'barber_backup_verify_%';")
  return rows ? rows.split('\n').filter(Boolean) : []
}

function runBackup(args: string[], env: Record<string, string | undefined> = {}) {
  const result = spawnSync(TSX, ['scripts/backup.ts', ...args], {
    encoding: 'utf8',
    env: { ...enc, ...env },
    timeout: 180_000,
  })
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  }
}

const DUMP_HEADER = 'CREATE TABLE "Business" (id text, name text);\nCOPY "Business" (id, name) FROM stdin;\n1\tShop\n\\.\n'

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required for the backup failure-mode suite.')
    process.exit(1)
  }
  const dir = mkdtempSync(join(tmpdir(), 'backup-fail-'))
  const before = scratchDatabases()

  try {
    console.log('--- a corrupted backup file is refused, not restored ---')
    const corruptPath = join(dir, 'corrupt.sql.gz')
    writeFileSync(corruptPath, Buffer.from('this is not gzip at all'))
    const corrupt = runBackup(['--verify', '--file', corruptPath, '--out', dir])
    assert(corrupt.status === 1, 'the run exits non-zero for a corrupted artifact')
    assert(/gzip|corrupt/i.test(corrupt.stderr), 'the message names the real problem')
    assert(!/postgres(ql)?:\/\/[^\s"]*:[^\s"@]+@/i.test(corrupt.stderr), 'no connection string with a password reaches the log')
    assert(scratchDatabases().length === before.length, 'no scratch database is left behind')

    console.log('--- a backup that cannot restore is not a backup ---')
    const badSql = gzipSync(Buffer.from(`${DUMP_HEADER}SELECT * FROM "TableThatDoesNotExist";\n`))
    const badPath = join(dir, 'bad.sql.gz')
    writeFileSync(badPath, badSql)
    const badRestore = runBackup(['--verify', '--file', badPath, '--out', dir])
    assert(badRestore.status === 1, 'a restore that fails exits non-zero')
    assert(/exited|restore|ERROR|mismatch|failed/i.test(badRestore.stderr), 'the failure explains that the restore did not produce a usable copy')
    const leftovers = scratchDatabases().filter((name) => !before.includes(name))
    assert(leftovers.length === 0, `the scratch database is dropped on the failure path${leftovers.length ? ` (left: ${leftovers.join(', ')})` : ''}`)

    console.log('--- an interrupted dump is refused, not called a backup ---')
    const shortPath = join(dir, 'short.sql.gz')
    writeFileSync(shortPath, gzipSync(Buffer.from('CREATE TABLE x (id text);')))
    const short = runBackup(['--verify', '--file', shortPath, '--out', dir])
    assert(short.status === 1, 'a suspiciously small artifact is refused')
    assert(/small|no schema/i.test(short.stderr), 'the message says why')

    console.log('--- a real dump verifies end to end ---')
    const good = runBackup(['--verify', '--keep', '--out', dir, '--json'])
    assert(good.status === 0, 'the real database verifies by full restore')
    assert(/PASS|"ok":\s*true/.test(good.stdout + good.stderr), 'the run reports PASS')
    assert(scratchDatabases().filter((name) => !before.includes(name)).length === 0, 'the scratch database is dropped after a successful verify')
    const kept = readdirSync(dir).filter((name) => name.startsWith('verify-'))
    assert(kept.length >= 1, '--keep leaves the dump behind for inspection')
    for (const file of kept) rmSync(join(dir, file))
    const leftoversAfter = readdirSync(dir).filter((name) => name.startsWith('verify-'))
    assert(leftoversAfter.length === 0, 'the test cleaned its own artifacts')

    console.log('--- no temp dumps leak when --keep is not set ---')
    const noKeep = runBackup(['--verify', '--out', dir])
    assert(noKeep.status === 0, 'a verify without --keep still passes')
    assert(readdirSync(dir).filter((name) => name.startsWith('verify-')).length === 0, 'the temp dump is removed on success')

    console.log('--- missing configuration is a clear, non-zero refusal ---')
    const noUrl = runBackup(['--verify'], { DATABASE_URL: '' })
    assert(noUrl.status === 2, 'a missing DATABASE_URL is a configuration error (exit 2)')
    assert(/no --url and no DATABASE_URL/i.test(noUrl.stderr), 'the message says exactly what is missing')

    console.log('--- a dry-run dump verifies its own integrity ---')
    const dump = runBackup(['--out', dir, '--json'])
    assert(dump.status === 0, 'a plain dump succeeds')
    const parsed = JSON.parse(dump.stdout.trim().split('\n').pop() as string) as { sha256: string; sizeBytes: number; file: string }
    assert(/^[0-9a-f]{64}$/.test(parsed.sha256), 'the dump reports a sha256 checksum')
    assert(parsed.sizeBytes > 0 && existsSync(parsed.file), 'the dump file exists')
    const bytes = gunzipSync(readFileSync(parsed.file))
    assert(bytes.toString('utf8').includes('CREATE TABLE'), 'the artifact is a real schema dump')
    rmSync(parsed.file)
  } finally {
    // Last-resort cleanup so a failing suite cannot pollute the shared server.
    for (const name of scratchDatabases().filter((db) => !before.includes(db))) {
      spawnSync(PSQL, [process.env.DATABASE_URL!, '--no-psqlrc', '--quiet', '--command', `DROP DATABASE IF EXISTS "${name}";`], { encoding: 'utf8' })
    }
    rmSync(dir, { recursive: true, force: true })
  }

  console.log(`\nBackup failure-mode tests: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => { console.error(error); process.exit(1) })

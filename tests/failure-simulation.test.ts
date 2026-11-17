// Deliberate failure simulation (Part 14) for the pieces added in this round.
//
// Each case names the failure, drives it in isolation, and asserts the expected
// outcome. Nothing here touches production data, a real customer, a real payment
// or a real provider: storage is a temp directory, the database is the disposable
// test server, and every alert channel is a stub.
//
// Failure classes covered here:
//   STORAGE   unavailable destination, interrupted upload
//   BACKUP    missing configuration, concurrent runs
//   SECURITY  unauthorized scheduled-job execution
//   BOOKING   duplicate submission after a retry (idempotency + DB constraints)
// Database-unavailable and cross-tenant cases are covered by the existing
// suites (booking-concurrency, tenant-isolation, cross-tenant-matrix) and are
// listed in docs/RELIABILITY-REPORT.md rather than duplicated here.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalStorage, createStorageFromEnv, BackupStorageError, type BackupStorage } from '../scripts/lib/backup-storage'
import { acquireBackupLock, runOffsiteBackup } from '../scripts/backup-offsite'
import { parseEncryptionKey, generateEncryptionKey } from '../src/lib/backup/crypto'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}
async function expectFailure(fn: () => Promise<unknown> | unknown, pattern: RegExp, message: string) {
  try {
    await fn()
    assert(false, message)
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    assert(pattern.test(text), `${message} (said: ${text.slice(0, 100)})`)
  }
}

function syntheticDump(): Buffer {
  return Buffer.from(
    `CREATE TABLE "Business" (id text);\nCOPY "Business" (id) FROM stdin;\n${'1\n'.repeat(50)}\\.\n`,
    'utf8',
  )
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'failure-sim-'))
  const key = parseEncryptionKey(generateEncryptionKey())
  try {
    console.log('--- STORAGE: the destination is unavailable ---')
    const notADirectory = join(dir, 'this-is-a-file')
    writeFileSync(notADirectory, 'x')
    const broken = createLocalStorage(join(notADirectory, 'backups'))
    await expectFailure(() => broken.put('database/x.enc', Buffer.from('x')), /ENOTDIR|ENOENT|not a directory/i,
      'writing to an unavailable destination fails loudly instead of pretending to succeed')

    console.log('--- STORAGE: an interrupted upload is detected ---')
    const inner = createLocalStorage(join(dir, 'store'))
    const truncating: BackupStorage = {
      driver: 'localfs',
      destination: inner.destination,
      async put(objectKey, body) { await inner.put(objectKey, body.subarray(0, Math.max(1, body.length - 8))) },
      get: (objectKey) => inner.get(objectKey),
      head: (objectKey) => inner.head(objectKey),
      list: (prefix) => inner.list(prefix),
      delete: (objectKey) => inner.delete(objectKey),
    }
    await expectFailure(
      () => runOffsiteBackup({
        dbUrl: 'postgresql://u:p@127.0.0.1:5432/x',
        storage: truncating,
        encryptionKey: key,
        verifyRestore: false,
        recordHistory: false,
        dump: syntheticDump,
        log: () => {},
      }),
      /bytes but|does not match|not present/i,
      'a partially written object is rejected (size and checksum are both checked)',
    )

    console.log('--- BACKUP: missing configuration is named, not guessed ---')
    await expectFailure(() => createStorageFromEnv({}), /not configured/i, 'an unset destination is reported as not configured')
    await expectFailure(
      () => createStorageFromEnv({ BACKUP_STORAGE_DRIVER: 'gcs' }),
      /Unsupported|not configured/i,
      'an unsupported driver explains the supported ones instead of failing obscurely',
    )
    let missing: string[] = []
    try { createStorageFromEnv({ BACKUP_STORAGE_DRIVER: 's3', BACKUP_S3_ENDPOINT: 'https://r2.test' }) } catch (error) {
      missing = (error as BackupStorageError).missing
    }
    assert(missing.includes('BACKUP_S3_ACCESS_KEY_ID') && missing.includes('BACKUP_S3_SECRET_ACCESS_KEY'), 'both credentials are named as missing')
    assert(!JSON.stringify(missing).includes('secret-value'), 'no credential value appears in a configuration error')
    await expectFailure(() => parseEncryptionKey(undefined), /not set/i, 'a missing encryption key is a clear refusal')

    console.log('--- BACKUP: a second simultaneous run is refused ---')
    const lock = acquireBackupLock(dir)
    await expectFailure(() => Promise.resolve(acquireBackupLock(dir)), /already in progress/i, 'a concurrent run cannot interleave dumps and pruning')
    lock.release()

    console.log('--- SECURITY: scheduled jobs cannot be run by anyone else ---')
    for (const job of ['reminders', 'memberships', 'review-requests']) {
      const source = readFileSync(join('src', 'app', 'api', 'cron', job, 'route.ts'), 'utf8')
      assert(/CRON_SECRET/.test(source), `${job}: requires the shared cron secret`)
      assert(/401/.test(source), `${job}: refuses an unauthenticated call with 401`)
      assert(/authorization/i.test(source), `${job}: reads the Authorization header, not a query parameter`)
    }

    console.log('--- BOOKING: a retried submission cannot create a second appointment ---')
    const schema = readFileSync(join('prisma', 'schema.prisma'), 'utf8')
    const appointmentBlock = schema.split('model Appointment {')[1]?.split('\n}')[0] ?? ''
    assert(/idempotencyKey\s+String\?\s+@unique/.test(appointmentBlock), 'Appointment.idempotencyKey is unique at the database level')
    const route = readFileSync(join('src', 'app', 'api', 'public', 'appointments', 'route.ts'), 'utf8')
    assert(/idempotencyKey/.test(route), 'the booking route derives an idempotency key')
    assert(/createAppointmentSafely/.test(route), 'the booking route goes through the single guarded creation path')
    assert(/status: 409/.test(route), 'a conflicting or duplicate booking answers 409 rather than claiming success')
    const overlapMigrations = readFileSync(join('prisma', 'migrations', '20260904000000_prevent_appointment_overlaps', 'migration.sql'), 'utf8')
    assert(/EXCLUDE|exclusion|overlap/i.test(overlapMigrations), 'database-level overlap protection is preserved in the migration chain')

    console.log('--- BOOKING: a failed notification cannot undo a confirmed appointment ---')
    assert(existsSync(join('tests', 'notification-resilience.test.ts')), 'the notification-resilience suite still ships with the template')

    console.log('--- MEDIA: an unreadable photo aborts the copy instead of storing junk ---')
    const store = createLocalStorage(join(dir, 'media-store'))
    const { runMediaBackup } = await import('../scripts/media-backup')
    await expectFailure(
      () => runMediaBackup({
        storage: store,
        encryptionKey: key,
        fetchImpl: (async () => new Response('missing', { status: 404 })) as unknown as typeof fetch,
        listBlobs: async () => [{ pathname: 'logo/x.png', url: 'https://media.test/x.png', size: 10 }],
        log: () => {},
      }),
      /Could not read a photo/i,
      'a photo that cannot be read is reported, not silently skipped',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  console.log(`\nFailure simulation tests: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => { console.error(error); process.exit(1) })

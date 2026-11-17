// Backup safety invariants.
//
// These are the properties that must never regress, because every one of them has
// a data-loss shape: a credential in a log, an identifier that escapes its quotes,
// a retention pass that deletes the last good copy, an encrypted object that
// decrypts to something other than the dump that was taken.
//
// Pure functions only: no database, no bucket, no network.

import {
  databaseUrlFor,
  quoteIdent,
  redactSecrets,
  sanitizeDumpForRestore,
  scratchDbName,
  createCleanupRegistry,
} from '../scripts/backup'
import {
  acquireBackupLock,
  listManifests,
} from '../scripts/backup-offsite'
import { createLocalStorage } from '../scripts/lib/backup-storage'
import {
  assertRetentionSafe,
  isVerified,
  retentionPolicyFromEnv,
  RETENTION_FLOOR,
  RETENTION_MINIMUMS,
  selectExpiredBackups,
  type BackupManifest,
} from '../src/lib/backup/manifest'
import {
  decryptBackup,
  encryptBackup,
  generateEncryptionKey,
  isEncryptionKeyConfigured,
  parseEncryptionKey,
  sha256Hex,
} from '../src/lib/backup/crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}
function assertThrows(fn: () => unknown, contains: string, message: string) {
  try {
    fn()
    assert(false, message)
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    assert(text.toLowerCase().includes(contains.toLowerCase()), `${message} (said: ${text.slice(0, 90)})`)
  }
}

function manifest(overrides: Partial<BackupManifest> & { id: string; startedAt: string }): BackupManifest {
  return {
    kind: 'database',
    completedAt: overrides.startedAt,
    driver: 'localfs',
    objectKey: `database/${overrides.id}.sql.gz.enc`,
    sizeBytes: 1000,
    checksumSha256: 'a'.repeat(64),
    plaintextSha256: 'b'.repeat(64),
    encrypted: true,
    verifiedAt: overrides.startedAt,
    verifyMethod: 'readback',
    ...overrides,
  }
}

async function main() {
  console.log('--- connection strings and identifiers never leak or escape ---')
  const url = 'postgresql://barber:s3cretPassw0rd@db.example.com:5432/barbershop?sslmode=require'
  assert(!redactSecrets(url).includes('s3cretPassw0rd'), 'a password in a connection string is redacted')
  assert(redactSecrets(url).includes('db.example.com'), 'the redacted form still identifies the host for an operator')
  assert(!redactSecrets('PASSWORD=abc123').includes('abc123'), 'a password= token is redacted')
  assert(!redactSecrets('token 0123456789abcdef0123456789abcdef').includes('0123456789abcdef'), 'long hex tokens are redacted')
  assert(redactSecrets('pg_dump exited 1') === 'pg_dump exited 1', 'harmless text passes through untouched')

  assert(quoteIdent('barber_backup_verify_20260101_abc123') === '"barber_backup_verify_20260101_abc123"', 'a generated identifier is quoted')
  assertThrows(() => quoteIdent('x"; DROP DATABASE prod; --'), 'unsafe', 'an identifier carrying SQL is refused')
  assertThrows(() => quoteIdent('Upper'), 'unsafe', 'an identifier with unexpected characters is refused')

  const scratchA = scratchDbName()
  const scratchB = scratchDbName()
  assert(/^[a-z_][a-z0-9_]{0,62}$/.test(scratchA), 'a scratch name is a safe lowercase identifier')
  assert(scratchA !== scratchB, 'two runs cannot collide on one scratch database')

  const derived = databaseUrlFor(url, 'barber_backup_verify_x')
  assert(derived.endsWith('/barber_backup_verify_x?sslmode=require'), 'the scratch URL keeps the connection options and swaps only the database')
  assert(derived.includes('db.example.com'), 'the host is preserved for the scratch database')

  console.log('--- client/server version skew handling ---')
  const dump = [
    'SET transaction_timeout = 0;',
    'SET statement_timeout = 0;',
    'CREATE TABLE "Business" (id text);',
    'COPY "Business" (id) FROM stdin;',
    'a',
    '\\.',
  ].join('\n')
  const sanitized = sanitizeDumpForRestore(dump)
  assert(sanitized.droppedLines === 1, 'only the incompatible session setting is dropped')
  assert(!sanitized.text.includes('transaction_timeout'), 'the incompatible setting is gone')
  assert(sanitized.text.includes('SET statement_timeout = 0;'), 'a compatible session setting is preserved')
  assert(sanitized.text.includes('COPY "Business"'), 'the data section is untouched')

  console.log('--- cleanup registry ---')
  const cleanup = createCleanupRegistry()
  const order: string[] = []
  cleanup.add('first', () => { order.push('first') })
  cleanup.add('second', () => { order.push('second') })
  cleanup.add('broken', () => { throw new Error('cleanup blew up') })
  const failures = cleanup.runAll()
  assert(order.join(',') === 'second,first', 'cleanup runs in reverse acquisition order')
  assert(failures.length === 1 && failures[0].name === 'broken', 'a failing cleanup step is reported instead of thrown')
  assert(cleanup.size === 0, 'the registry does not replay tasks')

  console.log('--- encryption ---')
  const key = parseEncryptionKey(generateEncryptionKey())
  const plaintext = Buffer.from('CREATE TABLE "Business" (id text);\nCOPY x FROM stdin;'.repeat(40))
  const encrypted = encryptBackup(plaintext, key)
  assert(!encrypted.includes(Buffer.from('Business')), 'the ciphertext does not contain the plaintext')
  assert(decryptBackup(encrypted, key).equals(plaintext), 'a backup round-trips through encryption')
  const tampered = Buffer.from(encrypted)
  tampered[tampered.length - 1] ^= 0xff
  assertThrows(() => decryptBackup(tampered, key), 'authentication', 'a tampered object is rejected, not restored')
  assertThrows(() => decryptBackup(encrypted, parseEncryptionKey(generateEncryptionKey())), 'authentication', 'a wrong key is rejected')
  assertThrows(() => decryptBackup(Buffer.from('not a backup'), key), 'truncated', 'a truncated object is rejected')
  assertThrows(() => parseEncryptionKey(''), 'not set', 'a missing key explains itself')
  assertThrows(() => parseEncryptionKey('short'), '32 bytes', 'a malformed key is refused with the expected shape')
  assert(!isEncryptionKeyConfigured('anything-else'), 'an unusable key is reported as not configured')
  assert(isEncryptionKeyConfigured(key.toString('hex')), 'a hex key is accepted as well as base64')
  assert(sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256 is standard')

  console.log('--- retention cannot delete the last copy ---')
  const policy = retentionPolicyFromEnv({})
  assert(policy.days >= RETENTION_MINIMUMS.days, 'daily retention cannot go below 7')
  assert(policy.weeks >= RETENTION_MINIMUMS.weeks, 'weekly retention cannot go below 4')
  assert(policy.months >= RETENTION_MINIMUMS.months, 'monthly retention cannot go below 6')
  assert(policy.minCopies >= RETENTION_FLOOR, 'a floor of copies is always enforced')
  const lowered = retentionPolicyFromEnv({ BACKUP_RETENTION_DAYS: '1', BACKUP_RETENTION_MIN_COPIES: '0' })
  assert(lowered.days === RETENTION_MINIMUMS.days && lowered.minCopies === RETENTION_FLOOR, 'an operator cannot configure retention below the minimum')

  const now = new Date('2026-11-17T12:00:00Z')
  const fresh = manifest({ id: 'fresh', startedAt: '2026-11-17T03:00:00Z' })
  const yesterday = manifest({ id: 'yesterday', startedAt: '2026-11-16T03:00:00Z' })
  const lastWeek = manifest({ id: 'last-week', startedAt: '2026-11-10T03:00:00Z' })
  const lastMonth = manifest({ id: 'last-month', startedAt: '2026-10-05T03:00:00Z' })
  const ancient = manifest({ id: 'ancient', startedAt: '2026-02-01T03:00:00Z' })

  const selection = selectExpiredBackups([fresh, yesterday, lastWeek, lastMonth, ancient], now, policy)
  assert(selection.keep.some((m) => m.id === 'fresh'), 'the newest verified copy is always kept')
  assert(selection.keep.some((m) => m.id === 'last-week'), 'a weekly bucket copy is kept')
  assert(selection.expire.every((m) => m.id !== 'fresh'), 'the newest copy is never expired')
  assert(selection.expire.some((m) => m.id === 'ancient'), 'a backup outside every bucket is expired')
  assertRetentionSafe(selection)

  // A single old backup: nothing else exists, so nothing may be expired.
  const onlyOne = selectExpiredBackups([ancient], now, policy)
  assert(onlyOne.expire.length === 0, 'the only existing backup is never expired')
  assert(isVerified(onlyOne.keep[0]), 'the survivor is recorded as verified')

  // Unverified copies are not recovery copies: they must not satisfy the floor.
  const unverified = { ...manifest({ id: 'unverified', startedAt: '2026-11-17T04:00:00Z' }), verifiedAt: null }
  const mixed = selectExpiredBackups([unverified, ancient], now, policy)
  assert(mixed.keep.some((m) => m.id === 'ancient'), 'an unverified object does not displace the last verified copy')
  assert(mixed.expire.length === 0, 'with two copies and one verified, nothing is expired')

  // Failed runs are pruned first but never counted as recovery copies.
  const failedRun = { ...manifest({ id: 'failed', startedAt: '2026-11-17T05:00:00Z' }), error: 'upload failed' }
  const withFailure = selectExpiredBackups([failedRun, fresh, yesterday], now, policy)
  assert(!withFailure.keep.some((m) => m.id === 'failed'), 'a failed run is not treated as a recovery copy')
  assert(withFailure.keep.some((m) => m.id === 'fresh'), 'a failed run cannot displace the newest verified copy')

  assertThrows(() => assertRetentionSafe({ expire: [], keep: [], reasons: {} }), 'no verified', 'retention refuses to run with no verified survivor')

  console.log('--- single-run lock ---')
  const dir = mkdtempSync(join(tmpdir(), 'backup-lock-'))
  try {
    const lock = acquireBackupLock(dir)
    assertThrows(() => acquireBackupLock(dir), 'already in progress', 'a second simultaneous run is refused')
    lock.release()
    const again = acquireBackupLock(dir)
    assert(true, 'the lock can be taken again after release')
    again.release()
    // A lock left by a killed process must not block backups forever.
    writeFileSync(join(dir, '.offsite-backup.lock'), `12345|${new Date(Date.now() - 6 * 3600_000).toISOString()}`)
    const reclaimed = acquireBackupLock(dir)
    reclaimed.release()
    assert(true, 'a stale lock is reclaimed instead of blocking every future run')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  console.log('--- storage safety ---')
  const storeDir = mkdtempSync(join(tmpdir(), 'backup-store-'))
  try {
    const storage = createLocalStorage(storeDir)
    await storage.put('database/a.sql.gz.enc', Buffer.from('ciphertext'))
    const head = await storage.head('database/a.sql.gz.enc')
    assert(head?.size === 10, 'an uploaded object is confirmed by size')
    assert((await storage.get('database/a.sql.gz.enc')).toString() === 'ciphertext', 'the stored object reads back byte-for-byte')
    const listed = await storage.list('database/')
    assert(listed.length === 1, 'listing returns the objects under the prefix')
    await storage.delete('database/a.sql.gz.enc')
    assert((await storage.head('database/a.sql.gz.enc')) === null, 'a deleted object is gone')
    let refused = false
    try { await storage.put('../escape', Buffer.from('x')) } catch { refused = true }
    assert(refused, 'a key that escapes the backup directory is refused')
    await storage.put('database/m1.manifest.json', Buffer.from(JSON.stringify(manifest({ id: 'm1', startedAt: now.toISOString() }))))
    const manifests = await listManifests(storage)
    assert(manifests.manifests.length === 1, 'manifests are read back from storage')
    await storage.put('database/broken.manifest.json', Buffer.from('{ not json'))
    const withBroken = await listManifests(storage)
    assert(withBroken.unreadable.length === 1, 'an unreadable manifest is reported, not silently skipped')
    const raw = readFileSync(join(storeDir, 'database', 'm1.manifest.json'), 'utf8')
    assert(raw.includes('"id"') && raw.includes('m1'), 'the manifest is stored as readable JSON for an operator')
  } finally {
    rmSync(storeDir, { recursive: true, force: true })
  }

  console.log(`\nBackup safety tests: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => { console.error(error); process.exit(1) })

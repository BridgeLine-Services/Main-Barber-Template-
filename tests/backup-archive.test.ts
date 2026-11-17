// Archive layer (Part 3, layer 3). Runs against temp directories, so it needs no
// database, no network and cannot touch a real copy.
//
// What this proves:
//   • the month lives in the key, in UTC, so retention is a prefix question;
//   • retention never deletes the current month, and only prunes once more months
//     exist than the window allows;
//   • only a verified, checksummed copy can be archived, and the copy is re-checked
//     against its own checksum before it is written;
//   • an archived copy is read back identical AND decryptable, so "archived" means
//     "retrievable with today's key";
//   • archiving twice in the same month is a no-op, and a differing copy is refused
//     rather than overwritten;
//   • unconfigured archive reports itself, so a missing layer is visible.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalStorage, type BackupStorage } from '../scripts/lib/backup-storage'
import {
  ArchiveError,
  archiveConfig,
  archiveKey,
  monthOf,
  monthsToPrune,
  pickArchivable,
  runArchive,
} from '../scripts/backup-archive'
import { encryptBackup, generateEncryptionKey, parseEncryptionKey, sha256Hex } from '../src/lib/backup/crypto'
import type { BackupManifest } from '../src/lib/backup/manifest'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

function manifest(overrides: Partial<BackupManifest> & { id: string }): BackupManifest {
  return {
    kind: 'database',
    startedAt: '2026-11-17T03:17:00.000Z',
    completedAt: '2026-11-17T03:20:00.000Z',
    driver: 'localfs',
    objectKey: `database/${overrides.id}.sql.gz.enc`,
    sizeBytes: 100,
    checksumSha256: 'deadbeef',
    plaintextSha256: null,
    encrypted: true,
    verifiedAt: '2026-11-17T03:21:00.000Z',
    verifyMethod: 'readback',
    ...overrides,
  }
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'archive-test-'))
  const sourceDir = join(root, 'source')
  const archiveDir = join(root, 'archive')
  const key = parseEncryptionKey(generateEncryptionKey())

  console.log('--- configuration ---')
  try {
    archiveConfig({})
    assert(false, 'an empty environment refuses to look configured')
  } catch (error) {
    assert(error instanceof ArchiveError && error.code === 'not-configured', 'an empty environment is reported as not configured')
  }
  const configured = archiveConfig({ BACKUP_ARCHIVE_DRIVER: 'localfs', BACKUP_ARCHIVE_DIR: archiveDir })
  assert(configured.prefix === 'archive/', 'the archive prefix defaults to archive/')
  assert(configured.keepMonths === 13, 'the default window is 13 monthly copies')
  assert(archiveConfig({ BACKUP_ARCHIVE_DRIVER: 'localfs', BACKUP_ARCHIVE_DIR: archiveDir, BACKUP_ARCHIVE_PREFIX: 'vault' }).prefix === 'vault/', 'a prefix without a slash is normalised')
  assert(archiveConfig({ BACKUP_ARCHIVE_DRIVER: 'localfs', BACKUP_ARCHIVE_DIR: archiveDir, BACKUP_ARCHIVE_KEEP_MONTHS: '1' }).keepMonths === 13, 'an absurd retention window is ignored rather than obeyed')

  console.log('--- keys and months ---')
  const novemberKey = archiveKey('archive/', '2026-11-17T03:20:00.000Z', 'db-2026-11-17')
  assert(novemberKey === 'archive/2026-11/db-2026-11-17.sql.gz.enc', 'the month is taken from the completion time, in UTC')
  assert(monthOf(novemberKey, 'archive/') === '2026-11', 'the month can be read back out of a key')
  assert(archiveKey('archive/', '2027-01-01T00:30:00.000Z', 'x') === 'archive/2027-01/x.sql.gz.enc', 'a January copy lands in January, not December')
  assert(monthOf('archive/loose-file.enc', 'archive/') === null, 'a key with no month is not treated as a month')

  console.log('--- retention ---')
  const now = new Date('2026-11-17T09:00:00.000Z')
  assert(monthsToPrune(['2026-11'], 13, now).length === 0, 'the current month is never pruned')
  const thirteen = Array.from({ length: 15 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 10 - i, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })
  const pruned = monthsToPrune(thirteen, 13, now)
  // 15 months, a 13-month window, and the current month cannot be a candidate:
  // 14 candidates, 12 kept alongside the current one, so exactly the 2 oldest go.
  assert(pruned.length === 2, 'pruning keeps the window and drops exactly the surplus')
  assert(pruned.includes('2025-09') && pruned.includes('2025-10'), 'the months pruned are the oldest ones')
  assert(!pruned.includes('2026-11'), 'pruning cannot reach the current month')

  console.log('--- selection ---')
  assert(pickArchivable([]) === null, 'nothing to archive when no copies exist')
  const errored = manifest({ id: 'bad', error: 'upload failed' })
  const unchecked = manifest({ id: 'nochecksum', checksumSha256: '' })
  const older = manifest({ id: 'older', completedAt: '2026-10-01T00:00:00.000Z' })
  const newer = manifest({ id: 'newer', completedAt: '2026-11-16T00:00:00.000Z' })
  assert(pickArchivable([errored, unchecked, older, newer])?.id === 'newer', 'the newest verified copy is chosen, and failed ones are ignored')

  console.log('--- the archive itself ---')
  const source: BackupStorage = createLocalStorage(sourceDir)
  const archive: BackupStorage = createLocalStorage(archiveDir)
  const plaintext = Buffer.from('x'.repeat(4096))
  const encrypted = encryptBackup(plaintext, key)
  const good = manifest({ id: 'db-2026-11-17', objectKey: 'database/db-2026-11-17.sql.gz.enc', checksumSha256: sha256Hex(encrypted) })
  await source.put(good.objectKey, encrypted)

  const config = { storageEnv: { BACKUP_STORAGE_DRIVER: 'localfs', BACKUP_LOCAL_DIR: archiveDir }, prefix: 'archive/', keepMonths: 13 }
  const logs: string[] = []
  const result = await runArchive({ manifests: [good], archive, source, encryptionKey: key, config, now, log: (l) => logs.push(l) })
  assert(result.verified === true, 'the archived copy is verified after read-back and decryption')
  assert(result.key === 'archive/2026-11/db-2026-11-17.sql.gz.enc', 'the archive key carries the month')
  const stored = await archive.get(result.key as string)
  assert(sha256Hex(stored) === sha256Hex(encrypted), 'the stored bytes are identical to the verified source')

  const again = await runArchive({ manifests: [good], archive, source, encryptionKey: key, config, now, log: (l) => logs.push(l) })
  assert(again.skipped === true, 'archiving the same month twice does not copy twice')

  console.log('--- refusals ---')
  const tampered = manifest({ id: 'tampered', objectKey: 'database/tampered.sql.gz.enc', checksumSha256: 'not-the-real-checksum' })
  await source.put(tampered.objectKey, encrypted)
  try {
    await runArchive({ manifests: [tampered], archive, source, encryptionKey: key, config, now })
    assert(false, 'a source that does not match its checksum is refused')
  } catch (error) {
    assert(error instanceof ArchiveError && /checksum/i.test(error.message), 'a source that does not match its checksum is refused')
  }

  // Encrypt once, then record the checksum of those exact bytes: encrypting twice
  // produces different ciphertext (fresh IV), which would test the checksum guard
  // instead of the overwrite guard this case is about.
  const otherBlob = encryptBackup(Buffer.from('different'), key)
  const colliding = manifest({ id: 'db-2026-11-17', objectKey: 'database/db-other.sql.gz.enc', checksumSha256: sha256Hex(otherBlob) })
  await source.put('database/db-other.sql.gz.enc', otherBlob)
  try {
    await runArchive({ manifests: [colliding], archive, source, encryptionKey: key, config, now })
    assert(false, 'a differing copy is refused rather than overwriting an archive')
  } catch (error) {
    assert(error instanceof ArchiveError && /refusing to overwrite/i.test(error.message), 'a differing copy is refused rather than overwriting an archive')
  }

  const wrongKey = parseEncryptionKey(generateEncryptionKey())
  const freshDir = join(root, 'archive-wrong-key')
  try {
    await runArchive({ manifests: [good], archive: createLocalStorage(freshDir), source, encryptionKey: wrongKey, config: { ...config, storageEnv: { BACKUP_STORAGE_DRIVER: 'localfs', BACKUP_LOCAL_DIR: freshDir } }, now })
    assert(false, 'a copy that cannot be decrypted with the configured key is a failure, not a success')
  } catch (error) {
    assert(error instanceof ArchiveError && /decrypt/i.test(error.message), 'a copy that cannot be decrypted with the configured key is a failure, not a success')
  }

  const dry = await runArchive({ manifests: [good], archive, source, encryptionKey: key, config: { ...config, prefix: 'dry/' }, now, dryRun: true })
  assert(dry.key !== null && (await archive.head(dry.key)) === null, 'a dry run writes nothing')

  console.log('--- cleanup ---')
  rmSync(root, { recursive: true, force: true })
  console.log(`\nArchive tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

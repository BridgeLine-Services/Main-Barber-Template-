// Off-site backup pipeline: the real put/head/get/delete path against a temp
// directory (an honest storage target), with a synthetic dump so the suite needs
// no database and cannot touch a real one.
//
// What this proves:
//   • an encrypted object is uploaded, confirmed, read back and authenticated;
//   • a corrupted upload is DETECTED, so a backup cannot be declared successful
//     when the stored bytes are not the dump that was taken;
//   • retention prunes old copies while never removing the newest verified one;
//   • unreadable manifests are left alone rather than guessed at.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createLocalStorage } from '../scripts/lib/backup-storage'
import { listManifests, runOffsiteBackup } from '../scripts/backup-offsite'
import { decryptBackup, generateEncryptionKey, parseEncryptionKey, sha256Hex } from '../src/lib/backup/crypto'
import type { BackupManifest } from '../src/lib/backup/manifest'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

function syntheticDump(): Buffer {
  const rows = Array.from({ length: 60 }, (_, i) => `${i}\tShop ${i}`).join('\n')
  return Buffer.from(
    [
      '-- synthetic dump for the off-site pipeline test',
      'CREATE TABLE "Business" (id text, name text);',
      'COPY "Business" (id, name) FROM stdin;',
      rows,
      '\\.',
    ].join('\n'),
    'utf8',
  )
}

async function main() {
  const key = parseEncryptionKey(generateEncryptionKey())
  const dir = mkdtempSync(join(tmpdir(), 'offsite-'))
  const storage = createLocalStorage(dir)
  const logs: string[] = []
  const dump = syntheticDump()

  try {
    console.log('--- a complete run ---')
    const result = await runOffsiteBackup({
      dbUrl: 'postgresql://user:secret@127.0.0.1:5432/example',
      storage,
      encryptionKey: key,
      verifyRestore: false,
      recordHistory: false,
      dump: () => dump,
      now: new Date('2026-11-17T03:00:00Z'),
      log: (line) => logs.push(line),
    })
    assert(result.ok, 'the run reports success')
    assert(result.manifest.encrypted, 'the stored object is marked encrypted')

    const stored = await storage.get(result.manifest.objectKey)
    assert(stored.length === result.manifest.sizeBytes, 'the stored size matches the manifest')
    assert(sha256Hex(stored) === result.manifest.checksumSha256, 'the stored object matches its recorded checksum')
    const plain = gunzipSync(decryptBackup(stored, key))
    assert(plain.equals(dump), 'the stored object decrypts and decompresses back to the dump')
    assert(result.manifest.verifyMethod === 'checksum-only', 'an unexercised restore is labelled honestly')

    const { manifests } = await listManifests(storage)
    assert(manifests.length === 1 && manifests[0].id === result.manifest.id, 'the manifest is discoverable for retention')

    assert(!logs.some((line) => line.includes('secret')), 'the run log never contains the database password')
    assert(logs.some((line) => line.includes('read the object back')), 'the run log records the readback step')

    console.log('--- a corrupted upload is caught ---')
    let caught = ''
    try {
      await runOffsiteBackup({
        dbUrl: 'postgresql://user:secret@127.0.0.1:5432/example',
        storage,
        encryptionKey: key,
        verifyRestore: false,
        recordHistory: false,
        dump: () => dump,
        now: new Date('2026-11-17T04:00:00Z'),
        corruptUploadForTest: true,
        log: () => {},
      })
    } catch (error) {
      caught = error instanceof Error ? error.message : String(error)
    }
    assert(/checksum|does not match/i.test(caught), 'a tampered object is rejected instead of called a backup')
    assert(!caught.includes('secret'), 'the failure message does not leak the password')

    console.log('--- retention keeps the newest verified copy ---')
    // Seed four old, fully verified backups (one per month, all outside every
    // retention bucket) plus their objects, then run again. The retention floor
    // protects the newest verified copies, so only the oldest are expired — which
    // is exactly the behaviour a deletion bug would get wrong.
    const oldManifests: BackupManifest[] = ['2025-01-05', '2025-02-05', '2025-03-05', '2025-04-05'].map((day) => ({
      id: `db-old-${day}`,
      kind: 'database',
      startedAt: `${day}T03:00:00Z`,
      completedAt: `${day}T03:05:00Z`,
      driver: 'localfs',
      objectKey: `database/db-old-${day}.sql.gz.enc`,
      sizeBytes: 32,
      checksumSha256: 'c'.repeat(64),
      plaintextSha256: null,
      encrypted: true,
      verifiedAt: `${day}T03:05:00Z`,
      verifyMethod: 'readback',
    }))
    for (const manifest of oldManifests) {
      await storage.put(manifest.objectKey, Buffer.from('old-ciphertext'))
      await storage.put(`database/${manifest.id}.manifest.json`, Buffer.from(JSON.stringify(manifest)))
    }
    await storage.put('database/unreadable.manifest.json', Buffer.from('{not json'))

    const third = await runOffsiteBackup({
      dbUrl: 'postgresql://user:secret@127.0.0.1:5432/example',
      storage,
      encryptionKey: key,
      verifyRestore: false,
      recordHistory: false,
      dump: () => dump,
      now: new Date('2026-11-17T05:00:00Z'),
      log: () => {},
    })
    const oldest = oldManifests[0]
    const newestOld = oldManifests[oldManifests.length - 1]
    assert(third.expiredKeys.includes(oldest.objectKey), 'the oldest backup is expired')
    assert((await storage.head(oldest.objectKey)) === null, 'the expired object is removed from storage')
    assert((await storage.head(newestOld.objectKey)) !== null, 'the retention floor protects the newest old copies')
    assert(third.expiredKeys.length < oldManifests.length, 'retention never expires the whole archive')
    assert((await storage.head(third.manifest.objectKey)) !== null, 'the new backup survives its own retention pass')
    assert((await storage.head('database/unreadable.manifest.json')) !== null, 'an unreadable manifest is never guessed at or deleted')

    console.log('--- a run with no restore stepped is still honest about it ---')
    assert(third.manifest.evidence?.restoreTested === false, 'the manifest records that no restore was exercised')

    console.log('--- a missing off-site destination is a gap, not a crash ---')
    const { createStorageFromEnv } = await import('../scripts/lib/backup-storage')
    let missing: string[] = []
    try { createStorageFromEnv({ BACKUP_STORAGE_DRIVER: 's3' }) } catch (error) {
      missing = (error as { missing?: string[] }).missing ?? []
    }
    assert(missing.includes('BACKUP_S3_BUCKET'), 'the missing setting is named exactly')
    assert(missing.length === 4, 'every missing setting is listed at once, not one per run')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  console.log(`\nOff-site backup tests: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => { console.error(error); process.exit(1) })

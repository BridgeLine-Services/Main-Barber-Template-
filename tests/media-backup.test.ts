// Media backup: planning rules and the copy pipeline against a temp directory.
//
// A database backup does not protect a single logo, barber photo or before/after
// pair. These tests pin the two rules that make the media copy safe: originals
// are never touched, and a vanished original never deletes its recovery copy.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalStorage, type BackupStorage } from '../scripts/lib/backup-storage'
import { runMediaBackup } from '../scripts/media-backup'
import { describeMediaPlan, planMediaBackup, type MediaBlobRef } from '../src/lib/backup/media-plan'
import { generateEncryptionKey, parseEncryptionKey } from '../src/lib/backup/crypto'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const blobs: MediaBlobRef[] = [
  { pathname: 'logo/shop.png', url: 'https://media.test/logo.png', size: 1200, uploadedAt: '2026-11-01T10:00:00Z' },
  { pathname: 'gallery/before.jpg', url: 'https://media.test/before.jpg', size: 5400, uploadedAt: '2026-11-05T10:00:00Z' },
]

async function main() {
  console.log('--- planning ---')
  const first = planMediaBackup(blobs, [])
  assert(first.copy.length === 2, 'a first run copies every photo')
  assert(first.bytesToCopy === 6600, 'the plan reports the transfer size')
  assert(first.missing.length === 0, 'nothing is missing on a first run')

  const unchanged = planMediaBackup(blobs, blobs.map((blob) => ({
    pathname: blob.pathname,
    size: blob.size,
    storedAt: '2026-11-06T00:00:00Z',
    sourceUploadedAt: blob.uploadedAt ?? null,
  })))
  assert(unchanged.copy.length === 0 && unchanged.unchanged.length === 2, 'an unchanged photo is not copied again')

  const replaced = planMediaBackup(
    [{ ...blobs[0], size: 9999, uploadedAt: '2026-11-10T10:00:00Z' }],
    [{ pathname: 'logo/shop.png', size: 1200, storedAt: '2026-11-06T00:00:00Z', sourceUploadedAt: '2026-11-01T10:00:00Z' }],
  )
  assert(replaced.copy.length === 1, 'a replaced photo is copied again')

  const vanished = planMediaBackup([], blobs.map((blob) => ({
    pathname: blob.pathname, size: blob.size, storedAt: '2026-11-06T00:00:00Z', sourceUploadedAt: blob.uploadedAt,
  })))
  assert(vanished.missing.length === 2, 'a photo missing from the origin is reported')
  assert(/no longer in the shop but still in the recovery copy/.test(describeMediaPlan(vanished)), 'the owner-facing sentence reassures instead of alarming')
  assert(!/bucket|s3|blob|storage key/i.test(describeMediaPlan(vanished)), 'the sentence names no infrastructure')

  console.log('--- copying ---')
  const dir = mkdtempSync(join(tmpdir(), 'media-backup-'))
  try {
    const inner = createLocalStorage(join(dir, 'store'))
    const deleted: string[] = []
    const storage: BackupStorage = {
      ...inner,
      driver: inner.driver,
      destination: inner.destination,
      async delete(key) { deleted.push(key); return inner.delete(key) },
    }
    let originals = [...blobs]
    let fetched = 0
    const fetchImpl = (async (input: string | URL | Request) => {
      fetched++
      const url = String(input)
      const blob = originals.find((b) => b.url === url)
      if (!blob) return new Response('missing', { status: 404 })
      return new Response(Buffer.alloc(blob.size, 'x'), { status: 200 })
    }) as unknown as typeof fetch

    const key = parseEncryptionKey(generateEncryptionKey())
    const firstRun = await runMediaBackup({
      storage,
      encryptionKey: key,
      fetchImpl,
      listBlobs: async () => originals,
      log: () => {},
    })
    assert(firstRun.copied === 2, 'both photos are copied')
    assert(fetched === 2, 'each photo is fetched exactly once')
    assert(deleted.length === 0, 'no stored object or original is deleted by a backup run')

    const index = JSON.parse((await inner.get('media/index.json')).toString('utf8'))
    assert(index.records.length === 2, 'the copy index records what is protected')
    assert(index.records.every((record: { checksumSha256?: string }) => /^[0-9a-f]{64}$/.test(record.checksumSha256 ?? '')), 'each copy records the original checksum')

    const stored = await inner.head('media/logo/shop.png.enc')
    assert((stored?.size ?? 0) > 0, 'the copy is stored under a path derived from the original key (URLs unchanged)')
    assert((await inner.get('media/logo/shop.png.enc')).subarray(0, 5).toString() === 'BRBK1', 'the stored copy is encrypted, not a plain photo')

    const secondRun = await runMediaBackup({
      storage,
      encryptionKey: key,
      fetchImpl,
      listBlobs: async () => originals,
      log: () => {},
    })
    assert(secondRun.copied === 0 && secondRun.unchanged === 2, 'a second run copies nothing that is already protected')
    assert(fetched === 2, 'an unchanged photo is not downloaded again')

    // The original disappears from the shop's storage.
    originals = [originals[0]]
    const thirdRun = await runMediaBackup({
      storage,
      encryptionKey: key,
      fetchImpl,
      listBlobs: async () => originals,
      log: () => {},
    })
    assert(thirdRun.missing.length === 1, 'a vanished original is reported')
    assert(deleted.length === 0, 'the recovery copy of a vanished photo is NOT deleted')
    const indexAfter = JSON.parse((await inner.get('media/index.json')).toString('utf8'))
    assert(indexAfter.records.length === 2, 'the vanished photo stays in the recovery index')
    assert(readFileSync(join(dir, 'store', 'media', 'gallery', 'before.jpg.enc')).length > 0, 'the vanished photo is still recoverable from the copy')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  console.log(`\nMedia backup tests: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => { console.error(error); process.exit(1) })

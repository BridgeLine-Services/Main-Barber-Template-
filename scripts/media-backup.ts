// ============================================================================
// Media backup (Disaster recovery, Layer 4 — uploaded files)
//
//   npm run media:backup
//
// Copies every blob in the shop's photo storage into the independent backup
// bucket, encrypted, and records what was copied. The originals are never
// touched and never deleted, so an interrupted run cannot damage a live shop's
// images, and a restored database still points at URLs that exist.
//
// Requires: BLOB_READ_WRITE_TOKEN (the existing media provider) plus the same
// off-site storage + encryption settings as the database backup.
// See docs/DISASTER-RECOVERY.md § 3.
// ============================================================================


import { join } from 'node:path'
import { list } from '@vercel/blob'
import { createStorageFromEnv, type BackupStorage } from './lib/backup-storage'
import { encryptBackup, parseEncryptionKey, sha256Hex } from '../src/lib/backup/crypto'
import { describeMediaPlan, planMediaBackup, type MediaCopyRecord } from '../src/lib/backup/media-plan'
import { sendAlert } from '../src/lib/alerts'

const MEDIA_PREFIX = 'media/'
const MEDIA_INDEX = 'media/index.json'

export interface MediaBackupOptions {
  storage: BackupStorage
  encryptionKey: Buffer
  /** Injectable for tests and for providers other than Blob. */
  fetchImpl?: typeof fetch
  listBlobs?: () => Promise<Array<{ pathname: string; url: string; size: number; uploadedAt?: string | null }>>
  log?: (message: string) => void
}

export interface MediaBackupResult {
  copied: number
  unchanged: number
  missing: string[]
  bytesCopied: number
}

/** A missing photo-provider credential is a gap to report, not a failure to alert on. */
function isConfigurationGap(message: string): boolean {
  return /not configured|is unset|is not set/i.test(message)
}

async function defaultListBlobs() {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  if (!token) {
    throw new Error('Photo storage is not configured (BLOB_READ_WRITE_TOKEN is unset).')
  }
  const blobs: Array<{ pathname: string; url: string; size: number; uploadedAt?: string | null }> = []
  let cursor: string | undefined
  do {
    const page = await list({ token, cursor, limit: 1000 })
    for (const blob of page.blobs) {
      blobs.push({ pathname: blob.pathname, url: blob.url, size: blob.size, uploadedAt: blob.uploadedAt?.toISOString?.() ?? null })
    }
    cursor = page.cursor
  } while (cursor)
  return blobs
}

/** Read the previous copy index; an unreadable index means "copy everything". */
async function readIndex(storage: BackupStorage): Promise<MediaCopyRecord[]> {
  try {
    const raw = await storage.get(MEDIA_INDEX)
    const parsed = JSON.parse(raw.toString('utf8'))
    return Array.isArray(parsed?.records) ? (parsed.records as MediaCopyRecord[]) : []
  } catch {
    return []
  }
}

export async function runMediaBackup(options: MediaBackupOptions): Promise<MediaBackupResult> {
  const log = options.log ?? ((line: string) => console.log(line))
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const blobs = await (options.listBlobs ?? defaultListBlobs)()
  const previous = await readIndex(options.storage)
  const plan = planMediaBackup(blobs, previous)
  log(`[media] ${describeMediaPlan(plan)}`)

  const records: MediaCopyRecord[] = [...previous.filter((record) => plan.missing.some((m) => m.pathname === record.pathname))]
  let bytesCopied = 0

  for (const blob of plan.copy) {
    const response = await fetchImpl(blob.url)
    if (!response.ok) {
      throw new Error(`Could not read a photo from storage (HTTP ${response.status}).`)
    }
    const body = Buffer.from(await response.arrayBuffer())
    if (body.length !== blob.size) {
      throw new Error('A photo changed size while it was being copied; the run will retry next time.')
    }
    const encrypted = encryptBackup(body, options.encryptionKey)
    const storedKey = `${MEDIA_PREFIX}${blob.pathname}.enc`
    await options.storage.put(storedKey, encrypted)
    const head = await options.storage.head(storedKey)
    if (!head || head.size !== encrypted.length) {
      throw new Error('The stored photo copy could not be confirmed after upload.')
    }
    const readback = await options.storage.get(storedKey)
    if (sha256Hex(readback) !== sha256Hex(encrypted)) {
      throw new Error('The stored photo copy does not match what was uploaded.')
    }
    bytesCopied += body.length
    records.push({
      pathname: blob.pathname,
      size: blob.size,
      storedAt: new Date().toISOString(),
      sourceUploadedAt: blob.uploadedAt ?? null,
      checksumSha256: sha256Hex(body),
    })
  }

  // Carried forward: copies already made stay recorded even when unchanged.
  for (const blob of plan.unchanged) {
    const record = previous.find((r) => r.pathname === blob.pathname)
    if (record && !records.some((r) => r.pathname === record.pathname)) records.push(record)
  }

  await options.storage.put(
    MEDIA_INDEX,
    Buffer.from(JSON.stringify({ updatedAt: new Date().toISOString(), records }, null, 2), 'utf8'),
  )

  if (plan.missing.length > 0) {
    // Losing an original is not a backup failure (the copy is safe), but the
    // owner should know before a customer notices a blank image.
    await sendAlert({
      event: 'media_missing_originals',
      severity: 'warning',
      summary: `${plan.missing.length} shop photo${plan.missing.length === 1 ? ' is' : 's are'} no longer in storage. The recovery copy still has them.`,
      context: { count: plan.missing.length },
      dedupeKey: 'media_missing_originals',
    }).catch(() => {})
  }

  return { copied: plan.copy.length, unchanged: plan.unchanged.length, missing: plan.missing.map((m) => m.pathname), bytesCopied }
}

async function main(): Promise<number> {
  let storage: BackupStorage
  let key: Buffer
  try {
    storage = createStorageFromEnv()
    key = parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY)
  } catch (error) {
    console.error(`[media] NOT CONFIGURED: ${error instanceof Error ? error.message : String(error)}`)
    console.error('[media] See docs/DISASTER-RECOVERY.md § 3 for the exact variables.')
    return 3
  }
  try {
    const result = await runMediaBackup({ storage, encryptionKey: key })
    console.log(`[media] PASS: ${result.copied} copied, ${result.unchanged} already protected${result.missing.length ? `, ${result.missing.length} missing originals` : ''}`)
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isConfigurationGap(message)) {
      // Same rule as the database backup: an unconfigured destination means there
      // is no independent copy yet. Say so plainly, do not page anyone, and never
      // pretend the run succeeded.
      console.error(`[media] NOT CONFIGURED: ${message}`)
      console.error('[media] See docs/DISASTER-RECOVERY.md § 3 for the exact variables.')
      return 3
    }
    console.error(`[media] FAILED: ${message}`)
    await sendAlert({
      event: 'media_backup_failed',
      severity: 'critical',
      summary: 'The photo backup could not be completed. Your shop is operating normally, but an administrator has been notified.',
      context: { reason: message.slice(0, 200) },
      dedupeKey: 'media_backup_failed',
    }).catch(() => {})
    return 1
  }
}

if (process.argv[1] && /media-backup\.ts$|media-backup\.js$/.test(process.argv[1])) {
  main().then((code) => { process.exitCode = code })
}

/**
 * Third backup layer: the archive (Part 3).
 *
 * The three layers answer three different questions:
 *
 *   Primary   - the database provider's own backups. "The server lost a disk
 *               an hour ago; put it back."
 *   Off-site  - our encrypted copies in a different provider. "The provider is
 *               gone, or someone dropped a table." Kept for weeks, because that
 *               is the window in which a mistake is usually noticed.
 *   Archive   - this file. "Something was corrupted months ago and nobody saw
 *               it." Routine retention deletes the evidence; the archive keeps
 *               one copy per month, in a key that retention never touches.
 *
 * Rules this script keeps, so an archive is never the thing that loses data:
 *   - it only archives an object that already carries a checksum and says it was
 *     verified, and it re-checks that checksum itself before copying;
 *   - it writes, then reads the copy back and compares bytes, so "archived" means
 *     "retrievable";
 *   - it decrypts the read-back copy, so a wrong key is discovered now rather than
 *     on the worst day;
 *   - it never deletes the current month, and never deletes anything unless more
 *     months than the retention window exist.
 *
 * Usage:
 *   npm run db:backup:archive                 # archive the newest verified copy
 *   npm run db:backup:archive -- --dry-run    # say what it would do
 *   npm run db:backup:archive -- --keep 24    # 24 monthly copies instead of 13
 *
 * Exit codes: 0 archived and verified, 1 failure, 3 not configured.
 */
import { createStorageFromEnv, type BackupStorage, type StorageEnv } from './lib/backup-storage'
import { parseEncryptionKey, sha256Hex, decryptBackup } from '../src/lib/backup/crypto'
import type { BackupManifest } from '../src/lib/backup/manifest'

export const DEFAULT_KEEP_MONTHS = 13 // one year plus the current month

export interface ArchiveConfig {
  /** Where archived copies go. Standard names, so the same drivers are reused. */
  storageEnv: StorageEnv
  prefix: string
  keepMonths: number
}

export interface ArchiveEntry {
  key: string
  month: string
  checksumSha256: string | null
}

export class ArchiveError extends Error {
  constructor(message: string, readonly code: 'not-configured' | 'failed' = 'failed') {
    super(message)
    this.name = 'ArchiveError'
  }
}

/**
 * Read the archive destination from the environment. The archive is deliberately
 * allowed to live somewhere different from the routine off-site copies; when it
 * does not, it falls back to the same account, because a real second destination
 * is better than none but must never be silently assumed.
 */
export function archiveConfig(env: StorageEnv = process.env): ArchiveConfig {
  const keepRaw = (env.BACKUP_ARCHIVE_KEEP_MONTHS ?? '').trim()
  const keepParsed = keepRaw ? Number.parseInt(keepRaw, 10) : NaN
  const keepMonths = Number.isFinite(keepParsed) && keepParsed >= 2 ? keepParsed : DEFAULT_KEEP_MONTHS

  const driver = (env.BACKUP_ARCHIVE_DRIVER ?? env.BACKUP_STORAGE_DRIVER ?? '').trim()
  if (!driver) {
    throw new ArchiveError(
      'The archive is not configured yet (BACKUP_ARCHIVE_DRIVER or BACKUP_STORAGE_DRIVER is unset).',
      'not-configured',
    )
  }

  const storageEnv: StorageEnv = {
    BACKUP_STORAGE_DRIVER: driver,
    BACKUP_LOCAL_DIR: env.BACKUP_ARCHIVE_DIR ?? env.BACKUP_LOCAL_DIR,
    BACKUP_S3_ENDPOINT: env.BACKUP_ARCHIVE_ENDPOINT ?? env.BACKUP_S3_ENDPOINT,
    BACKUP_S3_REGION: env.BACKUP_ARCHIVE_REGION ?? env.BACKUP_S3_REGION,
    BACKUP_S3_BUCKET: env.BACKUP_ARCHIVE_BUCKET ?? env.BACKUP_S3_BUCKET,
    BACKUP_S3_ACCESS_KEY_ID: env.BACKUP_ARCHIVE_ACCESS_KEY_ID ?? env.BACKUP_S3_ACCESS_KEY_ID,
    BACKUP_S3_SECRET_ACCESS_KEY: env.BACKUP_ARCHIVE_SECRET_ACCESS_KEY ?? env.BACKUP_S3_SECRET_ACCESS_KEY,
  }

  const prefixRaw = (env.BACKUP_ARCHIVE_PREFIX ?? 'archive/').trim()
  const prefix = prefixRaw.endsWith('/') ? prefixRaw : `${prefixRaw}/`

  return { storageEnv, prefix, keepMonths }
}

/** `archive/2026-11/<id>.sql.gz.enc` — the month is in the key so retention is a prefix question. */
export function archiveKey(prefix: string, completedAt: string, id: string): string {
  const at = new Date(completedAt)
  const when = Number.isNaN(at.getTime()) ? new Date() : at
  const month = `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, '0')}`
  return `${prefix}${month}/${id}.sql.gz.enc`
}

export function monthOf(key: string, prefix: string): string | null {
  const rest = key.slice(prefix.length)
  const match = /^(\d{4}-\d{2})\//.exec(rest)
  return match ? match[1] : null
}

/**
 * Which archived months may be deleted. Newest first, keep `keepMonths` of them,
 * and never the month that contains today: an operator who archives twice in one
 * month must not be able to delete what they just wrote.
 */
export function monthsToPrune(months: string[], keepMonths: number, now: Date): string[] {
  const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const unique = [...new Set(months)].filter((m) => m !== current).sort().reverse()
  return unique.slice(Math.max(keepMonths - 1, 0))
}

/** The newest manifest that is safe to archive: verified, checksummed, not an error. */
export function pickArchivable(manifests: BackupManifest[]): BackupManifest | null {
  const usable = manifests
    .filter((m) => !m.error && m.checksumSha256 && m.completedAt)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
  return usable[0] ?? null
}

export interface ArchiveOptions {
  manifests: BackupManifest[]
  archive: BackupStorage
  /** Where the verified routine copies live; the archive reads the source from here. */
  source: BackupStorage
  encryptionKey: Buffer
  config: ArchiveConfig
  now?: Date
  dryRun?: boolean
  log?: (line: string) => void
}

export interface ArchiveResult {
  key: string | null
  month: string | null
  skipped: boolean
  pruned: string[]
  verified: boolean
}

export async function runArchive(options: ArchiveOptions): Promise<ArchiveResult> {
  const log = options.log ?? (() => {})
  const now = options.now ?? new Date()
  const result: ArchiveResult = { key: null, month: null, skipped: false, pruned: [], verified: false }

  const newest = pickArchivable(options.manifests)
  if (!newest) {
    throw new ArchiveError(
      'There is no verified off-site copy to archive yet. Run `npm run db:backup:offsite` first.',
    )
  }

  const key = archiveKey(options.config.prefix, newest.completedAt as string, newest.id)
  result.key = key
  result.month = monthOf(key, options.config.prefix)

  const source = await options.source.get(newest.objectKey)
  const sourceChecksum = sha256Hex(source)
  if (sourceChecksum !== newest.checksumSha256) {
    throw new ArchiveError(
      'The current off-site copy does not match its recorded checksum, so it will not be archived. Investigate the source copy first.',
    )
  }

  if (options.dryRun) {
    log(`[archive] dry run: would copy ${newest.objectKey} to ${key}`)
    return result
  }

  const existing = await options.archive.head(key)
  if (existing) {
    const existingBody = await options.archive.get(key)
    if (sha256Hex(existingBody) === sourceChecksum) {
      log(`[archive] already archived and identical: ${key}`)
      result.skipped = true
      result.verified = true
      return result
    }
    throw new ArchiveError(
      `An archived copy already exists at ${key} with different content. Refusing to overwrite an archive; investigate which copy is correct.`,
    )
  }

  await options.archive.put(key, source)

  // Read back, compare bytes, then decrypt: retrievable and openable, not merely stored.
  const readBack = await options.archive.get(key)
  if (sha256Hex(readBack) !== sourceChecksum) {
    throw new ArchiveError('The archived copy did not read back identical to the source. The archive is not trustworthy until this passes.')
  }
  try {
    decryptBackup(readBack, options.encryptionKey)
  } catch (error) {
    throw new ArchiveError(
      `The archived copy could not be decrypted with the configured key (${error instanceof Error ? error.message : 'unknown error'}). Fix the key before trusting this archive.`,
    )
  }
  result.verified = true
  log(`[archive] verified ${key}`)

  const listed = await options.archive.list(options.config.prefix)
  const months = listed.map((object) => monthOf(object.key, options.config.prefix)).filter((m): m is string => m !== null)
  const pruneMonths = monthsToPrune(months, options.config.keepMonths, now)
  if (pruneMonths.length > 0) {
    for (const object of listed) {
      const month = monthOf(object.key, options.config.prefix)
      if (month && pruneMonths.includes(month)) {
        await options.archive.delete(object.key)
        result.pruned.push(object.key)
      }
    }
  }
  return result
}

function summary(result: ArchiveResult): string {
  const parts = [result.skipped ? 'already archived' : 'archived and verified']
  if (result.month) parts.push(`month ${result.month}`)
  if (result.pruned.length > 0) parts.push(`${result.pruned.length} old month(s) pruned`)
  return parts.join(', ')
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const keepIndex = args.indexOf('--keep')
  const keepOverride = keepIndex >= 0 ? args[keepIndex + 1] : undefined

  let config: ArchiveConfig
  try {
    config = archiveConfig(keepOverride ? { ...process.env, BACKUP_ARCHIVE_KEEP_MONTHS: keepOverride } : process.env)
  } catch (error) {
    if (error instanceof ArchiveError && error.code === 'not-configured') {
      console.log(`[archive] NOT CONFIGURED: ${error.message}`)
      console.log('[archive] Set BACKUP_ARCHIVE_DRIVER plus its destination, or leave it unset and this step is skipped.')
      return 3
    }
    throw error
  }

  try {
    const { listManifests } = await import('./backup-offsite')
    const source = createStorageFromEnv(process.env)
    const archive = createStorageFromEnv(config.storageEnv)
    const { manifests, unreadable } = await listManifests(source)
    if (unreadable.length > 0) {
      console.log(`[archive] WARNING: ${unreadable.length} manifest(s) could not be read and were ignored.`)
    }
    const encryptionKey = parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY)
    const result = await runArchive({
      manifests,
      archive,
      source,
      encryptionKey,
      config,
      dryRun,
      log: (line) => console.log(line),
    })
    console.log(`[archive] ${dryRun ? 'DRY RUN: ' : ''}${summary(result)}`)
    console.log(`[archive] destination: ${archive.destination}, keeping ${config.keepMonths} monthly copies`)
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The archive step failed for an unknown reason.'
    console.error(`[archive] FAILED: ${message}`)
    console.error('[archive] The shop is not affected. The routine off-site copies are untouched; this only means the long-term copy was not made.')
    return 1
  }
}

if (process.argv[1] && process.argv[1].endsWith('backup-archive.ts')) {
  main().then((code) => {
    process.exitCode = code
  })
}

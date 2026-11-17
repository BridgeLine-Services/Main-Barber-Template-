// ============================================================================
// Off-site database backup (Disaster recovery, Layer 2 and Layer 3)
//
//   npm run db:backup:offsite
//
// One run does all of this, in this order, and refuses to call itself successful
// until the last step has been proven:
//
//   1. pg_dump the live database (same plain-SQL format as db:backup).
//   2. gzip it.
//   3. Encrypt it (AES-256-GCM) — the off-site bucket is not trusted to be private.
//   4. SHA-256 the stored object and the plaintext.
//   5. Upload to independent object storage (S3-compatible or a mounted volume).
//   6. Confirm the object exists and its size matches.
//   7. Read it back, authenticate it, decompress it, and compare both hashes.
//   8. Optionally restore it into a scratch database and run the full integrity
//      suite (BACKUP_VERIFY_RESTORE=true, needs CREATE DATABASE rights).
//   9. Record the run in BackupRun so readiness can notice silence.
//  10. Apply retention — never expiring the newest verified copy.
//  11. Alert (critical) on any failure, with a sentence an owner can read.
//
// Deliberately NOT wired to a Vercel cron: a dump+encrypt+upload+readback of a
// real database outlives a serverless invocation, and a cron entry that times out
// is worse than none. Run it from a scheduler that supports long jobs (GitHub
// Actions, a small worker, or the database host's job runner). docs/DISASTER-RECOVERY.md
// has the exact setup.
// ============================================================================

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { createCleanupRegistry, databaseUrlFor, dumpToBuffer, redactSecrets, sanitizeDumpForRestore, verifyRestore } from './backup'
import { createStorageFromEnv, type BackupStorage } from './lib/backup-storage'
import { encryptBackup, parseEncryptionKey, sha256Hex, decryptBackup } from '../src/lib/backup/crypto'
import {
  assertRetentionSafe,
  retentionPolicyFromEnv,
  selectExpiredBackups,
  type BackupManifest,
} from '../src/lib/backup/manifest'
import { sendAlert, sendRecoveryAlert } from '../src/lib/alerts'

const DB_PREFIX = 'database/'
const MANIFEST_SUFFIX = '.manifest.json'

export interface OffsiteBackupOptions {
  dbUrl: string
  storage: BackupStorage
  encryptionKey: Buffer
  outDir?: string
  /** Restore into a scratch database as well as hashing the readback. */
  verifyRestore?: boolean
  now?: Date
  /** Test seam: corrupt the stored object after upload to prove detection. */
  corruptUploadForTest?: boolean
  /** Test seam: supply a synthetic dump instead of reading a live database. */
  dump?: (dbUrl: string) => Buffer
  /** Test seam: skip the BackupRun insert (no database required). */
  recordHistory?: boolean
  log?: (message: string) => void
}

export interface OffsiteBackupResult {
  ok: true
  manifest: BackupManifest
  expiredKeys: string[]
}

export class OffsiteBackupError extends Error {
  constructor(message: string, readonly stage: string, readonly exitCode: number = 1) {
    super(message)
    this.name = 'OffsiteBackupError'
  }
}

function safeLog(options: OffsiteBackupOptions) {
  return (message: string) => (options.log ?? ((line: string) => console.log(redactSecrets(line))))(redactSecrets(message))
}

/**
 * A single-run lock. Two schedulers (or a manual run during the nightly job)
 * would otherwise dump, upload and prune at the same time; the second run's
 * retention pass could expire the first run's fresh object before its manifest
 * is written. A stale lock older than the process lifetime is reclaimed so an
 * interrupted run cannot block backups forever.
 */
export function acquireBackupLock(dir: string, now: Date = new Date(), staleMinutes = 180): { release(): void; path: string } {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, '.offsite-backup.lock')
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8').trim()
    const stamp = Date.parse(raw.split('|')[1] ?? '')
    const ageMinutes = Number.isFinite(stamp) ? (now.getTime() - stamp) / 60_000 : Infinity
    if (ageMinutes < staleMinutes) {
      throw new OffsiteBackupError(
        'Another backup run is already in progress. Wait for it to finish before starting another.',
        'lock',
        2,
      )
    }
  }
  writeFileSync(path, `${process.pid}|${now.toISOString()}`)
  return {
    path,
    release() {
      try { if (existsSync(path)) rmSync(path) } catch { /* the lock is advisory */ }
    },
  }
}

/** Read manifests back from storage. Unreadable manifests are reported, not ignored. */
export async function listManifests(storage: BackupStorage): Promise<{ manifests: BackupManifest[]; unreadable: string[] }> {
  const objects = await storage.list(DB_PREFIX)
  const manifests: BackupManifest[] = []
  const unreadable: string[] = []
  for (const object of objects.filter((o) => o.key.endsWith(MANIFEST_SUFFIX))) {
    try {
      const parsed = JSON.parse((await storage.get(object.key)).toString('utf8')) as BackupManifest
      if (parsed && typeof parsed.objectKey === 'string') manifests.push(parsed)
      else unreadable.push(object.key)
    } catch {
      unreadable.push(object.key)
    }
  }
  return { manifests, unreadable }
}

export async function runOffsiteBackup(options: OffsiteBackupOptions): Promise<OffsiteBackupResult> {
  const log = safeLog(options)
  const now = options.now ?? new Date()
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const id = `db-${stamp}`
  const objectKey = `${DB_PREFIX}${id}.sql.gz.enc`
  const manifestKey = `${DB_PREFIX}${id}${MANIFEST_SUFFIX}`

  const manifest: BackupManifest = {
    id,
    kind: 'database',
    startedAt: now.toISOString(),
    completedAt: null,
    driver: options.storage.driver,
    objectKey,
    sizeBytes: 0,
    checksumSha256: '',
    plaintextSha256: null,
    encrypted: true,
    verifiedAt: null,
    verifyMethod: 'none',
  }

  try {
    log(`[offsite] step 1/9: dump database into memory`)
    const dump = (options.dump ?? dumpToBuffer)(options.dbUrl)

    log('[offsite] step 2/9: compress and encrypt')
    const plaintext = gzipSync(dump)
    const encrypted = encryptBackup(plaintext, options.encryptionKey)
    const plaintextSha = sha256Hex(plaintext)
    const checksum = sha256Hex(encrypted)
    manifest.sizeBytes = encrypted.length
    manifest.checksumSha256 = checksum
    manifest.plaintextSha256 = plaintextSha
    log(`[offsite] prepared ${(encrypted.length / 1024).toFixed(1)} KiB, sha256 ${checksum.slice(0, 16)}…`)

    log('[offsite] step 3/9: upload to independent storage')
    await options.storage.put(objectKey, encrypted)
    if (options.corruptUploadForTest) {
      // Only reachable from a test harness; proves the readback check is real.
      await options.storage.put(objectKey, Buffer.concat([encrypted.subarray(0, 40), Buffer.from('tampered')]))
    }

    log('[offsite] step 4/9: confirm the object exists and matches its size')
    const head = await options.storage.head(objectKey)
    if (!head) throw new OffsiteBackupError('the uploaded object is not present in storage.', 'head')
    if (!options.corruptUploadForTest && head.size !== encrypted.length) {
      throw new OffsiteBackupError(`storage reports ${head.size} bytes but ${encrypted.length} were uploaded.`, 'head')
    }

    log('[offsite] step 5/9: read the object back and authenticate it')
    const readback = await options.storage.get(objectKey)
    if (sha256Hex(readback) !== checksum) {
      throw new OffsiteBackupError('the stored object does not match its checksum (upload corrupted or intercepted).', 'readback')
    }
    const decrypted = decryptBackup(readback, options.encryptionKey)
    if (sha256Hex(decrypted) !== plaintextSha) {
      throw new OffsiteBackupError('the decrypted backup does not match the original dump.', 'readback')
    }
    const unpacked = gunzipSync(decrypted)
    if (sha256Hex(unpacked) !== sha256Hex(dump)) {
      throw new OffsiteBackupError('the decompressed backup does not match the source dump.', 'readback')
    }
    manifest.verifiedAt = new Date().toISOString()
    manifest.verifyMethod = 'readback'
    log('[offsite] ok: stored object authenticates and matches the source dump')

    log('[offsite] step 6/9: prove the backup restores')
    if (options.verifyRestore) {
      const cleanup = createCleanupRegistry()
      try {
        const sanitized = sanitizeDumpForRestore(unpacked.toString('utf8')).text
        const evidence = verifyRestore(options.dbUrl, sanitized, cleanup)
        manifest.evidence = {
          restoredTables: evidence.restoredTables,
          migrationsApplied: evidence.migrationsApplied,
          rowCounts: Object.entries(evidence.rowCounts).map(([table, count]) => `${table}=${count}`).join(','),
        }
        log(`[offsite] ok: full restore verified (${evidence.restoredTables} tables, ${evidence.migrationsApplied} migrations)`)
      } finally {
        for (const failure of cleanup.runAll()) {
          log(`[offsite] WARNING: cleanup step "${failure.name}" failed: ${failure.error.message}`)
        }
      }
    } else {
      // Honest labelling: a hash-verified object is not a proven restore.
      manifest.verifyMethod = 'checksum-only'
      manifest.evidence = { restoreTested: false }
      log('[offsite] note: restore not exercised in this run (set BACKUP_VERIFY_RESTORE=true to include it)')
    }

    log('[offsite] step 7/9: write the manifest')
    manifest.completedAt = new Date().toISOString()
    await options.storage.put(manifestKey, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))

    let expiredKeys: string[] = []
    try {
      log('[offsite] step 8/9: apply retention')
      expiredKeys = await applyRetention(options, now, log)
    } catch (error) {
      // Retention is maintenance, not protection: never fail a good backup over it.
      log(`[offsite] WARNING: retention pass skipped: ${error instanceof Error ? error.message : String(error)}`)
    }

    log('[offsite] step 9/9: record the run')
    if (options.recordHistory !== false) {
      await recordBackupRun(manifest).catch((error) => {
        log(`[offsite] WARNING: backup history not recorded: ${error instanceof Error ? error.message : String(error)}`)
      })
    }

    await sendRecoveryAlert(
      'backup_failed',
      'Backups are completing again. The latest verified backup is current.',
      { driver: options.storage.driver },
    ).catch(() => {})

    return { ok: true, manifest, expiredKeys }
  } catch (error) {
    manifest.completedAt = new Date().toISOString()
    manifest.error = error instanceof Error ? error.message : String(error)
    if (options.recordHistory !== false) await recordBackupRun(manifest).catch(() => {})
    throw error instanceof OffsiteBackupError ? error : new OffsiteBackupError(manifest.error, 'pipeline')
  }
}

async function applyRetention(options: OffsiteBackupOptions, now: Date, log: (message: string) => void): Promise<string[]> {
  const { manifests } = await listManifests(options.storage)
  const policy = retentionPolicyFromEnv()
  const selection = selectExpiredBackups(manifests, now, policy)
  log(`[offsite] retention: keeping ${selection.keep.length}, expiring ${selection.expire.length} (${policy.days}d/${policy.weeks}w/${policy.months}mo)`)
  if (selection.expire.length === 0) return []
  // Belt and braces: refuse to run if nothing verified would survive.
  assertRetentionSafe(selection)
  const removed: string[] = []
  for (const manifest of selection.expire) {
    // Only delete an object whose own manifest says it is older than the newest
    // verified copy that is being kept.
    await options.storage.delete(manifest.objectKey)
    await options.storage.delete(`${DB_PREFIX}${manifest.id}${MANIFEST_SUFFIX}`)
    removed.push(manifest.objectKey)
  }
  return removed
}

/**
 * Best-effort history. Imported lazily so the backup pipeline still works in an
 * environment without a generated Prisma client (a bare CI container, a recovery
 * host) — the manifest in object storage remains the source of truth.
 */
export async function recordBackupRun(manifest: BackupManifest): Promise<void> {
  const { PrismaClient } = await import('@prisma/client')
  const client = new PrismaClient()
  try {
    await client.backupRun.create({
      data: {
        kind: manifest.kind,
        driver: manifest.driver,
        status: manifest.error ? 'failed' : 'succeeded',
        startedAt: new Date(manifest.startedAt),
        completedAt: manifest.completedAt ? new Date(manifest.completedAt) : null,
        sizeBytes: manifest.sizeBytes ? BigInt(manifest.sizeBytes) : null,
        checksumSha256: manifest.checksumSha256 || null,
        objectKey: manifest.objectKey || null,
        encrypted: manifest.encrypted,
        verifiedAt: manifest.verifiedAt ? new Date(manifest.verifiedAt) : null,
        detail: manifest.error
          ? `failed: ${manifest.error.slice(0, 200)}`
          : `verified ${manifest.verifyMethod}; ${Object.entries(manifest.evidence ?? {}).map(([k, v]) => `${k}=${v}`).join(' ')}`.slice(0, 400),
      },
    })
  } finally {
    await client.$disconnect().catch(() => {})
  }
}

/**
 * Nightly watchdog: alert when the newest verified backup is older than the
 * target. Intended for a scheduler that runs even when backups fail (the failure
 * alert covers the run itself; this covers the silent case where no run happens
 * at all because the scheduler was disabled).
 */
export async function checkBackupFreshnessAlert(now: Date = new Date(), maxAgeHours = 30): Promise<{ newestVerifiedAt: string | null; stale: boolean }> {
  const { PrismaClient } = await import('@prisma/client')
  const client = new PrismaClient()
  try {
    const latest = await client.backupRun.findFirst({
      where: { kind: 'database', verifiedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      select: { verifiedAt: true },
    })
    const newest = latest?.verifiedAt ?? null
    const ageHours = newest ? (now.getTime() - newest.getTime()) / 3_600_000 : Infinity
    const stale = ageHours > maxAgeHours
    if (stale) {
      await sendAlert({
        event: 'backup_stale',
        severity: 'critical',
        summary: 'No recent verified backup exists. Your shop is operating normally, but an administrator needs to check the backup schedule.',
        context: { newestVerifiedAt: newest ? newest.toISOString() : 'none', ageHours: Number.isFinite(ageHours) ? Math.round(ageHours) : null },
        dedupeKey: 'backup_stale',
      }).catch(() => {})
    }
    return { newestVerifiedAt: newest ? newest.toISOString() : null, stale }
  } finally {
    await client.$disconnect().catch(() => {})
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const value = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
  }
  const dbUrl = value('--url') || process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('[offsite] ERROR: no --url and no DATABASE_URL set.')
    return 2
  }

  let storage: BackupStorage
  try {
    storage = createStorageFromEnv()
  } catch (error) {
    // A configuration gap is reported as a gap, not as a failed backup: the
    // primary backup still exists and the shop is unaffected.
    console.error(`[offsite] NOT CONFIGURED: ${error instanceof Error ? error.message : String(error)}`)
    console.error('[offsite] See docs/DISASTER-RECOVERY.md § 2 for the exact variables and provider steps.')
    return 3
  }

  let key: Buffer
  try {
    key = parseEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY)
  } catch (error) {
    console.error(`[offsite] NOT CONFIGURED: ${error instanceof Error ? error.message : String(error)}`)
    return 3
  }

  const outDir = value('--out') || 'backups'
  let lock: { release(): void } | null = null
  try {
    lock = acquireBackupLock(outDir)
  } catch (error) {
    console.error(`[offsite] ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }

  try {
    const result = await runOffsiteBackup({
      dbUrl,
      storage,
      encryptionKey: key,
      outDir,
      verifyRestore: process.env.BACKUP_VERIFY_RESTORE === 'true',
    })
    if (args.includes('--json')) {
      console.log(JSON.stringify({ ok: true, id: result.manifest.id, sizeBytes: result.manifest.sizeBytes, expired: result.expiredKeys.length }))
    } else {
      console.log(`[offsite] PASS: ${result.manifest.id} stored at ${storage.destination} (${result.manifest.verifyMethod})`)
    }
    return 0
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error))
    console.error(`[offsite] FAILED: ${message}`)
    await sendAlert({
      event: 'backup_failed',
      severity: 'critical',
      summary: 'The off-site backup could not be completed. Your shop is operating normally, but an administrator has been notified about the backup.',
      context: { stage: error instanceof OffsiteBackupError ? error.stage : 'pipeline', reason: message.slice(0, 200) },
      dedupeKey: 'backup_failed:offsite',
    }).catch(() => {})
    return error instanceof OffsiteBackupError ? error.exitCode : 1
  } finally {
    lock?.release()
  }
}

if (process.argv[1] && /backup-offsite\.ts$|backup-offsite\.js$/.test(process.argv[1])) {
  main()
    .then((code) => { process.exitCode = code })
    .catch((error) => {
      console.error(`[offsite] FAILED: ${redactSecrets(error instanceof Error ? error.message : String(error))}`)
      process.exitCode = 1
    })
}

// Referenced so the scratch-database helper is not flagged as unused if a future
// change removes the restore step; also documents the derivation used above.
void databaseUrlFor

// ============================================================================
// Backup manifests + retention policy.
//
// Retention is the most dangerous part of a backup system: a bug there deletes
// the only copy of a business's data. Everything in this file is pure, so the
// safety properties are unit-tested without a database or a bucket:
//
//   1. The newest VERIFIED backup is never expired.
//   2. At least RETENTION_FLOOR backups stay, whatever the age buckets say.
//   3. Daily/weekly/monthly floors cannot be configured below the contractual
//      minimums (7 / 4 / 6).
//   4. A manifest whose verification failed is never counted as a recovery copy.
// ============================================================================

export type BackupKind = 'database' | 'media'

export interface BackupManifest {
  /** Stable id == object key basename, so duplicate runs cannot collide. */
  id: string
  kind: BackupKind
  /** ISO timestamps. */
  startedAt: string
  completedAt: string | null
  driver: string
  /** Object key in the off-site store. */
  objectKey: string
  /** Size of the stored (encrypted) object. */
  sizeBytes: number
  /** SHA-256 of the stored object: what the store must return byte-for-byte. */
  checksumSha256: string
  /** SHA-256 of the compressed dump before encryption, for a restore-time check. */
  plaintextSha256: string | null
  encrypted: boolean
  /** Set only after the object was read back and decrypted successfully. */
  verifiedAt: string | null
  /** How verification was performed, for the audit trail. */
  verifyMethod: 'readback' | 'checksum-only' | 'none'
  /** Row/schema evidence captured during verification. */
  evidence?: Record<string, string | number | boolean | null>
  error?: string
}

export interface RetentionPolicy {
  days: number
  weeks: number
  months: number
  /** Absolute floor: never go below this many backups, however old. */
  minCopies: number
}

export const RETENTION_MINIMUMS = { days: 7, weeks: 4, months: 6 } as const
export const RETENTION_FLOOR = 3

/** Read the policy from the environment, clamping to the contractual minimums. */
export function retentionPolicyFromEnv(env: Record<string, string | undefined> = process.env): RetentionPolicy {
  const read = (name: string, fallback: number, minimum: number) => {
    const raw = env[name]
    const parsed = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
    if (!Number.isFinite(parsed) || parsed < minimum) return Math.max(fallback, minimum)
    return Math.floor(parsed)
  }
  return {
    days: read('BACKUP_RETENTION_DAYS', RETENTION_MINIMUMS.days, RETENTION_MINIMUMS.days),
    weeks: read('BACKUP_RETENTION_WEEKS', RETENTION_MINIMUMS.weeks, RETENTION_MINIMUMS.weeks),
    months: read('BACKUP_RETENTION_MONTHS', RETENTION_MINIMUMS.months, RETENTION_MINIMUMS.months),
    minCopies: read('BACKUP_RETENTION_MIN_COPIES', RETENTION_FLOOR, RETENTION_FLOOR),
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

function isoWeekKey(date: Date): string {
  // ISO-8601 week: Thursday of the current week determines the year.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7)
}

function timeOf(manifest: BackupManifest): number {
  const stamp = manifest.completedAt ?? manifest.startedAt
  const value = Date.parse(stamp)
  return Number.isFinite(value) ? value : 0
}

/** Newest first, with unreadable timestamps last rather than first. */
export function sortNewestFirst(manifests: BackupManifest[]): BackupManifest[] {
  return [...manifests].sort((a, b) => timeOf(b) - timeOf(a))
}

export function isVerified(manifest: BackupManifest): boolean {
  return typeof manifest.verifiedAt === 'string' && Number.isFinite(Date.parse(manifest.verifiedAt))
}

export interface ExpirySelection {
  expire: BackupManifest[]
  keep: BackupManifest[]
  /** Human-readable reasons, one per kept copy, for the run log. */
  reasons: Record<string, string>
}

/**
 * Choose which backups may be deleted.
 *
 * Only VERIFIED backups count as recovery copies. Unverified or failed objects
 * are expired last (they cannot restore anything) but they are still never
 * removed while fewer than `minCopies` verified copies remain.
 */
export function selectExpiredBackups(
  manifests: BackupManifest[],
  now: Date,
  policy: RetentionPolicy = retentionPolicyFromEnv({}),
): ExpirySelection {
  const usable = manifests.filter((m) => !m.error)
  const ordered = sortNewestFirst(usable)
  if (ordered.length === 0) return { expire: [], keep: [], reasons: {} }

  const reasons: Record<string, string> = {}
  const keep = new Map<string, string>()
  const keepFor = (manifest: BackupManifest, reason: string) => {
    if (!keep.has(manifest.id)) { keep.set(manifest.id, reason); reasons[manifest.id] = reason }
  }

  // Rule 1: the newest verified copy is untouchable.
  const newestVerified = ordered.find(isVerified)
  if (newestVerified) keepFor(newestVerified, 'newest verified backup')
  else keepFor(ordered[0], 'newest backup (not yet verified: nothing better exists)')

  // Rule 2: age buckets — newest copy inside each bucket.
  const bucket = (key: (date: Date) => string, count: number, label: string, unit: 'day' | 'week' | 'month') => {
    const seen = new Set<string>()
    for (const manifest of ordered) {
      const date = new Date(timeOf(manifest))
      if (!Number.isFinite(date.getTime())) continue
      const ageDays = (now.getTime() - date.getTime()) / DAY_MS
      const horizon = unit === 'day' ? count : unit === 'week' ? count * 7 : count * 31
      if (ageDays > horizon) continue
      const keyValue = key(date)
      if (seen.has(keyValue)) continue
      seen.add(keyValue)
      keepFor(manifest, `${label} bucket ${keyValue}`)
    }
  }
  bucket(dayKey, policy.days, 'daily', 'day')
  bucket(isoWeekKey, policy.weeks, 'weekly', 'week')
  bucket(monthKey, policy.months, 'monthly', 'month')

  // Rule 3: absolute floor of verified copies.
  let verifiedKept = [...keep.keys()].filter((id) => {
    const manifest = ordered.find((m) => m.id === id)
    return manifest ? isVerified(manifest) : false
  }).length
  for (const manifest of ordered) {
    if (verifiedKept >= policy.minCopies) break
    if (!isVerified(manifest) || keep.has(manifest.id)) continue
    keepFor(manifest, 'retention floor')
    verifiedKept++
  }

  const expire: BackupManifest[] = []
  for (const manifest of ordered) {
    if (keep.has(manifest.id)) continue
    // Safety net: never let the set of surviving verified copies drop to zero.
    const survivingVerified = keep.size > 0 && [...keep.keys()].some((id) => {
      const kept = ordered.find((m) => m.id === id)
      return kept ? isVerified(kept) : false
    })
    if (isVerified(manifest) && !survivingVerified) {
      keepFor(manifest, 'would leave no verified copy')
      continue
    }
    expire.push(manifest)
  }

  return { expire, keep: ordered.filter((m) => keep.has(m.id)), reasons }
}

/** Guard for callers about to delete: refuse when nothing verified would remain. */
export function assertRetentionSafe(selection: ExpirySelection): void {
  const survivors = selection.keep.filter(isVerified)
  if (survivors.length === 0) {
    throw new Error('Refusing to expire backups: no verified recovery copy would remain.')
  }
}

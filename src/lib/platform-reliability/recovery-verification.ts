/**
 * Recovery verification (Priority 1, part G).
 *
 * A backup that has never been restored is a hypothesis. This module decides whether the
 * platform can honestly say data is recoverable, and it says no in three distinct ways:
 * never tested, tested too long ago, and tested and failed. Only a recent restore that
 * matched the source row counts and reported no errors earns "verified".
 *
 * Pure: the caller supplies the evidence and the current time.
 */

export interface BackupEvidence {
  id: string
  createdAt: string
  /** Bytes written, when the backup tool reported it. */
  sizeBytes?: number | null
  /** Set only when the backup itself was checked, not merely created. */
  checksumVerifiedAt?: string | null
}

export interface RestoreEvidence {
  id: string
  backupId: string
  startedAt: string
  completedAt: string | null
  /** Tables the drill restored. */
  tablesRestored: string[]
  /** Rows compared in the source and the restored copy. */
  rowsCompared: number | null
  /** True when every compared row count matched. */
  rowCountsMatched: boolean | null
  errors: string[]
}

export type RecoveryState = 'verified' | 'failed' | 'stale' | 'unverified'

export interface RecoveryReport {
  state: RecoveryState
  headline: string
  detail: string
  action: string | null
  lastRestoreAt: string | null
  lastBackupAt: string | null
  backupCount: number
  /** Hours since the last verified restore, or null when there has never been one. */
  hoursSinceVerifiedRestore: number | null
}

/** A restore drill older than this no longer proves anything about today's data. */
export const RESTORE_MAX_AGE_DAYS = 30

function hoursBetween(fromIso: string, toMs: number): number | null {
  const from = Date.parse(fromIso)
  if (Number.isNaN(from)) return null
  return Math.max(0, Math.round(((toMs - from) / 3_600_000) * 10) / 10)
}

function latestBy<T>(items: T[], key: (item: T) => string): T | null {
  let best: T | null = null
  let bestMs = Number.NEGATIVE_INFINITY
  for (const item of items) {
    const ms = Date.parse(key(item))
    if (!Number.isNaN(ms) && ms > bestMs) {
      bestMs = ms
      best = item
    }
  }
  return best
}

export function isRestoreSuccessful(restore: RestoreEvidence): boolean {
  return Boolean(
    restore.completedAt &&
      restore.errors.length === 0 &&
      restore.tablesRestored.length > 0 &&
      restore.rowCountsMatched === true &&
      (restore.rowsCompared ?? 0) > 0,
  )
}

export function evaluateRecovery(
  backups: BackupEvidence[] | null,
  restores: RestoreEvidence[] | null,
  now: Date,
): RecoveryReport {
  if (backups === null || restores === null) {
    return {
      state: 'unverified',
      headline: 'We could not read the backup and restore records.',
      detail: 'Without those records there is no way to say whether your data could be recovered.',
      action: 'Run the backup verification and the restore drill.',
      lastRestoreAt: null,
      lastBackupAt: null,
      backupCount: 0,
      hoursSinceVerifiedRestore: null,
    }
  }

  const lastBackup = latestBy(backups, (b) => b.createdAt)
  const successful = restores.filter(isRestoreSuccessful)
  const lastSuccess = latestBy(successful, (r) => r.completedAt ?? r.startedAt)
  const lastAttempt = latestBy(restores, (r) => r.completedAt ?? r.startedAt)
  const nowMs = now.getTime()

  if (lastAttempt && !isRestoreSuccessful(lastAttempt)) {
    return {
      state: 'failed',
      headline: 'The last restore test did not succeed.',
      detail: 'A backup exists, but the last attempt to restore it failed or did not finish. That is the situation backups are for, so treat it as urgent.',
      action: 'Contact a specialist before relying on these backups. Do not overwrite the existing backups.',
      lastRestoreAt: lastAttempt.completedAt ?? lastAttempt.startedAt,
      lastBackupAt: lastBackup?.createdAt ?? null,
      backupCount: backups.length,
      hoursSinceVerifiedRestore: lastSuccess && lastSuccess.completedAt ? hoursBetween(lastSuccess.completedAt, nowMs) : null,
    }
  }

  if (!lastSuccess || !lastSuccess.completedAt) {
    return {
      state: 'unverified',
      headline: backups.length > 0 ? 'A backup exists, but it has never been restored.' : 'No backup and no restore have been recorded.',
      detail: 'Creating a backup is not proof that it can be restored. Until a restore has been tested, recovery is a hope, not a fact.',
      action: 'Run a restore drill against a spare database.',
      lastRestoreAt: null,
      lastBackupAt: lastBackup?.createdAt ?? null,
      backupCount: backups.length,
      hoursSinceVerifiedRestore: null,
    }
  }

  const hours = hoursBetween(lastSuccess.completedAt, nowMs)
  const days = hours === null ? null : hours / 24
  if (days === null || days > RESTORE_MAX_AGE_DAYS) {
    return {
      state: 'stale',
      headline: 'The last successful restore test is out of date.',
      detail: `The last restore that passed was ${days === null ? 'at an unreadable time' : `${Math.floor(days)} days ago`}. Data has changed since then, so it no longer proves today's data can be recovered.`,
      action: `Run a restore drill; the target is at least every ${RESTORE_MAX_AGE_DAYS} days.`,
      lastRestoreAt: lastSuccess.completedAt,
      lastBackupAt: lastBackup?.createdAt ?? null,
      backupCount: backups.length,
      hoursSinceVerifiedRestore: hours,
    }
  }

  return {
    state: 'verified',
    headline: 'Your data was restored successfully in a test.',
    detail: `The last restore test passed ${hours === null ? 'recently' : `${Math.round(hours)} hours ago`}, with row counts matching the source and no errors.`,
    action: null,
    lastRestoreAt: lastSuccess.completedAt,
    lastBackupAt: lastBackup?.createdAt ?? null,
    backupCount: backups.length,
    hoursSinceVerifiedRestore: hours,
  }
}

/** The sentence every backup screen should carry, so creation is never mistaken for proof. */
export const BACKUP_IS_NOT_PROOF = 'A backup being created does not mean it can be restored. Only a restore test proves that.'

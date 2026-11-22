/**
 * Plain-language reliability answers for the owner's page.
 *
 * The page already had sections for health, software and security. What was missing was
 * the two questions an owner asks next: "is my data actually restorable?" and "is anything
 * waiting for my decision?" This module turns the existing recovery report and the existing
 * approval count into sentences, and it holds one rule that matters more than the wording:
 *
 *   An unknown result is never presented as healthy.
 *
 * Pure: no database, no clock, no network.
 */

import type { RecoveryReport, RecoveryState } from './recovery-verification'
import { RESTORE_MAX_AGE_DAYS } from './recovery-verification'

export type OwnerTone = 'fine' | 'attention' | 'action' | 'unknown' | 'not-configured'

export interface OwnerAnswer {
  /** One line the owner can act on. */
  headline: string
  /** What it means, in everyday words. */
  detail: string
  /** What to do next, or null when there is nothing to do. */
  next: string | null
  tone: OwnerTone
  /** Short badge text. */
  badge: string
}

const BADGE: Record<OwnerTone, string> = {
  fine: 'Working normally',
  attention: 'Worth a look',
  action: 'Action required',
  unknown: 'Could not be checked',
  'not-configured': 'Not set up yet',
}

export function toneBadge(tone: OwnerTone): string {
  return BADGE[tone]
}

/**
 * The recovery answer. `verified` is the only tone that may read as fine, and it is only
 * reachable when the underlying report says verified.
 */
export function recoveryAnswer(report: RecoveryReport | null): OwnerAnswer {
  if (!report) {
    return {
      headline: 'We could not read your backup and restore records.',
      detail: 'The record did not load, so we cannot tell you whether your data could be recovered. That is not the same as saying it is fine.',
      next: 'Reload this page in a minute. If it still says this, ask your operator to check the backup records.',
      tone: 'unknown',
      badge: BADGE.unknown,
    }
  }

  const state: RecoveryState = report.state
  switch (state) {
    case 'verified': {
      const when = report.lastRestoreAt ? new Date(report.lastRestoreAt).toLocaleDateString() : null
      return {
        headline: 'A copy of your data was restored and checked successfully.',
        detail: when
          ? `The most recent successful restore test finished on ${when}. It restored your records into a temporary database, compared them with the originals and threw the copy away.`
          : 'The most recent restore test passed: your records were restored into a temporary database, compared with the originals, and the copy was thrown away.',
        next: null,
        tone: 'fine',
        badge: BADGE.fine,
      }
    }
    case 'stale':
      return {
        headline: `Your last successful restore test is more than ${RESTORE_MAX_AGE_DAYS} days old.`,
        detail: 'Your backups may still be available, but we need a fresh test to confirm that your data can be recovered. Until then, treat the backups as unproven.',
        next: `Ask your operator to run the restore test again. It is read-only for your live data: it restores into a temporary copy and deletes it afterwards.`,
        tone: 'attention',
        badge: BADGE.attention,
      }
    case 'failed':
      return {
        headline: 'The last attempt to restore your data did not succeed.',
        detail: 'A backup exists, but the last test to restore it failed or did not finish. This is exactly the situation backups are for, so it needs attention rather than waiting.',
        next: 'Contact your operator or a specialist before relying on these backups, and do not overwrite the existing ones.',
        tone: 'action',
        badge: BADGE.action,
      }
    default:
      return {
        headline: 'No restore test has been recorded yet.',
        detail: 'Backups may be running, but a backup on its own does not prove your data can be recovered. Only a restore test does that.',
        next: 'Ask your operator to run a restore test. It restores into a temporary database and does not touch your live records.',
        tone: 'unknown',
        badge: BADGE.unknown,
      }
  }
}

/** The "is anything waiting for me?" answer. */
export function approvalsAnswer(pending: number | null): OwnerAnswer {
  if (pending === null) {
    return {
      headline: 'We could not read whether anything is waiting for your decision.',
      detail: 'That does not mean nothing is waiting; it means the record could not be read.',
      next: 'Reload this page in a minute. Nothing changes on your shop until you decide either way.',
      tone: 'unknown',
      badge: BADGE.unknown,
    }
  }
  if (pending === 0) {
    return {
      headline: 'Nothing is waiting for your decision.',
      detail: 'No update or repair has been proposed. Anything proposed in future appears here first, with an explanation of what it would change.',
      next: null,
      tone: 'fine',
      badge: BADGE.fine,
    }
  }
  return {
    headline: `${pending} ${pending === 1 ? 'change is' : 'changes are'} waiting for your decision.`,
    detail: 'A change has been proposed and has not been made. Your shop keeps working exactly as it is until you say yes.',
    next: 'Read what each one would change before approving it. Nothing here is applied by opening this page.',
    tone: 'action',
    badge: BADGE.action,
  }
}

/** The backup-recency answer, kept separate from recovery because they are different facts. */
export function backupAnswer(backupAgeHours: number | null): OwnerAnswer {
  if (backupAgeHours === null) {
    return {
      headline: 'We could not read when your data was last backed up.',
      detail: 'No verified backup was recorded, so we will not tell you it is fine.',
      next: 'Ask your operator to check the backup schedule.',
      tone: 'unknown',
      badge: BADGE.unknown,
    }
  }
  const hours = Math.round(backupAgeHours)
  if (hours <= 36) {
    return {
      headline: `Your data was backed up ${hours <= 1 ? 'within the last hour' : `${hours} hours ago`}.`,
      detail: 'A recent, verified copy of your records exists.',
      next: null,
      tone: 'fine',
      badge: BADGE.fine,
    }
  }
  if (hours <= 72) {
    return {
      headline: `Your newest verified backup is ${hours} hours old.`,
      detail: 'That is longer than expected. The copy still exists, but more of today would be lost if your data had to be recovered.',
      next: 'Ask your operator to check the backup schedule.',
      tone: 'attention',
      badge: BADGE.attention,
    }
  }
  return {
    headline: `Your newest verified backup is ${Math.round(hours / 24)} days old.`,
    detail: 'That is too long for a busy shop. If your data had to be recovered, a lot of recent work would be missing.',
    next: 'Ask your operator to run a backup today, then check it again here.',
    tone: 'action',
    badge: BADGE.action,
  }
}

/**
 * A one-line answer to "is my shop's system working?". Deliberately conservative: a single
 * unknown makes the whole line unknown rather than fine.
 */
export function overallAnswer(answers: OwnerAnswer[]): OwnerAnswer {
  if (answers.some((a) => a.tone === 'action')) {
    const first = answers.find((a) => a.tone === 'action')!
    return { ...first, tone: 'action', badge: BADGE.action }
  }
  if (answers.some((a) => a.tone === 'attention')) {
    const first = answers.find((a) => a.tone === 'attention')!
    return { ...first, tone: 'attention', badge: BADGE.attention }
  }
  if (answers.some((a) => a.tone === 'unknown')) {
    const first = answers.find((a) => a.tone === 'unknown')!
    return { ...first, tone: 'unknown', badge: BADGE.unknown }
  }
  if (answers.some((a) => a.tone === 'not-configured')) {
    const first = answers.find((a) => a.tone === 'not-configured')!
    return { ...first, tone: 'not-configured', badge: BADGE['not-configured'] }
  }
  return {
    headline: 'Everything that could be checked came back clear.',
    detail: 'Your website is taking bookings, your data is backed up, and a restore test has proven the backup can be recovered.',
    next: null,
    tone: 'fine',
    badge: BADGE.fine,
  }
}

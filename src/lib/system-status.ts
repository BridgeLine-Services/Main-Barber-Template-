// ============================================================================
// Owner-facing system status (Part 15)
//
// An owner is not an operator. They do not need to know what Redis is, they need
// to know three things: is my shop reachable, is my data safe, and do I have to
// do something. This module turns the technical readiness report into those
// answers in plain language, with no hostname, provider name, stack trace, table
// name or error code anywhere in the output.
//
// Kept pure so the wording is unit-tested: a status sentence that tells an owner
// to "check the Redis connection" is a defect, not a style choice.
// ============================================================================

export type OwnerStatusTone = 'good' | 'watch' | 'action' | 'off'

export interface OwnerStatusRow {
  /** Short heading the owner sees, e.g. "Online booking". */
  label: string
  tone: OwnerStatusTone
  /** One plain sentence. No technical vocabulary, no blame, no emoji. */
  detail: string
}

export interface OwnerStatusSummary {
  headline: string
  rows: OwnerStatusRow[]
  /** True when something needs the owner (or their support) to act. */
  needsAttention: boolean
}

export type DependencyState = 'ok' | 'degraded' | 'unavailable' | 'not_configured' | 'unknown'

export interface OwnerStatusInput {
  database: DependencyState
  bookings: DependencyState
  notifications: DependencyState
  backup: DependencyState
  backupAgeHours?: number | null
  photos: DependencyState
}

const SAFE_LINE = 'Nothing has been lost. Your appointments and customer details are safe.'

function sentenceFor(row: OwnerStatusRow): string {
  return `${row.label}: ${row.detail}`
}

export function buildOwnerStatus(input: OwnerStatusInput): OwnerStatusSummary {
  const rows: OwnerStatusRow[] = []

  // Website
  if (input.database === 'ok') {
    rows.push({ label: 'Your website', tone: 'good', detail: 'It is open and showing your services.' })
  } else {
    rows.push({
      label: 'Your website',
      tone: 'action',
      detail: 'It is temporarily unavailable. Your information is safe and this page will update when it is back.',
    })
  }

  // Bookings
  if (input.database !== 'ok') {
    rows.push({ label: 'Online booking', tone: 'action', detail: 'Booking is paused while the website is unavailable. Please check again shortly.' })
  } else if (input.bookings === 'ok') {
    rows.push({ label: 'Online booking', tone: 'good', detail: 'Customers can book, cancel and reschedule.' })
  } else if (input.bookings === 'degraded') {
    rows.push({
      label: 'Online booking',
      tone: 'watch',
      detail: `Booking is temporarily paused to keep your data safe. ${SAFE_LINE} Please try again in a few minutes.`,
    })
  } else {
    rows.push({ label: 'Online booking', tone: 'watch', detail: 'Booking could not be checked just now. It may still be working normally.' })
  }

  // Data safety — the question owners actually ask during an incident.
  rows.push({
    label: 'Your appointments and customer details',
    tone: input.database === 'ok' ? 'good' : 'watch',
    detail: input.database === 'ok'
      ? 'They are stored safely and nothing needs to be re-entered.'
      : `They are stored safely. ${SAFE_LINE}`,
  })

  // Notifications: optional, never presented as a fault.
  if (input.notifications === 'ok') {
    rows.push({ label: 'Text and email reminders', tone: 'good', detail: 'Reminders are being sent.' })
  } else if (input.notifications === 'not_configured') {
    rows.push({ label: 'Text and email reminders', tone: 'off', detail: 'Reminders are turned off for this shop. Everything else works normally.' })
  } else if (input.notifications === 'degraded') {
    rows.push({
      label: 'Text and email reminders',
      tone: 'watch',
      detail: 'Some reminders could not be sent just now. Your shop is operating normally and no appointment was affected.',
    })
  } else {
    rows.push({ label: 'Text and email reminders', tone: 'watch', detail: 'Reminder delivery could not be checked just now.' })
  }

  // Backups
  if (input.backup === 'ok') {
    rows.push({ label: 'Backups', tone: 'good', detail: 'Your latest backup was completed and checked.' })
  } else if (input.backup === 'degraded') {
    const age = input.backupAgeHours
    rows.push({
      label: 'Backups',
      tone: 'action',
      detail: age != null && Number.isFinite(age)
        ? `Your latest backup is about ${Math.round(age / 24)} day${Math.round(age / 24) === 1 ? '' : 's'} old. Your shop is operating normally, but an administrator has been notified.`
        : 'Your latest backup needs attention. Your shop is operating normally, but an administrator has been notified.',
    })
  } else if (input.backup === 'not_configured') {
    rows.push({ label: 'Backups', tone: 'off', detail: 'Automatic backups are not switched on for this shop yet. Ask your provider to enable them.' })
  } else {
    rows.push({ label: 'Backups', tone: 'watch', detail: 'Backup status has not been recorded yet. Ask your provider to confirm backups are running.' })
  }

  // Photos (optional integration)
  if (input.photos === 'not_configured') {
    rows.push({ label: 'Shop photos', tone: 'off', detail: 'Photo uploads are not set up. Photos already on your site still show.' })
  } else if (input.photos === 'degraded' || input.photos === 'unavailable') {
    rows.push({ label: 'Shop photos', tone: 'watch', detail: 'New photo uploads are temporarily unavailable. Photos already on your site still show.' })
  } else if (input.photos === 'ok') {
    rows.push({ label: 'Shop photos', tone: 'good', detail: 'Your photos are available and protected.' })
  }

  const needsAttention = rows.some((row) => row.tone === 'action')
  const watching = rows.some((row) => row.tone === 'watch')
  const headline = needsAttention
    ? 'Some things need attention'
    : watching
      ? 'Your shop is working, with one temporary issue'
      : 'Everything is working'

  return { headline, rows, needsAttention }
}

/** The owner-facing sentence for a whole summary (for alerts and emails). */
export function describeOwnerStatus(summary: OwnerStatusSummary): string {
  return [summary.headline, ...summary.rows.map(sentenceFor)].join('\n')
}

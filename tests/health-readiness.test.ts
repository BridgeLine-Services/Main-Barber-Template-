// Health and readiness.
//
// The contract under test: a critical dependency failure is the ONLY thing that
// makes a deployment unready, optional integrations never do, and the public
// response cannot be used to fingerprint the stack.

import {
  BACKUP_FRESHNESS,
  buildReadinessReport,
  checkBackupEncryption,
  checkMediaStorage,
  evaluateBackupFreshness,
  publicReadinessView,
  readinessHttpStatus,
} from '../src/lib/health'
import { buildOwnerStatus } from '../src/lib/system-status'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

async function main() {
  console.log('--- backup freshness ---')
  const now = new Date('2026-11-17T12:00:00Z')
  const fresh = evaluateBackupFreshness(new Date('2026-11-17T03:00:00Z'), now)
  assert(fresh.status === 'ok' && Math.round(fresh.ageHours!) === 9, 'a backup from this morning is fresh')
  const late = evaluateBackupFreshness(new Date('2026-11-15T22:00:00Z'), now)
  assert(late.status === 'degraded' && late.ageHours! > BACKUP_FRESHNESS.warnHours, 'a day-and-a-half-old backup is a warning')
  const old = evaluateBackupFreshness(new Date('2026-11-13T02:00:00Z'), now)
  assert(old.status === 'degraded' && old.ageHours! > BACKUP_FRESHNESS.criticalHours, 'a three-day-old backup is degraded')
  const none = evaluateBackupFreshness(null, now)
  assert(none.status === 'unknown' && none.ageHours === null, 'no recorded backup is unknown, not "fine"')
  const broken = evaluateBackupFreshness('not-a-date', now)
  assert(broken.status === 'unknown', 'an unreadable timestamp is unknown, not fresh')
  assert(/ask your operator|administrator|confirmed/i.test(none.detail), 'the owner-facing wording says what to do')
  assert(!/database|postgres|s3|bucket|http/i.test(none.detail + fresh.detail + late.detail + old.detail), 'no infrastructure terms in owner-facing detail')

  console.log('--- optional integrations never make a deployment unready ---')
  const savedBlob = process.env.BLOB_READ_WRITE_TOKEN
  const savedSmtp = process.env.SMTP_HOST
  delete process.env.BLOB_READ_WRITE_TOKEN
  delete process.env.SMTP_HOST
  try {
    const media = checkMediaStorage()
    assert(media.status === 'not_configured' && media.role === 'optional', 'missing photo storage is a gap, not a fault')
    assert(/still work/i.test(media.detail), 'the detail explains what still works')
    const encryption = checkBackupEncryption()
    assert(encryption.role === 'optional', 'unencrypted off-site backups are a gap, not a fault')
  } finally {
    if (savedBlob !== undefined) process.env.BLOB_READ_WRITE_TOKEN = savedBlob
    if (savedSmtp !== undefined) process.env.SMTP_HOST = savedSmtp
  }

  console.log('--- the real report against the real database ---')
  const report = await buildReadinessReport(now)
  const database = report.checks.find((check) => check.name === 'database')!
  assert(database.status === 'ok', 'the database check passes against the test database')
  assert(report.status !== 'unavailable', 'a reachable database means the deployment is not unavailable')
  assert(report.checks.some((check) => check.name === 'backup'), 'the report includes backup status')
  assert(report.checks.some((check) => check.name === 'rate_limit_store'), 'the report includes the shared limiter')
  assert(report.checks.every((check) => check.role === 'critical' || check.role === 'optional' || check.role === 'required_for_writes'), 'every check declares its role')
  assert(readinessHttpStatus(report) === 200 || report.status === 'unavailable', 'only a critical failure maps to 503')

  const backup = report.checks.find((check) => check.name === 'backup')!
  assert(['ok', 'degraded', 'unknown'].includes(backup.status), 'backup status is one of the honest three')

  console.log('--- the public response cannot fingerprint the stack ---')
  const view = publicReadinessView(report)
  const serialized = JSON.stringify(view)
  assert(!serialized.includes('://'), 'no URL in the public response')
  assert(!/password|secret|token|postgres|redis|upstash|blob/i.test(serialized), 'no provider or credential vocabulary')
  assert(view.checks.every((check) => Object.keys(check).length === 2), 'each public check exposes only name and status')
  assert(view.checks.every((check) => !('detail' in check) && !('role' in check)), 'detail and role stay server-side')

  console.log('--- the same report drives the owner screen ---')
  const owner = buildOwnerStatus({
    database: 'ok',
    bookings: 'ok',
    notifications: 'not_configured',
    backup: backup.status === 'ok' ? 'ok' : 'degraded',
    photos: 'not_configured',
  })
  assert(owner.rows.length >= 5, 'the owner sees one row per thing they care about')
  assert(!owner.needsAttention || backup.status !== 'ok', 'attention is only requested when something is actually wrong')

  console.log(`\nHealth and readiness tests: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => { console.error(error); process.exit(1) })

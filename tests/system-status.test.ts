// The owner-facing status screen, tested as copy.
//
// A status page for a barbershop owner is a writing problem before it is an
// engineering one. These assertions fail if the wording ever drifts back into
// operator language: no "Redis", no "database", no stack traces, no blame, and
// always the answer to "is my data safe?".

import { buildOwnerStatus, describeOwnerStatus, type OwnerStatusInput } from '../src/lib/system-status'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const healthy: OwnerStatusInput = {
  database: 'ok',
  bookings: 'ok',
  notifications: 'ok',
  backup: 'ok',
  backupAgeHours: 6,
  photos: 'ok',
}

const FORBIDDEN = [
  'redis', 'upstash', 'postgres', 'database', 'database url', 'server', 'stack', 'trace',
  'econnrefused', 'http', 'api', 'token', 'env var', 'bucket', 's3', 'cron', 'sql',
  'timeout', '500', '503', 'null', 'undefined',
]

function assertPlain(summary: ReturnType<typeof buildOwnerStatus>, title: string) {
  const text = describeOwnerStatus(summary).toLowerCase()
  for (const word of FORBIDDEN) {
    if (text.includes(word)) {
      assert(false, `${title}: must not say "${word}" (found in: ${text.slice(0, 120)})`)
      return
    }
  }
  assert(true, `${title}: no technical vocabulary anywhere in the copy`)
}

function row(summary: ReturnType<typeof buildOwnerStatus>, label: string) {
  return summary.rows.find((entry) => entry.label === label)
}

async function main() {
  console.log('--- everything working ---')
  const happy = buildOwnerStatus(healthy)
  assert(happy.headline === 'Everything is working', 'a healthy shop says so plainly')
  assert(!happy.needsAttention, 'nothing needs the owner')
  assert(happy.rows.every((entry) => entry.tone === 'good'), 'every row is a good state')
  assertPlain(happy, 'healthy copy')
  assert(row(happy, 'Backups')!.detail.includes('completed and checked'), 'the backup row says it was checked, not just taken')

  console.log('--- the shop is unreachable ---')
  const down = buildOwnerStatus({ ...healthy, database: 'unavailable', bookings: 'unavailable' })
  assert(down.headline === 'Some things need attention', 'the headline escalates')
  assert(row(down, 'Your website')!.tone === 'action', 'the website row needs the owner')
  assert(row(down, 'Your appointments and customer details')!.detail.includes('safe'), 'the data-safety answer is present during an outage')
  assert(/temporarily unavailable/.test(row(down, 'Your website')!.detail), 'what happened is explained in plain words')
  assert(!/deleted|corrupt|permanently/.test(describeOwnerStatus(down)), 'the copy never suggests loss without evidence')
  assert(/Nothing has been lost/.test(describeOwnerStatus(down)), 'the copy reassures explicitly instead of leaving the question open')
  assertPlain(down, 'outage copy')

  console.log('--- a temporary booking pause is not an emergency ---')
  const paused = buildOwnerStatus({ ...healthy, bookings: 'degraded' })
  assert(paused.headline === 'Your shop is working, with one temporary issue', 'a partial issue is described as partial')
  assert(!paused.needsAttention, 'the owner is not asked to act')
  assert(row(paused, 'Online booking')!.tone === 'watch', 'booking is a watch item')
  assert(row(paused, 'Online booking')!.detail.includes('safe'), 'the pause explains that existing data is safe')
  assert(row(paused, 'Text and email reminders')!.tone === 'good', 'unaffected features are still reported as working')
  assertPlain(paused, 'paused-booking copy')

  console.log('--- optional features switched off are not faults ---')
  const minimal = buildOwnerStatus({ ...healthy, notifications: 'not_configured', photos: 'not_configured', backup: 'not_configured' })
  assert(row(minimal, 'Text and email reminders')!.tone === 'off', 'reminders are shown as turned off')
  assert(row(minimal, 'Shop photos')!.tone === 'off', 'photo uploads are shown as not set up')
  assert(row(minimal, 'Backups')!.tone === 'off', 'missing automatic backups are shown as off, with what to do')
  assert(/Everything else works normally|operating normally/.test(describeOwnerStatus(minimal)), 'the copy reassures that the shop is unaffected')
  assertPlain(minimal, 'minimal-config copy')

  console.log('--- a stale backup asks a human, without alarming customers ---')
  const stale = buildOwnerStatus({ ...healthy, backup: 'degraded', backupAgeHours: 96 })
  assert(stale.needsAttention, 'a stale backup is an action item')
  assert(row(stale, 'Backups')!.detail.includes('administrator has been notified'), 'the owner is told someone is on it')
  assert(row(stale, 'Backups')!.detail.includes('4 days'), 'the age is expressed in days')
  assert(row(stale, 'Online booking')!.tone === 'good', 'a backup problem does not claim booking is broken')

  console.log('--- reminder delivery failure does not take the shop down ---')
  const reminders = buildOwnerStatus({ ...healthy, notifications: 'degraded' })
  assert(row(reminders, 'Text and email reminders')!.tone === 'watch', 'the failure is a watch item')
  assert(!reminders.needsAttention, 'the owner is not asked to fix it')
  assert(/no appointment was affected/.test(row(reminders, 'Text and email reminders')!.detail), 'the copy states the blast radius honestly')

  console.log('--- unknown is never reported as healthy ---')
  const unknown = buildOwnerStatus({ ...healthy, bookings: 'unknown', backup: 'unknown' })
  assert(row(unknown, 'Online booking')!.tone === 'watch', 'an unchecked booking system is a watch item, never "good"')
  assert(row(unknown, 'Backups')!.tone === 'watch', 'an unrecorded backup is a watch item, never "good"')
  assert(/could not be checked|has not been recorded/.test(describeOwnerStatus(unknown)), 'the copy says it could not be checked')
  assertPlain(unknown, 'unknown-state copy')

  console.log(`\nOwner system status tests: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => { console.error(error); process.exit(1) })

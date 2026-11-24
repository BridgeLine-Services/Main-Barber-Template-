/**
 * The owner-facing reliability answers (Priority 3).
 *
 * Two rules are tested here, and they are the two that matter:
 *   1. an unknown result is never presented as healthy, and
 *   2. every warning says what to do next.
 *
 * The page itself is checked statically for the properties a unit test can hold: owner-only
 * access, no write of any kind, no one-click destructive control, and layout classes that
 * still work on a phone.
 *
 * Run: npx tsx tests/reliability-dashboard.test.ts  (no server or database needed)
 */

import { readFileSync } from 'node:fs'
import {
  approvalsAnswer,
  backupAnswer,
  overallAnswer,
  recoveryAnswer,
  toneBadge,
} from '../src/lib/platform-reliability/owner-recovery'
import { evaluateRecovery, RESTORE_MAX_AGE_DAYS, type BackupEvidence, type RestoreEvidence } from '../src/lib/platform-reliability/recovery-verification'

let passed = 0
let failed = 0
function ok(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const now = new Date('2026-11-22T12:00:00Z')
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString()

const goodBackup: BackupEvidence = { id: 'b1', createdAt: hoursAgo(2), sizeBytes: 1024, checksumVerifiedAt: hoursAgo(2) }
const goodRestore: RestoreEvidence = {
  id: 'r1',
  backupId: 'b1',
  startedAt: hoursAgo(3),
  completedAt: hoursAgo(2),
  tablesRestored: ['Appointment', 'Customer'],
  rowsCompared: 900,
  rowCountsMatched: true,
  errors: [],
}

const page = readFileSync('src/app/(dashboard)/dashboard/reliability/page.tsx', 'utf8')

console.log('--- owner status vocabulary ---')
ok(toneBadge('fine') === 'HEALTHY', 'a verified check uses the shared healthy status')
ok(toneBadge('attention') === 'ATTENTION NEEDED', 'a review item uses the shared attention status')
ok(toneBadge('action') === 'APPROVAL REQUIRED', 'a pending decision uses the approval status')
ok(toneBadge('unknown') === 'COULD NOT VERIFY', 'an incomplete check uses the shared unverifiable status')

console.log('--- unknown is never healthy ---')
const unreadableRecovery = recoveryAnswer(null)
ok(unreadableRecovery.tone === 'unknown', 'an unreadable recovery record is unknown')
ok(unreadableRecovery.tone !== 'fine', 'and never fine')
ok(unreadableRecovery.badge !== toneBadge('fine'), 'the badge does not say working normally')
ok(unreadableRecovery.next !== null, 'it still says what to do')

const unreadableApprovals = approvalsAnswer(null)
ok(unreadableApprovals.tone === 'unknown', 'an unreadable approval count is unknown')
ok(unreadableApprovals.headline.includes('could not read'), 'and says so plainly')

const unreadableBackup = backupAnswer(null)
ok(unreadableBackup.tone === 'unknown', 'an unreadable backup age is unknown')

const noDrill = evaluateRecovery([goodBackup], [], now)
ok(noDrill.state === 'unverified', 'a backup with no drill is unverified, not verified')
const noDrillAnswer = recoveryAnswer(noDrill)
ok(noDrillAnswer.tone === 'unknown', 'a backup alone is not presented as healthy')
ok(noDrillAnswer.detail.includes('does not prove'), 'and explains why a backup is not proof')

const unreadableReport = evaluateRecovery(null, null, now)
ok(unreadableReport.state === 'unverified', 'a failed read is unverified')
ok(recoveryAnswer(unreadableReport).tone === 'unknown', 'a failed read is unknown on the page')

console.log('--- a verified restore ---')
const verified = evaluateRecovery([goodBackup], [goodRestore], now)
ok(verified.state === 'verified', 'a recent successful drill is verified')
const verifiedAnswer = recoveryAnswer(verified)
ok(verifiedAnswer.tone === 'fine', 'and only then reads as working normally')
ok(verifiedAnswer.next === null, 'a passing state asks nothing of the owner')

console.log('--- a failed restore ---')
const failedDrill: RestoreEvidence = { ...goodRestore, errors: ['row-count mismatch on "Appointment"'], rowCountsMatched: false }
const failedReport = evaluateRecovery([goodBackup], [failedDrill], now)
ok(failedReport.state === 'failed', 'a failed drill is failed')
const failedAnswer = recoveryAnswer(failedReport)
ok(failedAnswer.tone === 'action', 'a failed drill is action required, not attention')
ok(failedAnswer.headline.includes('did not succeed'), 'the headline says the restore failed')
ok(failedAnswer.next !== null, 'and says what to do')
ok(failedAnswer.tone !== 'fine', 'never fine')

console.log('--- a stale restore ---')
const staleDrill: RestoreEvidence = { ...goodRestore, completedAt: hoursAgo(24 * (RESTORE_MAX_AGE_DAYS + 5)) }
const staleReport = evaluateRecovery([goodBackup], [staleDrill], now)
ok(staleReport.state === 'stale', 'an old drill is stale')
const staleAnswer = recoveryAnswer(staleReport)
ok(staleAnswer.tone === 'attention', 'a stale drill needs attention')
ok(staleAnswer.headline.includes(String(RESTORE_MAX_AGE_DAYS)), 'the headline names the age limit')
ok(staleAnswer.detail.includes('may still be available'), 'it explains the backups may still be fine')
ok(staleAnswer.next?.includes('restore test'), 'and asks for a fresh test')

console.log('--- approvals ---')
ok(approvalsAnswer(0).tone === 'fine', 'nothing pending is fine')
ok(approvalsAnswer(1).headline.includes('1 change'), 'one pending reads in the singular')
ok(approvalsAnswer(3).headline.includes('3 changes'), 'several pending reads in the plural')
ok(approvalsAnswer(2).tone === 'action', 'pending approvals are action required')
ok(approvalsAnswer(2).detail.includes('keeps working'), 'the owner is told nothing has changed yet')

console.log('--- backup age ---')
ok(backupAnswer(1).tone === 'fine', 'an hourly backup is fine')
ok(backupAnswer(50).tone === 'attention', 'a two-day-old backup needs attention')
ok(backupAnswer(24 * 9).tone === 'action', 'a nine-day-old backup is action required')
ok(backupAnswer(24 * 9).headline.includes('9 days'), 'and says how old it is')

console.log('--- the whole-page answer is the worst part ---')
ok(overallAnswer([backupAnswer(1), recoveryAnswer(verified), approvalsAnswer(0)]).tone === 'fine', 'all clear reads fine')
ok(overallAnswer([backupAnswer(1), recoveryAnswer(failedReport), approvalsAnswer(0)]).tone === 'action', 'one failure makes the whole line action required')
ok(overallAnswer([backupAnswer(1), recoveryAnswer(null), approvalsAnswer(0)]).tone === 'unknown', 'one unknown makes the whole line unknown')
ok(overallAnswer([backupAnswer(50), recoveryAnswer(verified), approvalsAnswer(0)]).tone === 'attention', 'one attention outranks fine')
ok(overallAnswer([]).tone === 'fine', 'no answers at all is the only vacuous fine, and the page always passes three')

console.log('--- every warning says what to do ---')
for (const answer of [
  recoveryAnswer(null), recoveryAnswer(staleReport), recoveryAnswer(failedReport), recoveryAnswer(noDrill),
  approvalsAnswer(null), approvalsAnswer(2), backupAnswer(null), backupAnswer(50), backupAnswer(24 * 9),
]) {
  if (answer.tone !== 'fine') ok(answer.next !== null && answer.next.length > 10, `"${answer.headline.slice(0, 40)}" explains the next step`)
}

console.log('--- the page: access, safety, layout ---')
ok(page.includes('requireOwner()'), 'the page still requires an owner')
ok(page.includes("redirect('/login')"), 'and still sends everyone else to the login page')
ok(!/prisma\.(maintenanceAction|backupRun|restoreDrill)\.(create|update|delete|upsert)/.test(page), 'the page never writes a maintenance, backup or drill record')
ok(!/prisma\.\$executeRaw|prisma\.\$queryRaw/.test(page), 'the page runs no raw SQL')
ok(!/<form|<button/.test(page), 'the page has no form or button that could apply a change')
ok(!/api\/cron\/maintenance-report/.test(page), 'the page does not call the report endpoint')
ok(page.includes('This page only looks'), 'the page still says it only looks')
ok(page.includes('sm:grid-cols-2') && page.includes('sm:grid-cols-3'), 'the layout stacks on a phone and spreads on a tablet')
ok(!/\bw-\[[4-9]\d\dpx\]/.test(page), 'no fixed pixel width that would overflow a phone')
ok(page.includes('aria-labelledby'), 'sections are labelled for a screen reader')

console.log('--- destructive actions are not one-click ---')
const repairPolicy = readFileSync('src/lib/platform-reliability/repair-policy.ts', 'utf8')
ok(/approval/i.test(repairPolicy), 'the repair policy still classifies approvals')
ok(!/autoApply|autoRun/i.test(page), 'the page offers no automatic application of anything')

console.log(`\nReliability dashboard: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)

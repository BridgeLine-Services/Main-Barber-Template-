/**
 * Priority 1: the reliability program's new parts, pinned.
 *
 * These tests exist because each module makes a promise to an owner that is easy to break
 * later: a section that did not run is never green, a patched version is never invented,
 * a prepared update is never auto-merged, a specialist repair never runs, and a backup
 * that has not been restored never counts as recovery.
 */

import {
  buildAdvisory,
  businessImpactFor,
  dependencyRole,
  normaliseSeverity,
  summariseAdvisories,
} from '../src/lib/platform-reliability/advisory-monitor'
import { checkComponent, checkCombinations, compatibilityReport, COMPATIBILITY_RULES, majorOf } from '../src/lib/platform-reliability/compatibility'
import { buildUpdatePlan, classifyUpdate } from '../src/lib/platform-reliability/update-plan'
import { classifyRepair, repairGate, AUTOMATIC_OPERATIONS, APPROVAL_OPERATIONS } from '../src/lib/platform-reliability/repair-policy'
import { buildScheduledReport, renderReportMarkdown } from '../src/lib/platform-reliability/scheduled-report'
import { BACKUP_IS_NOT_PROOF, evaluateRecovery, isRestoreSuccessful, RESTORE_MAX_AGE_DAYS } from '../src/lib/platform-reliability/recovery-verification'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; return }
  failed++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const NOW = new Date('2026-11-20T12:00:00.000Z')
const CHECKED = '2026-11-20'

// ─── C. Security advisories ────────────────────────────────────────────────

ok('severity maps "medium" to moderate', normaliseSeverity('medium') === 'moderate')
ok('an unreadable severity is unknown, not low', normaliseSeverity(undefined) === 'unknown')
ok('an invented severity is unknown', normaliseSeverity('catastrophic') === 'unknown')
ok('stripe is a payments dependency', dependencyRole('stripe') === 'payments')
ok('next-auth is a sign-in dependency', dependencyRole('next-auth') === 'signin')
ok('prisma is a database dependency', dependencyRole('@prisma/client') === 'database')
ok('an unknown package is "other"', dependencyRole('left-pad') === 'other')
ok('critical impact says urgent', /urgent/i.test(businessImpactFor('critical', 'stripe')))

const criticalAdvisory = buildAdvisory(
  { module_name: 'stripe', severity: 'critical', range: '<12.0.0', installedVersion: '11.4.0', fixAvailable: { name: 'stripe', version: '12.1.0' }, title: 'Prototype pollution', url: 'https://example.test/advisory/1' },
  CHECKED,
)
ok('the dependency is named', criticalAdvisory.dependency === 'stripe')
ok('the installed version is carried', criticalAdvisory.installedVersion === '11.4.0')
ok('the vulnerable range is carried', criticalAdvisory.vulnerableRange === '<12.0.0')
ok('the patched version is carried', criticalAdvisory.patchedVersion === '12.1.0')
ok('a critical payments advisory needs action today', criticalAdvisory.immediateAction)
ok('the source is recorded', criticalAdvisory.source.includes('example.test'))
ok('a complete record is verified', criticalAdvisory.verified)

const noFix = buildAdvisory({ module_name: 'some-lib', severity: 'high', range: '<2', fixAvailable: false }, CHECKED)
ok('no fix means no invented patched version', noFix.patchedVersion === null)
ok('the remediation says no fix is published', /no fixed version/i.test(noFix.remediation))
ok('a high advisory on an unrelated package is not an emergency', noFix.immediateAction === false)

const incomplete = buildAdvisory({ severity: 'high' }, CHECKED)
ok('a record with no package is unverified', incomplete.verified === false)
ok('an unverified record does not claim a fix', incomplete.patchedVersion === null)

const noAdvisories = summariseAdvisories([])
ok('an empty checked list is clear', noAdvisories.state === 'clear')
const unknownAdvisories = summariseAdvisories(null)
ok('a failed check is unable-to-verify', unknownAdvisories.state === 'unable-to-verify')
ok('a failed check never says clear', !/clear|safe/i.test(unknownAdvisories.headline))
ok('an urgent advisory makes the summary action-required', summariseAdvisories([criticalAdvisory]).state === 'action-required')

// ─── D. Compatibility ──────────────────────────────────────────────────────

ok('majorOf reads a caret range', majorOf('^16.4.6') === 16)
ok('majorOf reads a gte range', majorOf('>=24.1.0') === 24)
ok('majorOf reads a bare version', majorOf('24') === 24)
ok('majorOf refuses nonsense', majorOf('latest') === null)

const nodeRule = COMPATIBILITY_RULES.find((r) => r.component === 'node')!
ok('the tested Node version is supported', checkComponent(nodeRule, '24.22.1').status === 'supported')
ok('Node 18 is unsupported', checkComponent(nodeRule, '18.20.0').status === 'unsupported')
ok('an unreadable version is unknown, not supported', checkComponent(nodeRule, null).status === 'unknown')
ok('an unsupported component names the tested line', /24/.test(checkComponent(nodeRule, '18.20.0').detail))

const combos = checkCombinations({ next: '16.4.6', react: '18.2.0', node: '24.22.1', prisma: '6.19.3' })
ok('Next 16 with React 18 is flagged', combos.some((c) => c.id === 'next-needs-react-19' && c.broken))
const goodCombos = checkCombinations({ next: '16.4.6', react: '19.3.0', node: '24.22.1', prisma: '6.19.3' })
ok('the tested combination is clean', goodCombos.every((c) => !c.broken))

const goodReport = compatibilityReport({ node: '24.22.1', next: '16.4.6', react: '19.3.0', prisma: '6.19.3', postgres: '15.20', pg: '8.11.0' })
ok('a fully supported set reports supported', goodReport.state === 'supported')
const unknownReport = compatibilityReport({ node: null, next: '16.4.6', react: '19.3.0', prisma: '6.19.3', postgres: '15.20', pg: '8.11.0' })
ok('a missing version makes the report unknown', unknownReport.state === 'unknown')
ok('an unknown report never says supported', !/every component is inside/i.test(unknownReport.headline))

// ─── B. Dependency update automation ───────────────────────────────────────

const patch = classifyUpdate({ name: 'zod', installed: '3.23.1', latest: '3.23.8' })!
ok('a same-major bump is minor or patch', patch.kind === 'patch' || patch.kind === 'minor')
ok('a patch is not breaking', patch.breaking === false)
const majorUp = classifyUpdate({ name: 'next', installed: '15.0.0', latest: '16.4.6' })!
ok('a major bump is breaking', majorUp.breaking === true)
ok('a major bump runs the build', majorUp.tests.includes('npm run build'))
const secUp = classifyUpdate({ name: 'stripe', installed: '11.4.0', latest: '12.1.0', hasAdvisory: true })!
ok('an advisory makes it a security update', secUp.kind === 'security')

const plan = buildUpdatePlan(
  [
    { name: 'zod', installed: '3.23.1', latest: '3.23.8' },
    { name: 'next', installed: '15.0.0', latest: '16.4.6' },
    { name: 'stripe', installed: '11.4.0', latest: '12.1.0', hasAdvisory: true },
    { name: 'mystery', installed: null, latest: '1.0.0' },
  ],
  '2026-11-20T12:00:00.000Z',
)
ok('a prepared plan always requires approval', plan.requiresApproval === true)
ok('a prepared plan never auto-merges', plan.autoMerge === false)
ok('a prepared plan never auto-deploys', plan.autoDeploy === false)
ok('breaking updates are deferred', plan.deferred.some((d) => d.name === 'next'))
ok('security updates are deferred', plan.deferred.some((d) => d.name === 'stripe'))
ok('routine updates stay in the batch', plan.batch.some((b) => b.name === 'zod'))
ok('an unreadable dependency is listed, not dropped', plan.unclassified.includes('mystery'))
ok('the plan states a rollback', /revert/i.test(plan.rollback))
ok('the pull request body says it is not merged', /not been merged/i.test(plan.prBody))
ok('the risk is high when a major change is present', plan.risk === 'high')
ok('the plan names the tests to run', plan.testsToRun.includes('npm run typecheck'))

// ─── E. Repair automation ──────────────────────────────────────────────────

ok('the automatic list contains only checks', Array.from(AUTOMATIC_OPERATIONS).every((k) => /check|report|detection|verification-read|validation/.test(k)))
ok('a migration is on the approval list', APPROVAL_OPERATIONS.has('database-migration'))

const depCheck = classifyRepair({ key: 'dependency-check', component: 'node', description: 'Check for newer versions.' })
ok('a read-only check is category A', depCheck.category === 'automatic')
ok('a read-only check may run alone', depCheck.mayRunAutomatically === true)
ok('a read-only check says nothing changes', /nothing is changed/i.test(depCheck.explanation.whatChanges))

const migration = classifyRepair({ key: 'database-migration', component: 'postgres', description: 'Add a nullable column.', changesSchema: true })
ok('a migration is category B', migration.category === 'approval')
ok('a migration needs two approvers', migration.requiresSecondApprover === true)
ok('a migration needs a backup', migration.requiresBackup === true)
ok('a migration may not run alone', migration.mayRunAutomatically === false)

const breach = classifyRepair({ key: 'dependency-upgrade', component: 'auth', description: 'Rotate credentials after a suspected leak.', involvesSecurityIncident: true })
ok('a suspected breach is category C', breach.category === 'specialist')
ok('a suspected breach stops automation', breach.stopAutomation === true)
ok('a suspected breach preserves evidence', breach.preserveEvidence === true)
ok('a suspected breach tells the owner to contact a specialist', /specialist/i.test(breach.explanation.ifSomethingGoesWrong))

const failedRestore = classifyRepair({ key: 'database-migration', component: 'postgres', description: 'Retry a restore.', involvesFailedRestore: true })
ok('a failed restore escalates to a specialist', failedRestore.category === 'specialist')
const paymentMismatch = classifyRepair({ key: 'dependency-check', component: 'stripe', description: 'Reconcile payments.', involvesPaymentReconciliation: true })
ok('a payment mismatch escalates even on an automatic key', paymentMismatch.category === 'specialist')
const isolation = classifyRepair({ key: 'health-check', component: 'tenant', description: 'Check tenancy.', involvesTenantIsolation: true })
ok('a tenancy concern escalates to a specialist', isolation.category === 'specialist')

ok('the gate blocks an unapproved category B repair', repairGate(migration, false).mayRun === false)
ok('the gate allows an approved category B repair', repairGate(migration, true).mayRun === true)
ok('the gate never allows category C', repairGate(breach, true).mayRun === false)
ok('the gate allows category A', repairGate(depCheck, false).mayRun === true)

const explanation = migration.explanation
ok('every verdict says what it does', explanation.whatItDoes.length > 0)
ok('every verdict says what changes', explanation.whatChanges.length > 0)
ok('every verdict says who may approve', explanation.whoMayApprove.length > 0)
ok('every verdict says whether it can be undone', explanation.canBeUndone.length > 0)
ok('every verdict says what happens if it goes wrong', explanation.ifSomethingGoesWrong.length > 0)

// ─── G. Recovery verification ──────────────────────────────────────────────

ok('the backup-is-not-proof sentence exists', /does not mean it can be restored/i.test(BACKUP_IS_NOT_PROOF))
const created = [{ id: 'b1', createdAt: '2026-11-19T03:00:00.000Z' }]
const neverRestored = evaluateRecovery(created, [], NOW)
ok('a created backup with no restore is unverified', neverRestored.state === 'unverified')
ok('a created backup never reads as verified', neverRestored.state !== 'verified')
ok('the unverified report explains the difference', /not proof/i.test(neverRestored.detail))

const goodRestore = [{ id: 'r1', backupId: 'b1', startedAt: '2026-11-18T02:00:00.000Z', completedAt: '2026-11-18T02:20:00.000Z', tablesRestored: ['Appointment', 'Customer'], rowsCompared: 500, rowCountsMatched: true, errors: [] }]
const verified = evaluateRecovery(created, goodRestore, NOW)
ok('a recent matching restore is verified', verified.state === 'verified')
ok('a verified restore has no action', verified.action === null)

const badRestore = [{ id: 'r2', backupId: 'b1', startedAt: '2026-11-19T02:00:00.000Z', completedAt: '2026-11-19T02:05:00.000Z', tablesRestored: ['Appointment'], rowsCompared: 500, rowCountsMatched: false, errors: ['checksum mismatch'] }]
ok('a failed restore is not successful', isRestoreSuccessful(badRestore[0]) === false)
ok('a failed restore is reported as failed', evaluateRecovery(created, badRestore, NOW).state === 'failed')

const oldRestore = [{ id: 'r3', backupId: 'b1', startedAt: '2026-09-01T02:00:00.000Z', completedAt: '2026-09-01T02:20:00.000Z', tablesRestored: ['Appointment'], rowsCompared: 400, rowCountsMatched: true, errors: [] }]
const stale = evaluateRecovery(created, oldRestore, NOW)
ok(`a restore older than ${RESTORE_MAX_AGE_DAYS} days is stale`, stale.state === 'stale')
ok('a stale restore is not verified', stale.state !== 'verified')

const partial = [{ id: 'r4', backupId: 'b1', startedAt: '2026-11-19T02:00:00.000Z', completedAt: null, tablesRestored: ['Appointment'], rowsCompared: null, rowCountsMatched: null, errors: [] }]
ok('a restore that never finished is not successful', isRestoreSuccessful(partial[0]) === false)
ok('a null record set is unverified', evaluateRecovery(null, null, NOW).state === 'unverified')

// ─── A. Scheduled maintenance report ───────────────────────────────────────

const allUnknown = buildScheduledReport({
  generatedAt: NOW.toISOString(),
  templateVersion: '1.2.0',
  health: null,
  advisories: null,
  compatibility: null,
  updates: null,
  recovery: null,
  pendingApprovals: null,
  failedRepairs: null,
})
ok('a report with no inputs is unable-to-verify', allUnknown.overall === 'unable-to-verify')
ok('a report with no inputs lists what it could not confirm', allUnknown.unverified.length === 6)
ok('a report with no inputs never says healthy', !/good order/i.test(allUnknown.headline))

const healthy = buildScheduledReport({
  generatedAt: NOW.toISOString(),
  templateVersion: '1.2.0',
  health: { state: 'healthy', headline: 'Running.', detail: 'All checks clear.', failedChecks: [] },
  advisories: summariseAdvisories([]),
  compatibility: goodReport,
  updates: buildUpdatePlan([], NOW.toISOString()),
  recovery: verified,
  pendingApprovals: 0,
  failedRepairs: 0,
})
ok('a fully checked, clean report is healthy', healthy.overall === 'healthy')
ok('a healthy report has nothing unverified', healthy.unverified.length === 0)
ok('a healthy report needs no action', healthy.actionsRequired.length === 0)

const oneGap = buildScheduledReport({
  generatedAt: NOW.toISOString(),
  templateVersion: '1.2.0',
  health: { state: 'healthy', headline: 'Running.', detail: 'All checks clear.', failedChecks: [] },
  advisories: null,
  compatibility: goodReport,
  updates: buildUpdatePlan([], NOW.toISOString()),
  recovery: verified,
  pendingApprovals: 0,
  failedRepairs: 0,
})
ok('one unverified section stops the report being healthy', oneGap.overall !== 'healthy')
ok('the gap is named', oneGap.unverified.includes('Security'))

const urgent = buildScheduledReport({
  generatedAt: NOW.toISOString(),
  templateVersion: '1.2.0',
  health: { state: 'healthy', headline: 'Running.', detail: 'All checks clear.', failedChecks: [] },
  advisories: summariseAdvisories([criticalAdvisory]),
  compatibility: goodReport,
  updates: buildUpdatePlan([], NOW.toISOString()),
  recovery: verified,
  pendingApprovals: 0,
  failedRepairs: 0,
})
ok('an urgent advisory makes the report action-required', urgent.overall === 'action-required')

const markdown = renderReportMarkdown(oneGap)
ok('the markdown names every section', oneGap.sections.every((s) => markdown.includes(s.title)))
ok('the markdown records an unverified section as unverified', /not verified/.test(markdown))
ok('the markdown lists what could not be confirmed', /Could not be confirmed/.test(markdown))

console.log(`\nReliability program: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

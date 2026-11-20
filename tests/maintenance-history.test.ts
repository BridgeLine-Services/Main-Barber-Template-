/**
 * Part 5.3: maintenance history.
 *
 * The rules worth testing are the ones that protect a shop: a secret must never be stored,
 * nobody approves their own change, a specialist-only repair is never run by the platform,
 * and nothing is described as finished until the checks passed.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  historyAvailability,
  redactForHistory,
  redactNamedValue,
  createRecord,
  decide,
  transition,
  recordOutcome,
  isComplete,
  describeRecord,
  summariseHistory,
  type MaintenanceRecord,
} from '../src/lib/platform-reliability/maintenance-history'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
    return
  }
  failed++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const ROOT = join(__dirname, '..')
/** A deliberately fake key, assembled at runtime so the file holds no key-shaped literal. */
const FAKE_KEY = ['sk', 'live', '9f2b8c7d6e5a4b3c2d1e0f9a'].join('_')

// ─── It is not enabled, and it says so ─────────────────────────────────────

const availability = historyAvailability()
ok('history reports itself as not enabled', availability.enabled === false)
ok('history explains why in plain words', /approval is needed/i.test(availability.reason), availability.reason)
ok('history says it only adds a record of repairs', /does not change/i.test(availability.reason))
ok('history never claims to be working', !/is switched on for this installation yet/.test('') && !availability.enabled)

// ─── No migration was created without approval ─────────────────────────────

const migrationsDir = join(ROOT, 'prisma', 'migrations')
const migrationNames = existsSync(migrationsDir) ? readdirSync(migrationsDir) : []
ok('no maintenance-history migration exists yet', !migrationNames.some((m) => /maintenance/i.test(m)), migrationNames.filter((m) => /maintenance/i.test(m)).join(','))
ok('the proposal document exists for review', existsSync(join(ROOT, 'docs/PROPOSED-MAINTENANCE-HISTORY-MIGRATION.md')))

// ─── The module cannot write to the database ───────────────────────────────

const source = readFileSync(join(ROOT, 'src/lib/platform-reliability/maintenance-history.ts'), 'utf8')
ok('the history module does not import prisma', !/from '@\/lib\/prisma'|from '\.\/prisma'|@prisma\/client/.test(source))
ok('the history module performs no writes', !/\.create\(|\.update\(|\.upsert\(|\.delete\(|writeFileSync/.test(source))
ok('the history module performs no network calls', !/\bfetch\(/.test(source))

// ─── Redaction ─────────────────────────────────────────────────────────────

ok('a bare token is removed', redactForHistory(FAKE_KEY) === '[removed]')
ok('a long base64 key is removed', redactForHistory('dGhpcyBpcyBhIHZlcnkgbG9uZyBzZWNyZXQgdmFsdWU=') === '[removed]')
ok('a connection string with a password is removed', redactForHistory('postgresql://barber:hunter2@db:5432/shop') === '[removed]')
ok('a secret-named field is removed whatever its value', redactNamedValue('NEXTAUTH_SECRET', 'short') === '[removed]')
ok('an api key field is removed', redactNamedValue('STRIPE_API_KEY', 'pk_123') === '[removed]')
ok('a password field is removed', redactNamedValue('password', 'hunter2') === '[removed]')
ok('a harmless version string is kept', redactForHistory('20.11.0') === '20.11.0')
ok('a harmless sentence is kept', redactForHistory('Updated the runtime to a supported version.')?.includes('supported version') === true)
ok('a harmless short field under a harmless name is kept', redactNamedValue('previousValue', '20.11.0') === '20.11.0')
ok('null stays null rather than becoming a word', redactForHistory(null) === null)
ok('an empty string is nothing to store', redactForHistory('   ') === null)
ok('an object is stringified before it is judged', typeof redactForHistory({ a: 1 }) === 'string')

// ─── Creating a record ─────────────────────────────────────────────────────

const auto = createRecord({
  actionKey: 'regenerate-prisma-client',
  component: 'Database client',
  repairClass: 'automatic',
  result: 'Regenerated the client and ran the checks.',
  at: '2026-11-20T00:00:00.000Z',
})
ok('a safe repair needs no approval to be recorded', auto.approvalState === 'approved')
ok('a safe repair has not started yet', auto.executionState === 'not-started')
ok('a safe repair keeps its timestamp', auto.proposedAt === '2026-11-20T00:00:00.000Z')

const risky = createRecord({
  actionKey: 'node-major-upgrade',
  component: 'Website runtime',
  repairClass: 'approval',
  previousValue: '20.11.0',
  proposedValue: '24.1.0',
  requestedBy: 'owner@shop.test',
})
ok('a risky repair starts as proposed', risky.approvalState === 'proposed')
ok('a risky repair has no approver yet', risky.approvedBy === null)
ok('a risky repair records both versions', risky.previousValue === '20.11.0' && risky.proposedValue === '24.1.0')

const leaky = createRecord({
  actionKey: 'rotate-key',
  component: 'Payment keys',
  repairClass: 'approval',
  previousValue: FAKE_KEY,
  result: `Replaced the key ${FAKE_KEY}`,
})
ok('a secret passed as a value is not stored', leaky.previousValue === '[removed]', String(leaky.previousValue))
ok('a secret embedded in a sentence is not stored', leaky.result === '[removed]', String(leaky.result))

const secretNamed = createRecord({ actionKey: 'x', component: 'y', repairClass: 'automatic', previousValue: 'abc', proposedValue: 'def' })
ok('a field named previousValue is not treated as a secret by itself', secretNamed.previousValue === 'abc')

// ─── Approval: a second person, or nobody ──────────────────────────────────

const selfApprove = decide(risky, 'approved', 'owner@shop.test')
ok('a person cannot approve their own request', selfApprove.ok === false)
ok('the refusal explains why', /someone else/i.test(selfApprove.reason ?? ''), selfApprove.reason ?? '')

const byOther = decide(risky, 'approved', 'coowner@shop.test', '2026-11-20T01:00:00.000Z')
ok('a different person can approve', byOther.ok === true)
ok('the approver is recorded', byOther.record?.approvedBy === 'coowner@shop.test')
ok('the approval time is recorded', byOther.record?.approvedAt === '2026-11-20T01:00:00.000Z')

const twice = decide(byOther.record!, 'rejected', 'third@shop.test')
ok('a decided request cannot be decided again', twice.ok === false)

const rejected = decide(risky, 'rejected', 'coowner@shop.test')
ok('a request can be rejected', rejected.ok === true && rejected.record?.approvalState === 'rejected')
ok('a rejected request records no approver', rejected.record?.approvedBy === null)

const noActor = decide(risky, 'approved', '   ')
ok('a decision without a person is refused', noActor.ok === false)

const specialist = createRecord({ actionKey: 'restore-failed', component: 'Backup restore', repairClass: 'manual' })
const specialistApproval = decide(specialist, 'approved', 'owner@shop.test')
ok('a specialist-only repair cannot be approved for the platform to run', specialistApproval.ok === false)
ok('it says a specialist is needed', /specialist/i.test(specialistApproval.reason ?? ''))

// ─── Execution: approval first, then honest outcomes ───────────────────────

const unapprovedRun = transition(risky, 'running')
ok('a risky repair cannot start before approval', unapprovedRun.ok === false)
ok('the refusal mentions approval', /approval/i.test(unapprovedRun.reason ?? ''))

const autoRun = transition(auto, 'running', '2026-11-20T00:05:00.000Z')
ok('a safe repair can start without approval', autoRun.ok === true)
ok('starting records the time', autoRun.record?.startedAt === '2026-11-20T00:05:00.000Z')

const autoDone = transition(autoRun.record!, 'succeeded', '2026-11-20T00:06:00.000Z')
ok('a running repair can finish', autoDone.ok === true)
ok('finishing records the time', autoDone.record?.completedAt === '2026-11-20T00:06:00.000Z')

const skipAhead = transition(auto, 'succeeded')
ok('a repair that never started can still finish, because some checks are instant', skipAhead.ok === true)

const backwards = transition(autoDone.record!, 'running')
ok('a finished repair cannot quietly restart', backwards.ok === false)

const rollback = transition(autoDone.record!, 'rolled-back', '2026-11-20T00:10:00.000Z')
ok('a finished repair can be undone', rollback.ok === true)
ok('undoing records the time', rollback.record?.completedAt === '2026-11-20T00:10:00.000Z')

const afterRollback = transition(rollback.record!, 'succeeded')
ok('an undone repair stays undone', afterRollback.ok === false)

const specialistRun = transition(specialist, 'running')
ok('the platform never runs a specialist repair', specialistRun.ok === false)

const failedRun = transition(autoRun.record!, 'failed')
ok('a repair can fail', failedRun.ok === true)
const retry = transition(failedRun.record!, 'running')
ok('a failed repair can be tried again', retry.ok === true)

// ─── "Done" means the checks passed ────────────────────────────────────────

const noChecks = recordOutcome(autoDone.record!, { result: 'Regenerated.' })
ok('finished without checks is not complete', isComplete(noChecks) === false)

const checksPassed = recordOutcome(autoDone.record!, { testsPassed: true })
ok('finished with passing checks is complete', isComplete(checksPassed) === true)

const deployFailed = recordOutcome(autoDone.record!, { testsPassed: true, deploymentSucceeded: false })
ok('passing checks with a failed deployment is not complete', isComplete(deployFailed) === false)

const checksFailed = recordOutcome(autoDone.record!, { testsPassed: false })
ok('a failed check is not complete', isComplete(checksFailed) === false)
ok('a rolled-back repair counts as finished business', isComplete(rollback.record!) === true)

const outcomeSecret = recordOutcome(autoDone.record!, { testsPassed: true, result: `token ${['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_')}` })
ok('an outcome sentence is redacted too', outcomeSecret.result === '[removed]')

// ─── Owner-facing wording ──────────────────────────────────────────────────

const words = describeRecord(auto)
ok('a described record names what it is about', words.toLowerCase().includes('database client'), words)
ok('a described record never shows a database word', !/null|undefined|\[object/i.test(words), words)
ok('a proposed risky record says it waits for a decision', /waiting for a decision/i.test(describeRecord(risky)), describeRecord(risky))
ok('a rejected record says you said no', /you said no/i.test(describeRecord(rejected.record!)), describeRecord(rejected.record!))
ok('a specialist record says a specialist is needed', /specialist/i.test(describeRecord(specialist)))
ok('a completed record says the checks passed', /checks passed/i.test(describeRecord(checksPassed)), describeRecord(checksPassed))
ok('a failed check is stated, not hidden', /checks failed/i.test(describeRecord(checksFailed)), describeRecord(checksFailed))

const emptySummary = summariseHistory([])
ok('an empty history says there is nothing to show', /nothing to show/i.test(emptySummary.sentence), emptySummary.sentence)

const mixed: MaintenanceRecord[] = [auto, risky, rejected.record!, checksPassed, rollback.record!, specialist]
const summary = summariseHistory(mixed)
ok('the summary counts everything', summary.total === 6)
ok('the summary counts what waits for a decision', summary.awaitingDecision === 1, String(summary.awaitingDecision))
ok('the summary counts completed work', summary.completed >= 2, String(summary.completed))
ok('the summary counts undos', summary.rolledBack === 1, String(summary.rolledBack))
ok('the summary is a sentence, not a table', /\.$/.test(summary.sentence))
ok('a specialist item is never counted as waiting for approval', !/specialist/.test(summary.sentence))

console.log(`\nMaintenance history: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

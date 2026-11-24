/**
 * Restore rehearsal evidence (Priority 1).
 *
 * The rule this suite protects: a record that says "succeeded" must mean the rehearsal
 * passed, and nothing else may produce one. The second rule: writing evidence is opt-in,
 * so a default run against a production server still writes nothing but a JSON file.
 *
 * Run: npx tsx tests/restore-drill-evidence.test.ts  (no server or database needed)
 */

import {
  buildRestoreDrillRecord,
  recordRestoreDrill,
  evidenceConnectionUrl,
  sanitiseEvidenceText,
  type RestoreDrillOutcome,
  type EvidenceWriter,
  type RestoreDrillRecord,
} from '../src/lib/platform-reliability/restore-drill-evidence'

let passed = 0
let failed = 0
function ok(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const startedAt = new Date('2026-11-01T10:00:00Z')
const completedAt = new Date('2026-11-01T10:04:30Z')

function outcome(overrides: Partial<RestoreDrillOutcome> = {}): RestoreDrillOutcome {
  return {
    passed: true,
    backupId: 'backup_123',
    objectKey: 'database/backup_123.sql.gz.enc',
    startedAt,
    completedAt,
    tablesRestored: ['Appointment', 'Customer', 'Service'],
    rowsCompared: 4210,
    rowCountsMatched: true,
    detail: 'Restored 61 tables; 0 foreign-key violations; 34 migrations applied.',
    ...overrides,
  }
}

function fakeClient(behaviour: 'ok' | 'throw'): { client: EvidenceWriter; writes: RestoreDrillRecord[] } {
  const writes: RestoreDrillRecord[] = []
  const client: EvidenceWriter = {
    restoreDrill: {
      create: async ({ data }) => {
        if (behaviour === 'throw') throw new Error('connection refused: postgresql://barber:hunter2@db.internal:5432/shop')
        writes.push(data)
        return { id: 'drill_1' }
      },
    },
  }
  return { client, writes }
}

async function main() {
  console.log('--- a successful rehearsal ---')
  const successRecord = buildRestoreDrillRecord(outcome())
  ok(successRecord.status === 'succeeded', 'the record says succeeded')
  ok(successRecord.verifiedAt?.getTime() === completedAt.getTime(), 'verifiedAt is set to the completion time')
  ok(successRecord.backupId === 'backup_123', 'the backup identifier is recorded')
  ok(successRecord.startedAt.getTime() === startedAt.getTime(), 'the start time is recorded')
  ok(successRecord.completedAt.getTime() === completedAt.getTime(), 'the completion time is recorded')
  ok(successRecord.tablesRestored.length === 3, 'the tables are recorded')
  ok(successRecord.rowsCompared === 4210, 'the number of rows compared is recorded')
  ok(successRecord.rowCountsMatched === true, 'the row-count result is recorded')
  ok(successRecord.durationMs === 270_000, 'the duration is recorded in milliseconds')
  ok((successRecord.detail ?? '').includes('migrations applied'), 'the detail survives')

  const ok1 = fakeClient('ok')
  const savedSuccess = await recordRestoreDrill(outcome(), { client: ok1.client })
  ok(savedSuccess.saved === true, 'a successful outcome is written')
  ok(ok1.writes.length === 1, 'exactly one row is written')
  ok(ok1.writes[0].status === 'succeeded', 'the written row is a success')
  ok(savedSuccess.recordStatus === 'succeeded', 'a saved success reports its actual stored status')

  console.log('--- a failed rehearsal ---')
  const failedRecord = buildRestoreDrillRecord(outcome({ passed: false, rowCountsMatched: false, rowsCompared: null, tablesRestored: [], detail: 'row-count mismatch on "Appointment"' }))
  ok(failedRecord.status === 'failed', 'the record says failed')
  ok(failedRecord.verifiedAt === null, 'a failure never carries a verified timestamp')
  ok((failedRecord.detail ?? '').includes('row-count mismatch'), 'the real reason is kept')
  const ok2 = fakeClient('ok')
  await recordRestoreDrill(outcome({ passed: false, rowCountsMatched: false, rowsCompared: null, tablesRestored: [] }), { client: ok2.client })
  ok(ok2.writes[0].status === 'failed', 'a failure is written as a failure')

  console.log('--- no false success ---')
  ok(buildRestoreDrillRecord(outcome({ rowCountsMatched: null })).status === 'failed', 'an unknown row-count result is not a success')
  ok(buildRestoreDrillRecord(outcome({ rowCountsMatched: false })).status === 'failed', 'a mismatch is not a success')
  ok(buildRestoreDrillRecord(outcome({ rowsCompared: 0 })).status === 'failed', 'zero rows compared is not a success')
  ok(buildRestoreDrillRecord(outcome({ tablesRestored: [] })).status === 'failed', 'no tables is not a success')
  ok(buildRestoreDrillRecord(outcome({ passed: false })).status === 'failed', 'a failed run is not a success even when the counts look right')
  const invalidEvidenceClient = fakeClient('ok')
  const invalidEvidence = await recordRestoreDrill(outcome({ rowsCompared: 0 }), { client: invalidEvidenceClient.client })
  ok(invalidEvidence.saved && invalidEvidence.recordStatus === 'failed', 'a persisted but structurally incomplete evidence record stays failed')

  console.log('--- opt-in configuration ---')
  ok(evidenceConnectionUrl({}) === null, 'no variable means no evidence database')
  ok(evidenceConnectionUrl({ RESTORE_DRILL_EVIDENCE_URL: '   ' }) === null, 'a blank value means no evidence database')
  ok(evidenceConnectionUrl({ RESTORE_DRILL_EVIDENCE_URL: 'postgresql://evidence/db' }) === 'postgresql://evidence/db', 'a configured value is used')

  const unconfigured = await recordRestoreDrill(outcome(), { url: null })
  ok(unconfigured.saved === false, 'nothing is written without configuration')
  ok(unconfigured.reason.includes('RESTORE_DRILL_EVIDENCE_URL'), 'the reason names the variable to set')

  console.log('--- a failed write ---')
  const bad = fakeClient('throw')
  const failedWrite = await recordRestoreDrill(outcome(), { client: bad.client })
  ok(failedWrite.saved === false, 'a failed write is reported as not saved')
  ok(failedWrite.recordStatus === null, 'a failed write carries no saved record status')
  ok(!failedWrite.reason.includes('hunter2'), 'the password from the error is not printed')
  ok(failedWrite.reason.includes('[connection string removed]'), 'the connection string is replaced in the message')
  ok(buildRestoreDrillRecord(outcome()).status === 'succeeded', 'a write failure cannot downgrade a real success record')

  console.log('--- sanitising ---')
  ok(sanitiseEvidenceText('failed at postgresql://u:p@host:5432/db') === 'failed at [connection string removed]', 'a connection string is removed')
  ok(sanitiseEvidenceText('PASSWORD=hunter2 while restoring') === 'PASSWORD=[removed] while restoring', 'a password token is removed')
  ok(sanitiseEvidenceText(null) === null, 'null stays null')

  console.log('--- the rehearsal keeps its cleanup and JSON evidence ---')
  const script = (await import('node:fs')).readFileSync('scripts/rehearse-restore.ts', 'utf8')
  ok(script.includes('cleanup.runAll()'), 'cleanup still runs in a finally block')
  ok(script.includes("join(process.cwd(), 'backups', 'rehearsals')"), 'the JSON evidence file is still written')
  ok(script.includes('recordRestoreDrill'), 'the drill record is written through the new module')
  ok(script.includes('saved.recordStatus === \'succeeded\''), 'a structurally failed evidence record cannot make a rehearsal successful')
  ok(script.includes('if (!rehearsalSucceeded) process.exitCode = 1'), 'a failed write or failed evidence record fails the rehearsal command')
  ok(!/DATABASE_URL\s*:\s*.*RESTORE_DRILL/.test(script), 'the evidence connection is never implicitly taken from DATABASE_URL')
  const workflow = (await import('node:fs')).readFileSync('.github/workflows/restore-rehearsal.yml', 'utf8')
  ok(workflow.includes("cron: '17 4 1 */3 *'"), 'a quarterly GitHub Actions schedule exists')
  ok(workflow.includes('RESTORE_DRILL_EVIDENCE_URL: ${{ secrets.STAGING_DATABASE_URL }}'), 'evidence is written to the staging app database the report reads')
  ok(workflow.includes('npm run db:backup:rehearse -- --json'), 'the scheduled job runs the tested rehearsal command')

  console.log(`\nRestore drill evidence: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => { console.error(error); process.exit(1) })

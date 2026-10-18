import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyMigrationFailure,
  evaluateCurrentSchemaPush,
  evaluatePreexistingObjectsRepair,
  extractFailedMigrationName,
  parseStateReport,
  runVercelBuild,
  validateBuildEnvironment,
} from '../scripts/vercel-build.mjs'

const databaseUrl = 'postgresql://test-user:test-password@localhost:5432/barber'
const baseEnvironment = {
  DATABASE_URL: databaseUrl,
  NEXTAUTH_SECRET: 'test-only-secret',
  NEXTAUTH_URL: 'http://localhost:3000',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
}

function createHarness(responses) {
  const calls = []
  const delays = []
  const logs = { stdout: '', stderr: '' }
  return {
    calls,
    delays,
    logs,
    spawn(command, args, options) {
      calls.push({ command, args, options })
      return responses.shift() ?? { status: 0, stdout: '', stderr: '' }
    },
    sleep: async (milliseconds) => delays.push(milliseconds),
    stdout: (message) => { logs.stdout += message },
    stderr: (message) => { logs.stderr += message },
  }
}

const statusOk = {
  status: 0,
  stdout: `Datasource "db": PostgreSQL database "barber" for "${databaseUrl}"\n\n3 migrations found in Prisma Migrate\n\nAll migrations have been applied.\n`,
  stderr: '',
}

test('validates required configuration before running any command', async () => {
  let commandStarted = false
  await assert.rejects(
    runVercelBuild({
      environment: {},
      spawn: () => {
        commandStarted = true
        return { status: 0 }
      },
    }),
    /Configuration error: set the following Vercel environment variables: DATABASE_URL.*NEXTAUTH_SECRET/
  )
  assert.equal(commandStarted, false)
})

test('rejects invalid database URL configuration without exposing values', () => {
  assert.throws(
    () => validateBuildEnvironment({ ...baseEnvironment, DATABASE_URL: 'not-a-postgres-url' }),
    /DATABASE_URL must be a valid PostgreSQL connection URL/
  )
})

test('uses Vercel deployment URL when public app and auth URLs are omitted', () => {
  const env = validateBuildEnvironment({
    DATABASE_URL: databaseUrl,
    NEXTAUTH_SECRET: 'test-only-secret',
    VERCEL_URL: 'preview.example.test',
  })
  assert.equal(env.NEXT_PUBLIC_APP_URL, 'https://preview.example.test')
  assert.equal(env.NEXTAUTH_URL, 'https://preview.example.test')
})

test('classifies permanent auth, database configuration, schema, and migration errors', () => {
  assert.deepEqual(classifyMigrationFailure('Error P1000'), {
    category: 'authentication',
    retryable: false,
  })
  assert.deepEqual(classifyMigrationFailure('Error P1003'), {
    category: 'database configuration',
    retryable: false,
  })
  assert.deepEqual(classifyMigrationFailure('Error P3005'), {
    category: 'schema baseline mismatch',
    retryable: false,
  })
  assert.deepEqual(classifyMigrationFailure('Error P3009'), {
    category: 'migration history or SQL failure',
    retryable: false,
  })
})

test('reports the database migration state before deploying, with redacted credentials', async () => {
  const harness = createHarness([
    statusOk,
    { status: 0, stdout: 'migrations applied', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
  ])

  await runVercelBuild({
    environment: baseEnvironment,
    spawn: harness.spawn,
    sleep: harness.sleep,
    stdout: harness.stdout,
    stderr: harness.stderr,
  })

  assert.deepEqual(harness.calls.map(({ command, args }) => [command, args.join(' ')]), [
    ['prisma', 'migrate status'],
    ['prisma', 'migrate deploy'],
    ['prisma', 'generate'],
    ['next', 'build'],
  ])
  assert.match(harness.logs.stdout, /Reporting the database migration state/)
  assert.match(harness.logs.stdout, /3 migrations found in Prisma Migrate/)
  assert.doesNotMatch(harness.logs.stdout + harness.logs.stderr, /test-password/)
  assert.doesNotMatch(harness.logs.stdout + harness.logs.stderr, /postgresql:\/\/test-user/)
})

test('continues deploying when the migration-state report exits non-zero or is unavailable', async () => {
  const statusBroken = {
    status: 1,
    stdout: `Error P3005: the migration state for "${databaseUrl}" could not be determined`,
    stderr: '',
  }
  const harness = createHarness([
    statusBroken,
    { status: 0, stdout: 'migrations applied', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
  ])

  await runVercelBuild({
    environment: baseEnvironment,
    spawn: harness.spawn,
    sleep: harness.sleep,
    stdout: harness.stdout,
    stderr: harness.stderr,
  })

  assert.match(harness.logs.stdout, /Reporting the database migration state/)
  assert.match(harness.logs.stdout, /could not be determined/)
  assert.equal(harness.calls.filter((call) => call.command === 'prisma' && call.args[1] === 'deploy').length, 1)
  assert.doesNotMatch(harness.logs.stdout + harness.logs.stderr, /test-password/)
})

test('retries a transient connectivity failure and then completes in order', async () => {
  const harness = createHarness([
    statusOk,
    { status: 1, stdout: `Error P1001: cannot connect using ${databaseUrl}`, stderr: '' },
    { status: 0, stdout: 'migrations applied', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
  ])

  await runVercelBuild({
    environment: baseEnvironment,
    spawn: harness.spawn,
    sleep: harness.sleep,
    stdout: harness.stdout,
    stderr: harness.stderr,
  })

  assert.deepEqual(harness.calls.map(({ command, args }) => [command, args.join(' ')]), [
    ['prisma', 'migrate status'],
    ['prisma', 'migrate deploy'],
    ['prisma', 'migrate deploy'],
    ['prisma', 'generate'],
    ['next', 'build'],
  ])
  assert.deepEqual(harness.delays, [2_000])
  assert.match(harness.logs.stderr, /database connectivity failure/)
  assert.doesNotMatch(harness.logs.stdout + harness.logs.stderr, /test-password/)
})

test('does not retry permanent migration failures or start a build', async () => {
  for (const [output, category] of [
    ['Error P1000: authentication failed', 'authentication'],
    ['Error P1003: database does not exist', 'database configuration'],
    ['Error P3018: migration failed', 'migration history or SQL failure'],
  ]) {
    const harness = createHarness([statusOk, { status: 1, stdout: output, stderr: '' }])
    await assert.rejects(
      runVercelBuild({
        environment: baseEnvironment,
        spawn: harness.spawn,
        sleep: harness.sleep,
        stdout: harness.stdout,
        stderr: harness.stderr,
      }),
      new RegExp(`stopped after a ${category} failure`)
    )
    assert.equal(harness.calls.length, 2)
    assert.deepEqual(harness.delays, [])
  }
})

test('bounds retries for transient migration failures', async () => {
  const harness = createHarness([
    statusOk,
    ...Array.from({ length: 4 }, () => ({ status: 1, stdout: 'Error P1001', stderr: '' })),
  ])

  await assert.rejects(
    runVercelBuild({
      environment: baseEnvironment,
      spawn: harness.spawn,
      sleep: harness.sleep,
      stdout: harness.stdout,
      stderr: harness.stderr,
    }),
    /stopped after a database connectivity failure/
  )
  assert.equal(harness.calls.length, 5)
  assert.deepEqual(harness.delays, [2_000, 5_000, 10_000])
  assert.doesNotMatch(harness.logs.stdout + harness.logs.stderr, /migrate deploy did not complete/)
})

test('stops when Prisma Client generation fails', async () => {
  const harness = createHarness([
    statusOk,
    { status: 0, stdout: '', stderr: '' },
    { status: 1, stdout: '', stderr: '' },
  ])

  await assert.rejects(
    runVercelBuild({
      environment: baseEnvironment,
      spawn: harness.spawn,
      stdout: harness.stdout,
      stderr: harness.stderr,
    }),
    /Prisma Client generation failed/
  )
  assert.equal(harness.calls.length, 3)
})

test('reports Next.js build failures and never reports success', async () => {
  const harness = createHarness([
    statusOk,
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 1, stdout: '', stderr: '' },
  ])

  await assert.rejects(
    runVercelBuild({
      environment: baseEnvironment,
      spawn: harness.spawn,
      stdout: harness.stdout,
      stderr: harness.stderr,
    }),
    /Next.js production build .* failed/
  )
  assert.equal(harness.calls.length, 4)
})

test('recovers the known P3009 failed-migration state once, then completes in order', async () => {
  const harness = createHarness([
    statusOk,
    {
      status: 1,
      stdout: `Error P3009: migrate found failed migrations in the target database, new migrations will not be applied. The 20261017203707_review_requests_booking_source_analytics migration started at 2026-10-17 22:52:21.731895 UTC failed`,
      stderr: '',
    },
    { status: 0, stdout: 'Migration ... marked as rolled back.', stderr: '' },
    { status: 0, stdout: 'All migrations have been successfully applied.', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
  ])

  await runVercelBuild({
    environment: baseEnvironment,
    spawn: harness.spawn,
    sleep: harness.sleep,
    stdout: harness.stdout,
    stderr: harness.stderr,
  })

  assert.deepEqual(harness.calls.map(({ command, args }) => [command, args.join(' ')]), [
    ['prisma', 'migrate status'],
    ['prisma', 'migrate deploy'],
    ['prisma', 'migrate resolve --rolled-back 20261017203707_review_requests_booking_source_analytics'],
    ['prisma', 'migrate deploy'],
    ['prisma', 'generate'],
    ['next', 'build'],
  ])
  assert.match(harness.logs.stderr, /known recoverable failure/)
  assert.doesNotMatch(harness.logs.stdout + harness.logs.stderr, /test-password/)
})

test('does not attempt P3009 recovery for unrelated failed migrations', async () => {
  const harness = createHarness([
    statusOk,
    {
      status: 1,
      stdout: 'Error P3009: migrate found failed migrations in the target database. The `20300101000000_some_other_migration` migration started at 2026-10-18 00:00:00.000000 UTC failed',
      stderr: '',
    },
  ])

  await assert.rejects(
    runVercelBuild({
      environment: baseEnvironment,
      spawn: harness.spawn,
      sleep: harness.sleep,
      stdout: harness.stdout,
      stderr: harness.stderr,
    }),
    /stopped after a migration history or SQL failure/
  )
  assert.equal(harness.calls.length, 2)
})

test('names the failing migration and the runbook in the terminal error', async () => {
  const harness = createHarness([
    statusOk,
    {
      status: 1,
      stdout: 'Applying migration `20261017170000_automated_review_requests`\nError P3018: migration failed to apply\nMigration name: 20261017170000_automated_review_requests\nDatabase error code: 42701',
      stderr: '',
    },
  ])

  await assert.rejects(
    runVercelBuild({
      environment: baseEnvironment,
      spawn: harness.spawn,
      sleep: harness.sleep,
      stdout: harness.stdout,
      stderr: harness.stderr,
    }),
    (error) =>
      /The failing migration is `20261017170000_automated_review_requests`\./.test(error)
      && /docs\/MIGRATION-RECOVERY\.md/.test(error)
  )
})

test('extracts the failing migration from each Prisma output shape', () => {
  assert.equal(
    extractFailedMigrationName('Error P3009: The `20261017170000_automated_review_requests` migration started at 2026-10-18 00:12:03.832344 UTC failed'),
    '20261017170000_automated_review_requests'
  )
  assert.equal(
    extractFailedMigrationName('Error P3018\nMigration name: 20261017170000_automated_review_requests\nDatabase error code: 42701'),
    '20261017170000_automated_review_requests'
  )
  assert.equal(
    extractFailedMigrationName('Applying migration `20261017170000_automated_review_requests`\nApplying migration `20261017203707_review_requests_booking_source_analytics`\nError P3018'),
    '20261017203707_review_requests_booking_source_analytics'
  )
  assert.equal(extractFailedMigrationName('Error P1001: cannot connect'), '')
})

test('reports an actionable error when P3009 recovery itself fails', async () => {
  const harness = createHarness([
    statusOk,
    {
      status: 1,
      stdout: 'Error P3009: The 20261017203707_review_requests_booking_source_analytics migration failed',
      stderr: '',
    },
    { status: 1, stdout: 'Error P3010', stderr: '' },
  ])

  await assert.rejects(
    runVercelBuild({
      environment: baseEnvironment,
      spawn: harness.spawn,
      sleep: harness.sleep,
      stdout: harness.stdout,
      stderr: harness.stderr,
    }),
    (error) => /Migration recovery failed/.test(error) && /migrate resolve --rolled-back/.test(error)
  )
  assert.equal(harness.calls.length, 3)
})

const failedRecord17170000 = {
  status: 1,
  stdout: 'Applying migration `20261017170000_automated_review_requests`\nError P3018: A migration failed to apply. Migration name: 20261017170000_automated_review_requests\nDatabase error code: 42701\nDatabase error: ERROR: column "reviewRequestsEnabled" of relation "RetentionSettings" already exists',
  stderr: '',
}

const stateReportOk = {
  failedRecordCount: 1,
  failedRecordName: '20261017170000_automated_review_requests',
  failedRecordNames: ['20261017170000_automated_review_requests'],
  enumValues: 'PENDING,SENT,CLICKED,COMPLETED,FAILED',
  reviewRequestPresent: true,
  reviewRequestColumns: ['id', 'businessId', 'appointmentId', 'customerId', 'channel', 'destination', 'token', 'status', 'scheduledAt', 'sentAt', 'clickedAt', 'completedAt', 'failureReason', 'createdAt', 'updatedAt'],
  reviewRequestRows: 0,
  laterMigrationsApplied: 0,
  bookingSourceEnumPresent: false,
  reviewRequestSettingsPresent: false,
  customerEmailOptOutPresent: false,
  retentionReviewRequestsEnabledPresent: true,
  notes: [],
}

test('auto-repairs the failed 20261017170000 record only after read-only verification passes', async () => {
  const harness = createHarness([
    statusOk,
    failedRecord17170000,
    { status: 0, stdout: JSON.stringify(stateReportOk), stderr: '' },
    { status: 0, stdout: 'Migration 20261017170000_automated_review_requests marked as applied.', stderr: '' },
    { status: 0, stdout: 'All migrations have been successfully applied.', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
  ])

  await runVercelBuild({
    environment: baseEnvironment,
    spawn: harness.spawn,
    sleep: harness.sleep,
    stdout: harness.stdout,
    stderr: harness.stderr,
  })

  assert.deepEqual(harness.calls.map(({ command, args }) => [command, args.join(' ')]), [
    ['prisma', 'migrate status'],
    ['prisma', 'migrate deploy'],
    ['node', 'scripts/check-review-request-state.mjs'],
    ['prisma', 'migrate resolve --applied 20261017170000_automated_review_requests'],
    ['prisma', 'migrate deploy'],
    ['prisma', 'generate'],
    ['next', 'build'],
  ])
  assert.match(harness.logs.stderr, /Verifying the database read-only/)
  assert.match(harness.logs.stderr, /Verification passed/)
  assert.match(harness.logs.stdout, /failedRecordCount/)
})

const stateReportCaseA = {
  ...stateReportOk,
  enumValues: 'PENDING,PROCESSING,SENT,FAILED,SUPPRESSED,CANCELLED',
  reviewRequestColumns: ['id', 'businessId', 'appointmentId', 'customerId', 'destinationUrl', 'scheduledFor', 'status', 'attemptCount', 'lastAttemptAt', 'sentAt', 'providerMessageId', 'failureCategory', 'failureDetail', 'idempotencyKey', 'createdAt', 'updatedAt'],
  bookingSourceEnumPresent: true,
  reviewRequestSettingsPresent: true,
  customerEmailOptOutPresent: true,
  notificationReviewRequestPresent: true,
  appointmentBookingCampaignPresent: true,
  appointmentBookingSourceIsEnum: true,
  waitlistClaimedPresent: true,
}

test('auto-baselines the current-schema-push state after every fingerprint passes', async () => {
  const harness = createHarness([
    statusOk,
    {
      status: 1,
      stdout: 'Error P3009: migrate found failed migrations in the target database. The `20261017170000_automated_review_requests` migration started at 2026-10-18 00:12:03.832344 UTC failed',
      stderr: '',
    },
    { status: 0, stdout: JSON.stringify(stateReportCaseA), stderr: '' },
    { status: 0, stdout: 'marked as applied', stderr: '' },
    { status: 0, stdout: 'marked as applied', stderr: '' },
    { status: 0, stdout: 'marked as applied', stderr: '' },
    { status: 0, stdout: 'marked as applied', stderr: '' },
    { status: 0, stdout: 'marked as applied', stderr: '' },
    { status: 0, stdout: 'No pending migrations to apply.', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: '', stderr: '' },
  ])

  await runVercelBuild({
    environment: baseEnvironment,
    spawn: harness.spawn,
    sleep: harness.sleep,
    stdout: harness.stdout,
    stderr: harness.stderr,
  })

  assert.deepEqual(harness.calls.map(({ command, args }) => [command, args.join(' ')]), [
    ['prisma', 'migrate status'],
    ['prisma', 'migrate deploy'],
    ['node', 'scripts/check-review-request-state.mjs'],
    ['prisma', 'migrate resolve --applied 20261017170000_automated_review_requests'],
    ['prisma', 'migrate resolve --applied 20261017203707_review_requests_booking_source_analytics'],
    ['prisma', 'migrate resolve --applied 20261017203731_review_request_notification_type'],
    ['prisma', 'migrate resolve --applied 20261017204003_appointment_source_and_completion'],
    ['prisma', 'migrate resolve --applied 20261017210000_sync_waitlist_claimed_drift'],
    ['prisma', 'migrate deploy'],
    ['prisma', 'generate'],
    ['next', 'build'],
  ])
  assert.match(harness.logs.stderr, /Case A/)
  assert.match(harness.logs.stderr, /marked applied without running any SQL/)
})

test('stops with the combined evidence when the state matches neither repairable shape', async () => {
  const stateReportUnknownShape = {
    ...stateReportOk,
    enumValues: 'PENDING,SENT',
    laterMigrationsApplied: 1,
  }
  const harness = createHarness([
    statusOk,
    failedRecord17170000,
    { status: 0, stdout: JSON.stringify(stateReportUnknownShape), stderr: '' },
  ])

  await assert.rejects(
    runVercelBuild({
      environment: baseEnvironment,
      spawn: harness.spawn,
      sleep: harness.sleep,
      stdout: harness.stdout,
      stderr: harness.stderr,
    }),
    /matches neither auto-repairable shape.*Current-schema-push evidence/s
  )
  assert.deepEqual(harness.calls.map(({ command, args }) => [command, args.join(' ')]), [
    ['prisma', 'migrate status'],
    ['prisma', 'migrate deploy'],
    ['node', 'scripts/check-review-request-state.mjs'],
  ])
})

test('evaluatePreexistingObjectsRepair gates every precondition', () => {
  assert.equal(evaluatePreexistingObjectsRepair(stateReportOk).ok, true)

  const withRows = evaluatePreexistingObjectsRepair({ ...stateReportOk, reviewRequestRows: 3 })
  assert.equal(withRows.ok, false)
  assert.match(withRows.reasons.join(' '), /contains 3 row/)

  const withCurrentEnum = evaluatePreexistingObjectsRepair({
    ...stateReportOk,
    enumValues: 'PENDING,PROCESSING,SENT,FAILED,SUPPRESSED,CANCELLED',
  })
  assert.equal(withCurrentEnum.ok, false)
  assert.match(withCurrentEnum.reasons.join(' '), /Case A baselining/)

  const withLaterApplied = evaluatePreexistingObjectsRepair({ ...stateReportOk, laterMigrationsApplied: 2 })
  assert.equal(withLaterApplied.ok, false)
  assert.match(withLaterApplied.reasons.join(' '), /already applied/)

  const withMissingTable = evaluatePreexistingObjectsRepair({ ...stateReportOk, reviewRequestPresent: false })
  assert.equal(withMissingTable.ok, false)
  assert.match(withMissingTable.reasons.join(' '), /ReviewRequest table is absent/)

  const withTwoFailedRecords = evaluatePreexistingObjectsRepair({
    ...stateReportOk,
    failedRecordCount: 2,
    failedRecordNames: ['20261017170000_automated_review_requests', '20261017203707_review_requests_booking_source_analytics'],
  })
  assert.equal(withTwoFailedRecords.ok, false)
  assert.match(withTwoFailedRecords.reasons.join(' '), /exactly one failed record/)
})

test('evaluateCurrentSchemaPush requires every later-migration fingerprint', () => {
  assert.equal(evaluateCurrentSchemaPush(stateReportCaseA).ok, true)

  const missingWaitlistClaimed = evaluateCurrentSchemaPush({ ...stateReportCaseA, waitlistClaimedPresent: false })
  assert.equal(missingWaitlistClaimed.ok, false)
  assert.match(missingWaitlistClaimed.reasons.join(' '), /20261017210000 effect missing/)

  // Existing rows are allowed: baselining runs no SQL, so data is preserved.
  const withRows = evaluateCurrentSchemaPush({ ...stateReportCaseA, reviewRequestRows: 2 })
  assert.equal(withRows.ok, true)

  // Failed records naming any of the five migrations are acceptable.
  const withExtraFailedRecord = evaluateCurrentSchemaPush({
    ...stateReportCaseA,
    failedRecordCount: 2,
    failedRecordNames: ['20261017170000_automated_review_requests', '20261017203707_review_requests_booking_source_analytics'],
  })
  assert.equal(withExtraFailedRecord.ok, true)

  // ...but a failed record outside the five is not.
  const withForeignFailedRecord = evaluateCurrentSchemaPush({
    ...stateReportCaseA,
    failedRecordCount: 2,
    failedRecordNames: ['20261017170000_automated_review_requests', '20300101000000_unrelated'],
  })
  assert.equal(withForeignFailedRecord.ok, false)
  assert.match(withForeignFailedRecord.reasons.join(' '), /five baselined migrations/)

  assert.equal(evaluateCurrentSchemaPush(stateReportOk).ok, false)
})

test('parses the read-only state report and rejects garbage', () => {
  assert.equal(parseStateReport(`${JSON.stringify(stateReportOk)}\n`).failedRecordName, '20261017170000_automated_review_requests')
  assert.equal(parseStateReport('not json at all'), null)
})

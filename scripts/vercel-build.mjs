import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATION_RETRY_DELAYS_MS = [2_000, 5_000, 10_000]
const MIGRATION_ATTEMPTS = MIGRATION_RETRY_DELAYS_MS.length + 1

// One-shot self-healing for the 2026-10-17 migration conflict (P3018/P3009):
// the superseded prototype migration 20261017170000 applied cleanly, but the
// follow-up 20261017203707 failed on every database that attempted it, leaving
// a failed-migration record that blocks future `migrate deploy` runs (P3009).
// The failed migration executed inside a transaction and rolled back
// completely (Postgres DDL is transactional; it aborted at its first CREATE
// TYPE), so marking it rolled back is factually accurate. The corrected
// migration file is then re-applied for real — nothing is marked applied
// without its SQL actually running.
export const RECOVERABLE_FAILED_MIGRATION = '20261017203707_review_requests_booking_source_analytics'
const DATABASE_URL_VARIABLES = ['DATABASE_URL', 'NEON_POSTGRES_PRISMA_URL', 'NEON_POSTGRES_URL']

// One-shot evidence-gated recovery for the confirmed 2026-10-18 production
// incident: _prisma_migrations holds a failed record for the FIRST
// review-request migration because its schema objects were created outside
// migrations (the schema was pushed with `prisma db push` before the migration
// ran, so `migrate deploy` fails with "already exists" and then P3009). The
// repair — marking that migration applied — is only legal once its intended
// objects are PROVEN present. scripts/check-review-request-state.mjs performs
// the read-only verification; evaluatePreexistingObjectsRepair decides from
// that report, and any mismatch stops the build with the observed evidence.
// See docs/MIGRATION-RECOVERY.md (Case B).
export const FAILED_MIGRATION_WITH_PREEXISTING_OBJECTS = '20261017170000_automated_review_requests'
const REVIEW_REQUEST_STATE_CHECK_SCRIPT = 'scripts/check-review-request-state.mjs'
const PROTOTYPE_REVIEW_REQUEST_ENUM_VALUES = 'PENDING,SENT,CLICKED,COMPLETED,FAILED'
const PROTOTYPE_REVIEW_REQUEST_COLUMNS = [
  'id', 'businessId', 'appointmentId', 'customerId', 'channel', 'destination',
  'token', 'status', 'scheduledAt', 'sentAt', 'clickedAt', 'completedAt',
  'failureReason', 'createdAt', 'updatedAt',
]

export function evaluatePreexistingObjectsRepair(report) {
  const reasons = []
  if (report.failedRecordCount === null) {
    reasons.push('the failed-migration record could not be read from _prisma_migrations')
  } else if (report.failedRecordNames) {
    if (report.failedRecordNames.length !== 1 || report.failedRecordNames[0] !== FAILED_MIGRATION_WITH_PREEXISTING_OBJECTS) {
      reasons.push(`expected exactly one failed record for \`${FAILED_MIGRATION_WITH_PREEXISTING_OBJECTS}\`, found ${report.failedRecordCount} naming \`${(report.failedRecordNames || []).join(', ')}\``)
    }
  } else {
    if (report.failedRecordCount !== 1) {
      reasons.push(`expected exactly one failed migration record, found ${report.failedRecordCount}`)
    }
    if (report.failedRecordName !== FAILED_MIGRATION_WITH_PREEXISTING_OBJECTS) {
      reasons.push(`the failed record names \`${report.failedRecordName}\`, not \`${FAILED_MIGRATION_WITH_PREEXISTING_OBJECTS}\``)
    }
  }
  if (report.reviewRequestPresent !== true) {
    reasons.push('the ReviewRequest table is absent, so the migration left no partial changes (docs/MIGRATION-RECOVERY.md Case B applies to a clean rollback, not this repair)')
  } else if (report.reviewRequestRows !== 0) {
    reasons.push(`the ReviewRequest table contains ${report.reviewRequestRows} row(s); the repair needs a human decision about that data first`)
  }
  if (report.enumValues !== PROTOTYPE_REVIEW_REQUEST_ENUM_VALUES) {
    reasons.push(
      `the ReviewRequestStatus enum values are \`${report.enumValues}\`, expected the prototype \`${PROTOTYPE_REVIEW_REQUEST_ENUM_VALUES}\`` +
      ' (if the values match the current schema instead, the database was pushed from the current schema: follow docs/MIGRATION-RECOVERY.md Case A baselining)'
    )
  }
  if (
    !report.reviewRequestColumns
    || report.reviewRequestColumns.join(',') !== PROTOTYPE_REVIEW_REQUEST_COLUMNS.join(',')
  ) {
    reasons.push(
      `the ReviewRequest columns are \`${(report.reviewRequestColumns || []).join(',')}\`, expected the prototype column set of migration 20261017170000`
    )
  }
  if (report.retentionReviewRequestsEnabledPresent !== true) {
    reasons.push('RetentionSettings.reviewRequestsEnabled is absent, so the migration\'s effects are not present')
  }
  if (report.laterMigrationsApplied !== 0) {
    reasons.push(`${report.laterMigrationsApplied} of the later review-request migrations are already applied; only the all-pending state is auto-repairable`)
  }
  if (report.bookingSourceEnumPresent === true) {
    reasons.push('the BookingSource enum already exists, so later migrations\' effects are partially present (docs/MIGRATION-RECOVERY.md Case A applies)')
  }
  if (report.reviewRequestSettingsPresent === true) {
    reasons.push('the ReviewRequestSettings table already exists, so later migrations\' effects are partially present (docs/MIGRATION-RECOVERY.md Case A applies)')
  }
  if (report.customerEmailOptOutPresent === true) {
    reasons.push('Customer.emailOptOut already exists, so later migrations\' effects are partially present (docs/MIGRATION-RECOVERY.md Case A applies)')
  }
  return { ok: reasons.length === 0, reasons }
}

// The other known-likely incident shape (docs/MIGRATION-RECOVERY.md Case A):
// the schema was pushed from the CURRENT schema.prisma, so the database
// already contains the cumulative end state of ALL five review-request
// migrations (canonical shapes plus every later fingerprint). Nothing to
// run — the only honest repair is to baseline: mark the five migrations
// applied after the fingerprints below prove their effects are present.
export const CANONICAL_REVIEW_REQUEST_ENUM_VALUES = 'PENDING,PROCESSING,SENT,FAILED,SUPPRESSED,CANCELLED'
export const CANONICAL_REVIEW_REQUEST_COLUMNS = [
  'id', 'businessId', 'appointmentId', 'customerId', 'destinationUrl', 'scheduledFor',
  'status', 'attemptCount', 'lastAttemptAt', 'sentAt', 'providerMessageId', 'failureCategory',
  'failureDetail', 'idempotencyKey', 'createdAt', 'updatedAt',
]
export const MIGRATIONS_TO_BASELINE_AFTER_CURRENT_SCHEMA_PUSH = [
  '20261017170000_automated_review_requests',
  '20261017203707_review_requests_booking_source_analytics',
  '20261017203731_review_request_notification_type',
  '20261017204003_appointment_source_and_completion',
  '20261017210000_sync_waitlist_claimed_drift',
]

// The third evidence-verified shape (docs/MIGRATION-RECOVERY.md Case C),
// read directly from the production database on 2026-10-18: an EARLIER DRAFT
// of the review-request feature was pushed outside migrations (draft enum
// values SKIPPED/CANCELED, draft columns recipient/nextAttemptAt/skipReason),
// and the failed record for 20261017170000 remains because its first
// statement (CREATE TYPE) hits "already exists". Since NONE of the five
// migrations' effects are present, baselining would be wrong — the migration
// must run for real. The repair: clear the failed record, remove the
// provably-empty draft objects, and let migrate deploy apply everything.
export const DRAFT_REVIEW_REQUEST_ENUM_VALUES = 'PENDING,PROCESSING,SENT,FAILED,SKIPPED,CANCELED'
export const DRAFT_REVIEW_REQUEST_COLUMNS = [
  'id', 'businessId', 'appointmentId', 'customerId', 'recipient', 'status', 'scheduledAt',
  'attemptCount', 'lastAttemptAt', 'nextAttemptAt', 'providerMessageId', 'failureReason',
  'skipReason', 'createdAt', 'updatedAt',
]
const DRAFT_OBJECTS_DROP_SQL = 'scripts/sql/drop-draft-review-request-objects.sql'

export function evaluateDraftObjectsRepair(report) {
  const reasons = []
  const failedNames = report.failedRecordNames
    || (report.failedRecordCount === 1 && report.failedRecordName ? [report.failedRecordName] : null)
  if (!failedNames || failedNames.length !== 1 || failedNames[0] !== FAILED_MIGRATION_WITH_PREEXISTING_OBJECTS) {
    reasons.push(`expected exactly one failed record for \`${FAILED_MIGRATION_WITH_PREEXISTING_OBJECTS}\`, found ${report.failedRecordCount} naming \`${failedNames ? failedNames.join(', ') : report.failedRecordName}\``)
  }
  if (report.reviewRequestPresent !== true) {
    reasons.push('the ReviewRequest table is absent, so there are no draft objects to remove')
  }
  if (report.reviewRequestRows !== 0) {
    reasons.push(`the draft ReviewRequest table contains ${report.reviewRequestRows} row(s); a human must decide about that data first`)
  }
  if (report.enumValues !== DRAFT_REVIEW_REQUEST_ENUM_VALUES) {
    reasons.push(`the ReviewRequestStatus enum values are \`${report.enumValues}\`, expected the draft \`${DRAFT_REVIEW_REQUEST_ENUM_VALUES}\``)
  }
  if (
    !report.reviewRequestColumns
    || report.reviewRequestColumns.join(',') !== DRAFT_REVIEW_REQUEST_COLUMNS.join(',')
  ) {
    reasons.push(`the ReviewRequest columns are \`${(report.reviewRequestColumns || []).join(',')}\`, expected the draft column set`)
  }
  if (report.retentionReviewRequestsEnabledPresent !== false) {
    reasons.push('the retention review columns are present, so migration 20261017170000 already had effect — the draft case does not apply')
  }
  if (report.laterMigrationsApplied !== 0) {
    reasons.push(`${report.laterMigrationsApplied} of the later migrations are already applied — the draft case does not apply`)
  }
  if (report.bookingSourceEnumPresent === true) reasons.push('the BookingSource enum exists, so later effects are partially present')
  if (report.reviewRequestSettingsPresent === true) reasons.push('the ReviewRequestSettings table exists, so later effects are partially present')
  if (report.customerEmailOptOutPresent === true) reasons.push('Customer.emailOptOut exists, so later effects are partially present')
  if (report.notificationReviewRequestPresent === true) reasons.push('NotificationType has REVIEW_REQUEST, so later effects are partially present')
  if (report.appointmentBookingCampaignPresent === true) reasons.push('Appointment.bookingCampaign exists, so later effects are partially present')
  if (report.appointmentBookingSourceIsEnum === true) reasons.push('Appointment.bookingSource is the BookingSource enum, so later effects are partially present')
  if (report.waitlistClaimedPresent === true) reasons.push('WaitlistStatus has CLAIMED, so later effects are partially present')
  return { ok: reasons.length === 0, reasons }
}

export function evaluateCurrentSchemaPush(stateReport) {
  const reasons = []
  const failedNames = stateReport.failedRecordNames
    || (stateReport.failedRecordCount === 1 && stateReport.failedRecordName ? [stateReport.failedRecordName] : null)
  if (!failedNames || failedNames.some((name) => !MIGRATIONS_TO_BASELINE_AFTER_CURRENT_SCHEMA_PUSH.includes(name))) {
    reasons.push(
      `every failed record must name one of the five baselined migrations, found ${stateReport.failedRecordCount} naming \`${failedNames ? failedNames.join(', ') : stateReport.failedRecordName}\``
    )
  }
  if (stateReport.reviewRequestPresent !== true) {
    reasons.push('the ReviewRequest table is absent, so the current-schema-push shape does not apply')
  }
  if (stateReport.enumValues !== CANONICAL_REVIEW_REQUEST_ENUM_VALUES) {
    reasons.push(`the ReviewRequestStatus enum values are \`${stateReport.enumValues}\`, expected the canonical \`${CANONICAL_REVIEW_REQUEST_ENUM_VALUES}\``)
  }
  if (
    !stateReport.reviewRequestColumns
    || stateReport.reviewRequestColumns.join(',') !== CANONICAL_REVIEW_REQUEST_COLUMNS.join(',')
  ) {
    reasons.push(`the ReviewRequest columns are \`${(stateReport.reviewRequestColumns || []).join(',')}\`, expected the canonical column set`)
  }
  // NOTE: existing rows are intentionally allowed here. Baselining marks the
  // five migrations applied WITHOUT running any SQL, so data in the canonical
  // tables is preserved untouched. (The prototype-shape repair must stop on
  // rows instead: 20261017203707 begins with DROP TABLE "ReviewRequest".)
  if (stateReport.retentionReviewRequestsEnabledPresent !== true) {
    reasons.push('RetentionSettings.reviewRequestsEnabled is absent')
  }
  if (stateReport.laterMigrationsApplied !== 0) {
    reasons.push(`${stateReport.laterMigrationsApplied} of the later migrations are already applied; only the all-pending state is baselineable here`)
  }
  if (stateReport.bookingSourceEnumPresent !== true) reasons.push('the BookingSource enum is absent (20261017203707 effect missing)')
  if (stateReport.reviewRequestSettingsPresent !== true) reasons.push('the ReviewRequestSettings table is absent (20261017203707 effect missing)')
  if (stateReport.customerEmailOptOutPresent !== true) reasons.push('Customer.emailOptOut is absent (20261017203707 effect missing)')
  if (stateReport.notificationReviewRequestPresent !== true) reasons.push("NotificationType lacks REVIEW_REQUEST (20261017203731 effect missing)")
  if (stateReport.appointmentBookingCampaignPresent !== true) reasons.push('Appointment.bookingCampaign is absent (20261017204003 effect missing)')
  if (stateReport.appointmentBookingSourceIsEnum !== true) reasons.push('Appointment.bookingSource is not the BookingSource enum (20261017204003 effect missing)')
  if (stateReport.waitlistClaimedPresent !== true) reasons.push("WaitlistStatus lacks CLAIMED (20261017210000 effect missing)")
  return { ok: reasons.length === 0, reasons }
}

function firstValue(environment, variables) {
  for (const variable of variables) {
    const value = environment[variable]?.trim()
    if (value) return value
  }
  return ''
}

function asHttpsUrl(value) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

export function validateBuildEnvironment(environment) {
  const databaseUrl = firstValue(environment, DATABASE_URL_VARIABLES)
  const secret = environment.NEXTAUTH_SECRET?.trim()
  const deploymentHost = firstValue(environment, ['VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL'])
  const publicAppUrl = firstValue(environment, ['NEXT_PUBLIC_APP_URL'])
    || (deploymentHost ? asHttpsUrl(deploymentHost) : '')
  const authUrl = firstValue(environment, ['NEXTAUTH_URL']) || publicAppUrl
  const missing = []

  if (!databaseUrl) missing.push('DATABASE_URL (or NEON_POSTGRES_PRISMA_URL / NEON_POSTGRES_URL)')
  if (!secret) missing.push('NEXTAUTH_SECRET')
  if (!publicAppUrl) missing.push('NEXT_PUBLIC_APP_URL (or a VERCEL_URL)')
  if (!authUrl) missing.push('NEXTAUTH_URL (or a public app URL)')

  if (missing.length > 0) {
    throw new Error(`Configuration error: set the following Vercel environment variables: ${missing.join(', ')}.`)
  }

  let parsedDatabaseUrl
  try {
    parsedDatabaseUrl = new URL(databaseUrl)
  } catch {
    throw new Error('Configuration error: DATABASE_URL must be a valid PostgreSQL connection URL.')
  }
  if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
    throw new Error('Configuration error: DATABASE_URL must use the PostgreSQL protocol.')
  }

  return {
    ...environment,
    DATABASE_URL: databaseUrl,
    NEXTAUTH_SECRET: secret,
    NEXT_PUBLIC_APP_URL: publicAppUrl,
    NEXTAUTH_URL: authUrl,
  }
}

export function classifyMigrationFailure(output) {
  if (/\bP1000\b/i.test(output)) {
    return { category: 'authentication', retryable: false }
  }
  if (/\bP1003\b/i.test(output)) {
    return { category: 'database configuration', retryable: false }
  }
  if (/\bP1001\b|\bP1002\b/i.test(output)) {
    return { category: 'database connectivity', retryable: true }
  }
  if (/timed out trying to acquire a postgres advisory lock/i.test(output)) {
    return { category: 'migration lock contention', retryable: true }
  }
  if (/\bP3005\b/i.test(output)) {
    return { category: 'schema baseline mismatch', retryable: false }
  }
  if (/\bP3009\b|\bP3018\b/i.test(output)) {
    return { category: 'migration history or SQL failure', retryable: false }
  }
  return { category: 'migration failure', retryable: false }
}

// Extracts the migration Prisma names in its P3009 ("The `x` migration ...
// failed") and P3018 ("Migration name: x" / "Applying migration `x`") outputs so
// the terminal build error identifies exactly which migration needs repair.
export function extractFailedMigrationName(output) {
  const failedRecord = String(output).match(/The `([^`]+)` migration [^\n]*failed/i)
  if (failedRecord) return failedRecord[1]
  const named = String(output).match(/Migration name:\s*(\S+)/i)
  if (named) return named[1]
  const applying = [...String(output).matchAll(/Applying migration `([^`]+)`/gi)]
  if (applying.length > 0) return applying[applying.length - 1][1]
  return ''
}

function redactDatabaseUrl(output, databaseUrl) {
  return String(output).split(databaseUrl).join('[REDACTED DATABASE_URL]')
}

// Parses the single JSON line printed by scripts/check-review-request-state.mjs.
export function parseStateReport(output) {
  const match = String(output).match(/\{.*\}/s)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

function runCommand(command, args, { environment, spawn, label, stdout, stderr }) {
  stdout(`Running ${label}...\n`)
  const result = spawn(command, args, {
    env: environment,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })
  if (result.error) {
    throw new Error(`${label} could not start (dependency failure): ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit status ${result.status ?? 'unknown'}. Review the command output above for diagnostics.`
    )
  }
}

// Read-only diagnostic: surface the database's current migration state before
// deploying so that any deploy failure can be correlated with the exact
// applied/failed migration list visible directly in the build log. This step
// is intentionally non-fatal: `prisma migrate status` legitimately exits
// non-zero for states the deployment below knows how to handle (for example
// the P3009 failed-migration state repaired by the recovery branch), and
// `prisma migrate deploy` below remains the sole gatekeeper for whether the
// build may proceed.
function reportMigrationStatus({ environment, spawn, databaseUrl, stdout, stderr }) {
  stdout('Reporting the database migration state (prisma migrate status)...\n')
  const result = spawn('prisma', ['migrate', 'status'], {
    env: environment,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (result.error) {
    stderr(`The migration-state report was unavailable (prisma could not start): ${result.error.message}\n`)
    return
  }
  if (result.stdout) stdout(redactDatabaseUrl(result.stdout, databaseUrl))
  if (result.stderr) stderr(redactDatabaseUrl(result.stderr, databaseUrl))
  if (!result.stdout && !result.stderr) {
    stderr('The migration-state report returned no output. Continuing with the migration deployment.\n')
  }
}

export async function runVercelBuild({
  environment = process.env,
  spawn = spawnSync,
  sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  stdout = (message) => process.stdout.write(message),
  stderr = (message) => process.stderr.write(message),
} = {}) {
  const buildEnvironment = validateBuildEnvironment(environment)
  const databaseUrl = buildEnvironment.DATABASE_URL
  let migrated = false
  let migrationRecoveryUsed = false
  let preexistingObjectsRecoveryUsed = false

  reportMigrationStatus({ environment: buildEnvironment, spawn, databaseUrl, stdout, stderr })

  for (let attempt = 1; attempt <= MIGRATION_ATTEMPTS; attempt += 1) {
    const result = spawn('prisma', ['migrate', 'deploy'], {
      env: buildEnvironment,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
    if (result.stdout) stdout(redactDatabaseUrl(result.stdout, databaseUrl))
    if (result.stderr) stderr(redactDatabaseUrl(result.stderr, databaseUrl))

    if (result.error) {
      throw new Error(`Prisma migrations could not start (dependency failure): ${result.error.message}`)
    }
    if (result.status === 0) {
      migrated = true
      break
    }

    const failure = classifyMigrationFailure(output)
    stderr(`Prisma migration ${failure.category} failure (attempt ${attempt}/${MIGRATION_ATTEMPTS}).\n`)

    // One-shot recovery for the known repairable P3009 state left by the
    // 2026-10-17 migration conflict (see RECOVERABLE_FAILED_MIGRATION above).
    if (
      !migrationRecoveryUsed
      && /\bP3009\b/i.test(output)
      && output.includes(RECOVERABLE_FAILED_MIGRATION)
    ) {
      migrationRecoveryUsed = true
      stderr(
        `The known recoverable failure for \`${RECOVERABLE_FAILED_MIGRATION}\` is present.\n` +
        'Its SQL rolled back in a transaction when it failed, so it is being marked rolled back\n' +
        'for one clean re-application of the corrected migration.\n'
      )
      const resolveResult = spawn('prisma', ['migrate', 'resolve', '--rolled-back', RECOVERABLE_FAILED_MIGRATION], {
        env: buildEnvironment,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      })
      const resolveOutput = `${resolveResult.stdout || ''}\n${resolveResult.stderr || ''}`
      if (resolveResult.stdout) stdout(redactDatabaseUrl(resolveResult.stdout, databaseUrl))
      if (resolveResult.stderr) stderr(redactDatabaseUrl(resolveResult.stderr, databaseUrl))
      if (resolveResult.error) {
        throw new Error(`Migration recovery could not start (dependency failure): ${resolveResult.error.message}`)
      }
      if (resolveResult.status !== 0) {
        throw new Error(
          `Migration recovery failed with exit status ${resolveResult.status ?? 'unknown'}. ` +
          'Run `prisma migrate resolve --rolled-back ' + RECOVERABLE_FAILED_MIGRATION + '` against the database, then redeploy.'
        )
      }
      continue
    }

    // One-shot evidence-gated recovery for the confirmed 2026-10-18 incident:
    // a failed record for the FIRST review-request migration whose objects
    // already exist from an out-of-band schema push. The read-only
    // verification must prove the exact preconditions before anything is
    // marked applied; otherwise the build stops with the observed evidence.
    if (
      !preexistingObjectsRecoveryUsed
      && (/\bP3009\b/i.test(output) || /\bP3018\b/i.test(output))
      && extractFailedMigrationName(output) === FAILED_MIGRATION_WITH_PREEXISTING_OBJECTS
      && (/\bP3009\b/i.test(output) || /already exists/i.test(output))
    ) {
      preexistingObjectsRecoveryUsed = true
      stderr(
        `A failed record for \`${FAILED_MIGRATION_WITH_PREEXISTING_OBJECTS}\` is present. ` +
        'Verifying the database read-only before any repair (docs/MIGRATION-RECOVERY.md Case B)...\n'
      )
      const verification = spawn('node', [REVIEW_REQUEST_STATE_CHECK_SCRIPT], {
        env: buildEnvironment,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      })
      const verificationOutput = `${verification.stdout || ''}\n${verification.stderr || ''}`
      if (verification.error || verification.status !== 0) {
        throw new Error(
          `The read-only state verification could not run (exit ${verification.status ?? 'unknown'}: ${verification.error?.message || 'see output above'}). ` +
          'Perform the Step 1 checks in docs/MIGRATION-RECOVERY.md against the database before redeploying.'
        )
      }
      const stateReport = parseStateReport(verificationOutput)
      stdout(`${JSON.stringify(stateReport)}\n`)
      if (!stateReport) {
        throw new Error(
          'The read-only state verification returned no report. ' +
          'Perform the Step 1 checks in docs/MIGRATION-RECOVERY.md against the database before redeploying.'
        )
      }
      const evaluation = evaluatePreexistingObjectsRepair(stateReport)
      if (!evaluation.ok) {
        // The prototype shape did not match. The database may instead have
        // been pushed from the CURRENT schema, in which case all five
        // migrations' effects are already present and the honest repair is
        // the Case A baseline. Every fingerprint must pass; otherwise stop
        // with the combined evidence.
        const baseline = evaluateCurrentSchemaPush(stateReport)
        if (!baseline.ok) {
          // Third verified shape: DRAFT-era objects pushed outside migrations.
          // Because none of the five migrations' effects are present, the only
          // correct repair is to clear the failed record, remove the provably
          // empty draft objects, and let the migration apply for real.
          const draft = evaluateDraftObjectsRepair(stateReport)
          if (!draft.ok) {
            throw new Error(
              'The database state matches none of the three verified repairable shapes, so nothing was changed. ' +
              `Prototype-shape evidence: ${evaluation.reasons.join('; ')}. ` +
              `Current-schema-push evidence: ${baseline.reasons.join('; ')}. ` +
              `Draft-objects evidence: ${draft.reasons.join('; ')}. ` +
              'Read the migration-state report above and follow docs/MIGRATION-RECOVERY.md before redeploying.'
            )
          }
          stderr(
            'The database matches the draft-objects shape (docs/MIGRATION-RECOVERY.md Case C): ' +
            'an earlier draft of the review-request feature was pushed outside migrations, holds zero rows, ' +
            'and none of the five migrations\' effects are present. Clearing the failed record, removing the ' +
            'empty draft objects, and re-applying the migration for real — no data exists to lose.\n'
          )
          const rollbackResult = spawn('prisma', ['migrate', 'resolve', '--rolled-back', FAILED_MIGRATION_WITH_PREEXISTING_OBJECTS], {
            env: buildEnvironment,
            encoding: 'utf8',
            shell: process.platform === 'win32',
          })
          if (rollbackResult.stdout) stdout(redactDatabaseUrl(rollbackResult.stdout, databaseUrl))
          if (rollbackResult.stderr) stderr(redactDatabaseUrl(rollbackResult.stderr, databaseUrl))
          if (rollbackResult.error || rollbackResult.status !== 0) {
            throw new Error(
              `Clearing the failed record failed with exit ${rollbackResult.status ?? 'unknown'}. ` +
              'Follow docs/MIGRATION-RECOVERY.md Case C manually before redeploying.'
            )
          }
          const dropResult = spawn('prisma', ['db', 'execute', '--file', DRAFT_OBJECTS_DROP_SQL, '--schema', 'prisma/schema.prisma'], {
            env: buildEnvironment,
            encoding: 'utf8',
            shell: process.platform === 'win32',
          })
          if (dropResult.stdout) stdout(redactDatabaseUrl(dropResult.stdout, databaseUrl))
          if (dropResult.stderr) stderr(redactDatabaseUrl(dropResult.stderr, databaseUrl))
          if (dropResult.error || dropResult.status !== 0) {
            throw new Error(
              `Removing the draft objects failed with exit ${dropResult.status ?? 'unknown'} — nothing else was changed. ` +
              'Follow docs/MIGRATION-RECOVERY.md Case C manually before redeploying.'
            )
          }
          continue
        }
        stderr(
          'The database matches the current schema push (docs/MIGRATION-RECOVERY.md Case A): ' +
          'all five review-request migrations\' effects are already present, so they are being ' +
          'marked applied without running any SQL against the database.\n'
        )
        for (const migration of MIGRATIONS_TO_BASELINE_AFTER_CURRENT_SCHEMA_PUSH) {
          const resolveResult = spawn('prisma', ['migrate', 'resolve', '--applied', migration], {
            env: buildEnvironment,
            encoding: 'utf8',
            shell: process.platform === 'win32',
          })
          const resolveOutput = `${resolveResult.stdout || ''}\n${resolveResult.stderr || ''}`
          if (resolveResult.stdout) stdout(redactDatabaseUrl(resolveOutput, databaseUrl))
          if (resolveResult.stderr) stderr(redactDatabaseUrl(resolveOutput, databaseUrl))
          if (resolveResult.error || resolveResult.status !== 0) {
            throw new Error(
              `Baselining ${migration} failed with exit ${resolveResult.status ?? 'unknown'}. ` +
              'Follow docs/MIGRATION-RECOVERY.md Case A manually before redeploying.'
            )
          }
        }
        continue
      }
      stderr(
        'Verification passed: the failed migration\'s prototype objects are present exactly as migration ' +
        `20261017170000 creates them, the ReviewRequest table holds no rows, and none of the later ` +
        'review-request migrations have applied. Marking the migration as applied so the corrected ' +
        'later migrations can run for real.\n'
      )
      const resolveResult = spawn('prisma', ['migrate', 'resolve', '--applied', FAILED_MIGRATION_WITH_PREEXISTING_OBJECTS], {
        env: buildEnvironment,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      })
      if (resolveResult.stdout) stdout(redactDatabaseUrl(resolveResult.stdout, databaseUrl))
      if (resolveResult.stderr) stderr(redactDatabaseUrl(resolveResult.stderr, databaseUrl))
      if (resolveResult.error) {
        throw new Error(`Migration recovery could not start (dependency failure): ${resolveResult.error.message}`)
      }
      if (resolveResult.status !== 0) {
        throw new Error(
          `Migration recovery failed with exit status ${resolveResult.status ?? 'unknown'}. ` +
          'Run `prisma migrate resolve --applied ' + FAILED_MIGRATION_WITH_PREEXISTING_OBJECTS + '` against the database, then redeploy.'
        )
      }
      continue
    }

    const delay = MIGRATION_RETRY_DELAYS_MS[attempt - 1]
    if (!failure.retryable || delay === undefined) {
      const failedMigration = extractFailedMigrationName(output)
      const detail = failedMigration
        ? ` The failing migration is \`${failedMigration}\`.`
        : ''
      throw new Error(
        `Prisma migrate deploy stopped after a ${failure.category} failure.${detail} ` +
        'Read the migration-state report above, then follow docs/MIGRATION-RECOVERY.md to ' +
        'classify the database state and repair it with evidence before redeploying.'
      )
    }

    stderr(`Retrying the transient ${failure.category} failure in ${delay / 1000}s.\n`)
    await sleep(delay)
  }

  if (!migrated) {
    throw new Error('Prisma migrate deploy did not complete; the application build was not started.')
  }

  runCommand('prisma', ['generate'], {
    environment: buildEnvironment,
    spawn,
    label: 'Prisma Client generation',
    stdout,
    stderr,
  })
  runCommand('next', ['build'], {
    environment: buildEnvironment,
    spawn,
    label: 'Next.js production build (TypeScript and compiler checks)',
    stdout,
    stderr,
  })
}

async function main() {
  if (process.argv[2] === '--validate-only') {
    validateBuildEnvironment(process.env)
    console.log('Vercel build configuration is valid.')
    return
  }
  await runVercelBuild()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Vercel build failed with an unknown error.')
    process.exitCode = 1
  })
}

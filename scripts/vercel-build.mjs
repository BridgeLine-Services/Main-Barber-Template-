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

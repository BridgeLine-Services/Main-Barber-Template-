import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATION_RETRY_DELAYS_MS = [2_000, 5_000, 10_000]
const MIGRATION_ATTEMPTS = MIGRATION_RETRY_DELAYS_MS.length + 1
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
    const delay = MIGRATION_RETRY_DELAYS_MS[attempt - 1]
    if (!failure.retryable || delay === undefined) {
      throw new Error(`Prisma migrate deploy stopped after a ${failure.category} failure.`)
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

import { spawnSync } from 'node:child_process'

const databaseUrl = process.env.DATABASE_URL?.trim()
  || process.env.NEON_POSTGRES_PRISMA_URL?.trim()
  || process.env.NEON_POSTGRES_URL?.trim()

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for Vercel migrations. Configure DATABASE_URL or a Neon Prisma URL in the Vercel project.')
}

const env = { ...process.env, DATABASE_URL: databaseUrl }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Serverless builds from rapid successive pushes can overlap, and canceled
// builds can leave lingering database sessions that still hold Prisma's
// migration advisory lock (pg_advisory_lock(72707369)). Neon cold starts can
// also exceed the default 10s lock-acquisition timeout. All of these are
// transient: retry instead of failing the whole deployment.
const TRANSIENT_DB_ERRORS = [
  'P1001',
  'P1002',
  'P1003',
  'Timed out trying to acquire a postgres advisory lock',
]
const MIGRATION_ATTEMPTS = Number(process.env.MIGRATION_ATTEMPTS || 5)
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS || 30_000)

function runMigrateDeploy() {
  const result = spawnSync('prisma', ['migrate', 'deploy'], {
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return { ok: result.status === 0, output }
}

async function migrateWithRetry() {
  for (let attempt = 1; attempt <= MIGRATION_ATTEMPTS; attempt++) {
    const { ok, output } = runMigrateDeploy()
    if (ok) return
    const transient = TRANSIENT_DB_ERRORS.some((code) => output.includes(code))
    if (!transient || attempt === MIGRATION_ATTEMPTS) {
      console.error(`prisma migrate deploy failed (attempt ${attempt}/${MIGRATION_ATTEMPTS}).`)
      process.exit(1)
    }
    console.warn(
      `prisma migrate deploy hit a transient database error (attempt ${attempt}/${MIGRATION_ATTEMPTS}). ` +
      `Retrying in ${RETRY_DELAY_MS / 1000}s...`
    )
    await sleep(RETRY_DELAY_MS)
  }
}

await migrateWithRetry()

const commands = [
  ['prisma', ['generate']],
  ['next', ['build']],
]

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { env, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

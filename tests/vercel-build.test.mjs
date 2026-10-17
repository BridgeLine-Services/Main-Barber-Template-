import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyMigrationFailure,
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

test('retries a transient connectivity failure and then completes in order', async () => {
  const harness = createHarness([
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
    const harness = createHarness([{ status: 1, stdout: output, stderr: '' }])
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
    assert.equal(harness.calls.length, 1)
    assert.deepEqual(harness.delays, [])
  }
})

test('bounds retries for transient migration failures', async () => {
  const harness = createHarness(
    Array.from({ length: 4 }, () => ({ status: 1, stdout: 'Error P1001', stderr: '' }))
  )

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
  assert.equal(harness.calls.length, 4)
  assert.deepEqual(harness.delays, [2_000, 5_000, 10_000])
  assert.doesNotMatch(harness.logs.stdout + harness.logs.stderr, /migrate deploy did not complete/)
})

test('stops when Prisma Client generation fails', async () => {
  const harness = createHarness([
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
  assert.equal(harness.calls.length, 2)
})

test('reports Next.js build failures and never reports success', async () => {
  const harness = createHarness([
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
  assert.equal(harness.calls.length, 3)
})

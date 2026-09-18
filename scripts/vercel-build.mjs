import { spawnSync } from 'node:child_process'

const databaseUrl = process.env.DATABASE_URL?.trim()
  || process.env.NEON_POSTGRES_PRISMA_URL?.trim()
  || process.env.NEON_POSTGRES_URL?.trim()

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for Vercel migrations. Configure DATABASE_URL or a Neon Prisma URL in the Vercel project.')
}

const env = { ...process.env, DATABASE_URL: databaseUrl }
const commands = [
  ['prisma', ['migrate', 'deploy']],
  ['prisma', ['generate']],
  ['next', ['build']],
]

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { env, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

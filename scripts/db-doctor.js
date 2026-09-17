const { execFileSync } = require('node:child_process')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()
const run = (command, args) => execFileSync(command, args, { stdio: 'pipe', encoding: 'utf8' })
const checks = []
const pass = (name) => checks.push([name, 'PASS'])
const fail = (name, error) => checks.push([name, 'FAIL', error.message.split('\n')[0]])

async function main() {
  console.log('\nBARBER TEMPLATE DATABASE DOCTOR\n')
  if (process.env.DATABASE_URL) pass('Environment')
  else checks.push(['Environment', 'FAIL', 'DATABASE_URL is missing'])

  try { await prisma.$queryRaw`SELECT 1`; pass('Connection') } catch (error) { fail('Connection', error) }
  try { run('npx', ['prisma', 'validate']); pass('Prisma schema') } catch (error) { fail('Prisma schema', error) }
  try { run('npx', ['prisma', 'migrate', 'status']); pass('Migration status') } catch (error) { fail('Migration status', error) }
  try { run('node', ['scripts/verify-database.js']); pass('Required tables and columns') } catch (error) { fail('Required tables and columns', error) }

  for (const [name, status, detail] of checks) console.log(`${name.padEnd(29, '.')} ${status}${detail ? ` — ${detail}` : ''}`)
  const failed = checks.some(([, status]) => status === 'FAIL')
  console.log(`\nDatabase health: ${failed ? 'UNHEALTHY' : 'HEALTHY'}\n`)
  if (failed) process.exitCode = 1
}

main().catch((error) => { console.error(`Doctor failed: ${error.message}`); process.exitCode = 1 }).finally(() => prisma.$disconnect())

#!/usr/bin/env npx tsx
/**
 * client:preflight — the check that must pass BEFORE the first owner registers.
 *
 * The Factory Launch Console already reported Redis health, but reaching it
 * required being an authenticated owner, so an owner blocked by missing Redis
 * configuration could not get in to find out why. This runs outside the app, on
 * the operator's machine or in CI, and answers one question in plain language:
 * is this deployment safe to open for first-owner registration?
 *
 * Never prints secrets. Exit code 0 = safe, 1 = blocked.
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync, existsSync } from 'node:fs'
import { evaluateVar, getEnvSpec, isPresent, resolveEffective, type EnvName } from '../src/lib/env-registry'

const args = process.argv.slice(2)
const environment = (args.find((a) => a.startsWith('--environment='))?.split('=')[1] ?? 'production') as EnvName

interface Check { name: string; ok: boolean; detail: string; blocker: boolean }

async function checkDatabase(): Promise<Check> {
  const url = resolveEffective('DATABASE_URL').value
  const evaluation = evaluateVar(getEnvSpec('DATABASE_URL')!, { environment })
  if (!url || evaluation.status === 'INVALID') {
    return { name: 'Database connection', ok: false, blocker: true, detail: 'DATABASE_URL is missing or not a postgresql:// address' }
  }
  const client = new PrismaClient({ datasourceUrl: url })
  try {
    const schema = await client.$queryRaw<Array<{ has_business: boolean }>>`SELECT to_regclass('public."Business"') IS NOT NULL AS has_business`
    if (!schema[0]?.has_business) {
      return { name: 'Database connection', ok: false, blocker: true, detail: 'connected, but the schema is not applied (no Business table) — run prisma migrate deploy' }
    }
    const migrations = await client.$queryRaw<Array<{ failed: bigint }>>`
      SELECT COUNT(*) AS failed FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`
    const failed = Number(migrations[0]?.failed ?? 0)
    if (failed > 0) {
      return { name: 'Database connection', ok: false, blocker: true, detail: `${failed} migration(s) did not finish — resolve before opening registration` }
    }
    return { name: 'Database connection', ok: true, blocker: true, detail: 'connected, schema present, no unfinished migrations' }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const safe = /ENOTFOUND/.test(message) ? 'host not found' : /password|authentication/i.test(message) ? 'authentication failed' : 'connection refused or timed out'
    return { name: 'Database connection', ok: false, blocker: true, detail: `cannot connect: ${safe}` }
  } finally {
    await client.$disconnect().catch(() => {})
  }
}

async function checkRedis(): Promise<Check> {
  const url = resolveEffective('UPSTASH_REDIS_REST_URL').value
  const token = resolveEffective('UPSTASH_REDIS_REST_TOKEN').value
  if (!url || !token) {
    return { name: 'Rate-limit store (Upstash)', ok: false, blocker: true, detail: 'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must both be set; without them registration answers 503 for everyone' }
  }
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/ping`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) })
    const text = (await response.text()).toUpperCase()
    if (response.ok && text.includes('PONG')) return { name: 'Rate-limit store (Upstash)', ok: true, blocker: true, detail: 'PING succeeded' }
    return { name: 'Rate-limit store (Upstash)', ok: false, blocker: true, detail: `store answered ${response.status} without PONG` }
  } catch {
    return { name: 'Rate-limit store (Upstash)', ok: false, blocker: true, detail: 'no response from the store' }
  }
}

function checkSecret(name: string, minLength: number, label: string): Check {
  const evaluation = evaluateVar(getEnvSpec(name)!, { environment })
  if (evaluation.status === 'CONFIGURED' || evaluation.status === 'WARNING' || evaluation.status === 'VERIFIED') {
    return { name: label, ok: true, blocker: true, detail: 'present' }
  }
  return { name: label, ok: false, blocker: true, detail: `${name} is missing or too weak (needs at least ${minLength} characters)` }
}

function checkPublicUrl(): Check {
  const evaluation = evaluateVar(getEnvSpec('NEXTAUTH_URL')!, { environment })
  if (evaluation.status === 'CONFIGURED' || evaluation.status === 'WARNING') {
    return { name: 'Public application URL', ok: true, blocker: true, detail: evaluation.source === 'NEXTAUTH_URL' ? 'set' : `derived from ${evaluation.source}` }
  }
  return { name: 'Public application URL', ok: false, blocker: true, detail: 'NEXTAUTH_URL is missing and could not be derived' }
}

function checkEnvFile(): Check {
  const present = existsSync('.env.example')
  if (!present) return { name: 'Environment template', ok: false, blocker: false, detail: '.env.example is missing' }
  const text = readFileSync('.env.example', 'utf8')
  const documented = [...text.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1])
  const missingFromTemplate = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'NEXTAUTH_SECRET'].filter((name) => !documented.includes(name))
  return missingFromTemplate.length === 0
    ? { name: 'Environment template', ok: true, blocker: false, detail: `${documented.length} variables documented` }
    : { name: 'Environment template', ok: false, blocker: false, detail: `not documented in .env.example: ${missingFromTemplate.join(', ')}` }
}

async function main() {
  console.log(`\nPre-registration preflight — ${environment}\n`)
  const checks: Check[] = [
    await checkDatabase(),
    checkSecret('NEXTAUTH_SECRET', 32, 'Session signing secret'),
    checkPublicUrl(),
    await checkRedis(),
    checkEnvFile(),
  ]

  for (const check of checks) {
    console.log(`  ${check.ok ? '✅' : check.blocker ? '❌' : '⚠️ '} ${check.name.padEnd(30)} ${check.detail}`)
  }

  const blockers = checks.filter((c) => c.blocker && !c.ok)
  const optionalIssues = checks.filter((c) => !c.blocker && !c.ok)

  if (isPresent(process.env.TWO_FACTOR_ENCRYPTION_KEY) === false && process.env.REQUIRE_OWNER_2FA === 'true') {
    blockers.push({ name: '2FA encryption key', ok: false, blocker: true, detail: 'REQUIRE_OWNER_2FA is on but TWO_FACTOR_ENCRYPTION_KEY is missing, so enrolment would fail' })
  }

  if (blockers.length === 0) {
    console.log('\n✅ Safe to open first-owner registration.')
    if (optionalIssues.length) console.log(`   ${optionalIssues.length} non-blocking note(s) above.`)
    process.exit(0)
  }

  console.log('\n❌ NOT safe to open registration yet:')
  for (const blocker of blockers) console.log(`   • ${blocker.name}: ${blocker.detail}`)
  console.log('\nOpening registration now would show customers a setup problem dressed up as a rate limit.')
  process.exit(1)
}

main().catch((error) => { console.error('preflight failed:', error instanceof Error ? error.message : error); process.exit(1) })

#!/usr/bin/env npx tsx
/**
 * env:check  — a safe inventory of every known variable and its status.
 * env:doctor — the same, plus connectivity probes against the real services.
 *
 * Never prints a secret, never sends a customer message and never moves money.
 * `--deep` adds read-only provider reachability checks (Stripe balance read, SMTP
 * handshake, observability endpoint) and is opt-in because it touches the network.
 */
import { PrismaClient } from '@prisma/client'
import {
  ENV_REGISTRY, describeValue, evaluateAll, isPresent, normalizeEnvironment, resolveEffective,
  type EnvEvaluation, type EnvName,
} from '../src/lib/env-registry'

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const deep = args.includes('--deep')
const checkOnly = args.includes('--check')
const envArg = args.find((a) => a.startsWith('--environment='))?.split('=')[1] as EnvName | undefined

const ICON: Record<string, string> = {
  CONFIGURED: '✅', VERIFIED: '✅', NOT_REQUIRED: '·', DISABLED: '·', PLATFORM_MANAGED: '·',
  WARNING: '⚠️ ', MISSING: '❌', INVALID: '❌', UNREACHABLE: '❌', RETIRED: '⌫',
}

async function probeDatabase(url: string): Promise<{ status: 'VERIFIED' | 'UNREACHABLE' | 'INVALID'; detail: string }> {
  // Reuse the generated Prisma client rather than adding a second database
  // driver: one connection stack, one set of SSL rules.
  const client = new PrismaClient({ datasourceUrl: url })
  try {
    await client.$queryRaw`SELECT 1`
    return { status: 'VERIFIED', detail: 'connected' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Host names and credentials must not travel into logs or the report.
    const safe = /ENOTFOUND/.test(message) ? 'host not found' : /password|authentication/i.test(message) ? 'authentication failed' : 'connection refused or timed out'
    return { status: 'UNREACHABLE', detail: safe }
  } finally {
    await client.$disconnect().catch(() => {})
  }
}

async function probeRedis(url: string, token: string): Promise<{ status: 'VERIFIED' | 'UNREACHABLE' | 'INVALID'; detail: string }> {
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return { status: 'UNREACHABLE', detail: `store answered ${response.status}` }
    const text = (await response.text()).trim().toUpperCase()
    return text.includes('PONG') ? { status: 'VERIFIED', detail: 'PING succeeded' } : { status: 'INVALID', detail: 'endpoint answered but not as Redis REST' }
  } catch {
    return { status: 'UNREACHABLE', detail: 'no response from the rate-limit store' }
  }
}

async function probeStripe(key: string): Promise<{ status: 'VERIFIED' | 'UNREACHABLE' | 'INVALID'; detail: string }> {
  try {
    const res = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
    })
    if (res.ok) return { status: 'VERIFIED', detail: key.startsWith('sk_test_') ? 'test-mode key accepted' : 'live key accepted' }
    if (res.status === 401) return { status: 'INVALID', detail: 'key rejected by Stripe' }
    return { status: 'UNREACHABLE', detail: `Stripe answered ${res.status}` }
  } catch {
    return { status: 'UNREACHABLE', detail: 'could not reach Stripe' }
  }
}

async function probeSmtp(host: string, port: number): Promise<{ status: 'VERIFIED' | 'UNREACHABLE'; detail: string }> {
  return new Promise((resolve) => {
    const socket = require('node:net').connect({ host, port, timeout: 8000 })
    const finish = (result: { status: 'VERIFIED' | 'UNREACHABLE'; detail: string }) => { socket.destroy(); resolve(result) }
    socket.once('connect', () => finish({ status: 'VERIFIED', detail: 'mail server accepted a connection' }))
    socket.once('timeout', () => finish({ status: 'UNREACHABLE', detail: 'connection timed out' }))
    socket.once('error', () => finish({ status: 'UNREACHABLE', detail: 'connection refused' }))
  })
}

async function main() {
  const environment = envArg ?? normalizeEnvironment(process.env)
  let evaluations: EnvEvaluation[] = evaluateAll({ environment })

  if (!checkOnly) {
    const redisUrl = resolveEffective('UPSTASH_REDIS_REST_URL').value
    const redisToken = resolveEffective('UPSTASH_REDIS_REST_TOKEN').value
    const dbUrl = resolveEffective('DATABASE_URL').value

    evaluations = await Promise.all(evaluations.map(async (evaluation) => {
      const { spec } = evaluation
      if (!evaluation.required && evaluation.status !== 'CONFIGURED') return evaluation

      if (spec.name === 'DATABASE_URL' && dbUrl) {
        const probe = await probeDatabase(dbUrl)
        return { ...evaluation, status: probe.status, detail: probe.detail }
      }
      if (spec.name === 'UPSTASH_REDIS_REST_URL' || spec.name === 'UPSTASH_REDIS_REST_TOKEN') {
        if (!redisUrl || !redisToken) {
          // A half-configured pair is worse than none: it looks set up.
          return { ...evaluation, status: 'INVALID', detail: 'only one of the two Upstash values is set; both are required' }
        }
        const probe = await probeRedis(redisUrl, redisToken)
        return { ...evaluation, status: probe.status, detail: probe.detail }
      }
      if (deep && spec.name === 'STRIPE_SECRET_KEY' && evaluation.status === 'CONFIGURED') {
        const probe = await probeStripe(resolveEffective('STRIPE_SECRET_KEY').value!)
        return { ...evaluation, status: probe.status, detail: probe.detail }
      }
      if (deep && spec.name === 'SMTP_HOST' && evaluation.status === 'CONFIGURED') {
        const port = Number(resolveEffective('SMTP_PORT').value ?? 587)
        const probe = await probeSmtp(evaluation.spec.name === 'SMTP_HOST' ? resolveEffective('SMTP_HOST').value! : '', port)
        return { ...evaluation, status: probe.status, detail: probe.detail }
      }
      return evaluation
    }))
  }

  const blocking = evaluations.filter((e) => (e.status === 'MISSING' || e.status === 'INVALID' || e.status === 'UNREACHABLE') && e.required)

  if (asJson) {
    console.log(JSON.stringify({
      environment,
      generatedAt: new Date().toISOString(),
      variables: evaluations.map((e) => ({
        name: e.spec.name, category: e.spec.category, status: e.status, required: e.required,
        secret: e.spec.secret, source: e.source, detail: e.detail,
      })),
      summary: { total: evaluations.length, blocking: blocking.map((e) => e.spec.name) },
    }, null, 2))
    process.exit(blocking.length === 0 ? 0 : 1)
  }

  console.log(`\nEnvironment ${checkOnly ? 'inventory' : 'diagnosis'} — ${environment}${deep ? ' (deep)' : ''}\n`)
  const categories = [...new Set(ENV_REGISTRY.map((s) => s.category))]
  for (const category of categories) {
    const rows = evaluations.filter((e) => e.spec.category === category)
    if (rows.length === 0) continue
    console.log(category)
    for (const row of rows) {
      const value = row.spec.secret ? describeValue(row.spec, resolveEffective(row.spec.name).value) : describeValue(row.spec, resolveEffective(row.spec.name).value)
      const note = row.detail ? `  — ${row.detail}` : ''
      const required = row.required ? ' [required]' : ''
      console.log(`  ${ICON[row.status] ?? ' '} ${row.spec.name.padEnd(32)} ${String(row.status).padEnd(16)} ${value}${required}${note}`)
    }
    console.log('')
  }

  if (!checkOnly) {
    const redisReady = evaluations.find((e) => e.spec.name === 'UPSTASH_REDIS_REST_URL')?.status === 'VERIFIED'
    console.log(redisReady
      ? 'Rate limiting: shared store verified. First-owner registration may proceed.'
      : 'Rate limiting: NOT verified. Owner registration will answer 503 until the Upstash store is reachable — this is deliberate, not a rate limit.')
  }

  if (blocking.length === 0) {
    console.log('\nNo blocking problems found.')
    process.exit(0)
  }
  console.error(`\nBlocking problems (${blocking.length}):`)
  for (const item of blocking) console.error(`  • ${item.spec.name} — ${item.status}: ${item.detail ?? item.spec.howToFix}`)
  process.exit(1)
}

main().catch((error) => { console.error('env doctor failed:', error instanceof Error ? error.message : error); process.exit(1) })

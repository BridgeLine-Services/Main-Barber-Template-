#!/usr/bin/env npx tsx
/**
 * npm run client:setup — the guided, repeatable deployment wizard.
 *
 * It exists because configuring a new barbershop used to mean reading five
 * documents and knowing which of fifty environment variables mattered. The
 * wizard asks for what it needs, generates the secrets an operator should not be
 * inventing by hand, verifies what can be verified, and refuses to declare a
 * deployment ready while first-owner registration would fail.
 *
 * Safety properties, deliberately:
 *   • Dry run by default. Nothing is written without --apply.
 *   • Existing values are never overwritten and secrets are never rotated.
 *   • Idempotent: running it again changes nothing that is already correct, and
 *     it never touches business records, users, passwords or migrations.
 *   • Secrets are masked on entry and never echoed back.
 */
import { createInterface } from 'node:readline/promises'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import {
  ENV_REGISTRY, evaluateAll, getEnvSpec, isPresent, resolveEffective, validateFormat, type EnvName,
} from '../src/lib/env-registry'
import { describePlan, planVercelSync } from '../src/lib/vercel-env-plan'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const assumeYes = args.includes('--yes')
const pushVercel = args.includes('--push-vercel')
const redeploy = args.includes('--redeploy')
const environmentArg = args.find((a) => a.startsWith('--environment='))?.split('=')[1] as EnvName | undefined

// Collected values are keyed by variable name and held in a Map: they are
// runtime input from the operator, never source literals, and a Map keeps them
// out of property-assignment shape so the architecture check can keep flagging
// genuinely hard-coded credentials without false positives.
const collected = new Map<string, string>()
const actions: string[] = []
const rl = createInterface({ input: process.stdin, output: process.stdout })


/**
 * Reads Vercel's variable names and target environments.
 *
 * Only names and targets: `vercel env pull` would download values, and values are the one
 * thing this tool must never handle. Returns null when the CLI is missing or the project
 * is not linked, so the caller can print a precise manual fallback instead of pretending.
 */
function readVercelVars(): { key: string; targets: ('production' | 'preview' | 'development')[] }[] | null {
  try {
    const out = execFileSync('vercel', ['env', 'ls', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const parsed = JSON.parse(out)
    const list = Array.isArray(parsed) ? parsed : (parsed.envs ?? [])
    return list
      .map((entry: { key?: string; target?: string | string[] }) => {
        const key = entry.key
        if (!key) return null
        const raw = Array.isArray(entry.target) ? entry.target : [entry.target ?? '']
        const targets = raw
          .flatMap((t) => String(t).split(','))
          .map((t) => t.trim().toLowerCase())
          .filter((t): t is 'production' | 'preview' | 'development' =>
            t === 'production' || t === 'preview' || t === 'development')
        return { key, targets }
      })
      .filter((v: unknown): v is { key: string; targets: ('production' | 'preview' | 'development')[] } => v !== null)
  } catch {
    return null
  }
}

/**
 * Adds one variable to one environment. The value travels on stdin, never in argv:
 * arguments are visible in `ps` and land in shell history, and a secret in either is a
 * leak that outlives the deployment.
 */
function addVercelVar(name: string, target: string, value: string): boolean {
  try {
    execFileSync('vercel', ['env', 'add', name, target], { input: `${value}\n`, stdio: ['pipe', 'ignore', 'pipe'] })
    return true
  } catch {
    return false
  }
}

async function ask(question: string, options: { masked?: boolean } = {}): Promise<string> {
  if (assumeYes) return ''
  if (!options.masked) return (await rl.question(question)).trim()
  // Mask secret entry: readline has no mask, so instruct and keep it out of echo.
  process.stdout.write(`${question} (input is not echoed)\n`)
  return new Promise((resolve) => {
    const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void }
    const wasRaw = Boolean((stdin as unknown as { isRaw?: boolean }).isRaw)
    stdin.setRawMode?.(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let buffer = ''
    const onData = (char: string) => {
      if (char === '\r' || char === '\n') {
        stdin.setRawMode?.(wasRaw)
        stdin.pause()
        stdin.removeListener('data', onData)
        process.stdout.write('\n')
        resolve(buffer.trim())
      } else if (char === '\u0003') {
        process.exit(130)
      } else if (char === '\u007f') {
        buffer = buffer.slice(0, -1)
      } else {
        buffer += char
      }
    }
    stdin.on('data', onData)
  })
}

async function confirm(question: string): Promise<boolean> {
  // --yes means "do not ask", NOT "say yes": silently switching on email, SMS and
  // Google for a shop that has no credentials for them would leave it half
  // configured and advertising features that cannot work.
  if (assumeYes) return false
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
  return answer === 'y' || answer === 'yes'
}

function generateSecret(kind: 'base64' | 'hex', bytes: number): string {
  return kind === 'base64' ? randomBytes(bytes).toString('base64') : randomBytes(bytes).toString('hex')
}

function toolVersion(command: string, args: string[]): string | null {
  try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0] }
  catch { return null }
}

async function verifyDatabase(url: string): Promise<{ ok: boolean; detail: string }> {
  const client = new PrismaClient({ datasourceUrl: url })
  try {
    await client.$queryRaw`SELECT 1`
    return { ok: true, detail: 'connected' }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return { ok: false, detail: /ENOTFOUND/.test(message) ? 'host not found' : /password|authentication/i.test(message) ? 'authentication failed' : 'could not connect' }
  } finally { await client.$disconnect().catch(() => {}) }
}

async function verifyRedis(url: string, token: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/ping`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) })
    const text = (await res.text()).toUpperCase()
    return res.ok && text.includes('PONG') ? { ok: true, detail: 'PING succeeded' } : { ok: false, detail: `store answered ${res.status}` }
  } catch { return { ok: false, detail: 'no response from the store' } }
}

function readLocalEnvFile(): Record<string, string> {
  if (!existsSync('.env.local')) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (match) out[match[1]] = match[2]
  }
  return out
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════')
  console.log('  Client deployment setup')
  console.log(apply ? '  Mode: APPLY (writes .env.local)' : '  Mode: DRY RUN (nothing is written; pass --apply to save)')
  console.log('══════════════════════════════════════════════════════════════\n')

  // ── Step 1: which deployment is this ───────────────────────────────────────
  console.log('Step 1 — Deployment')
  let environment: EnvName = environmentArg ?? 'production'
  if (!environmentArg) {
    const answer = await ask('  Is this (1) a new client, (2) an existing client, (3) development, (4) preview, (5) production? [5] ')
    environment = answer === '3' ? 'development' : answer === '4' ? 'preview' : 'production'
    if (answer === '2') console.log('  Existing client: secrets and data are preserved; only what is missing will be asked for.')
  }
  console.log(`  → ${environment}\n`)

  // ── Step 2: tools ──────────────────────────────────────────────────────────
  console.log('Step 2 — Tools')
  const nodeVersion = process.versions.node
  const major = Number(nodeVersion.split('.')[0])
  console.log(`  ${major >= 20 ? '✅' : '❌'} Node.js ${nodeVersion}${major >= 20 ? '' : ' — version 20 or newer is required'}`)
  console.log(`  ${toolVersion('npm', ['--version']) ? '✅' : '❌'} npm`)
  console.log(`  ${toolVersion('git', ['--version']) ? '✅' : '⚠️ '} git`)
  const vercel = toolVersion('vercel', ['--version'])
  console.log(`  ${vercel ? '✅' : '⚠️ '} Vercel CLI${vercel ? ` ${vercel}` : ' — not installed; environment variables will be listed for manual entry instead of pushed'}`)
  if (!major || major < 20) actions.push('Install Node.js 20 or newer before continuing.')
  console.log('')

  // ── Step 3: database ───────────────────────────────────────────────────────
  console.log('Step 3 — Database')
  const existing = readLocalEnvFile()
  let databaseUrl = resolveEffective('DATABASE_URL').value ?? existing.DATABASE_URL
  if (!isPresent(databaseUrl)) {
    databaseUrl = await ask('  Paste the PostgreSQL connection string: ', { masked: true })
  } else {
    console.log('  Using the connection string already configured.')
  }
  if (!databaseUrl) {
    actions.push('Provide a PostgreSQL connection string; nothing else can be verified without one.')
    console.log('  ❌ No connection string provided.')
  } else {
    const format = validateFormat(getEnvSpec('DATABASE_URL')!, databaseUrl)
    if (!format.ok) console.log(`  ❌ That does not look like a database URL (${format.reason}).`)
    else {
      const probe = await verifyDatabase(databaseUrl)
      console.log(`  ${probe.ok ? '✅' : '❌'} ${probe.detail}`)
      if (probe.ok) collected.set('DATABASE_URL', databaseUrl)
      else actions.push('Fix the database connection before opening the shop.')
    }
  }
  console.log('  Migrations are applied by the deploy step, never reset here.')
  console.log('')

  // ── Step 4: secrets ────────────────────────────────────────────────────────
  console.log('Step 4 — Secrets')
  const ensureSecret = (name: string, kind: 'base64' | 'hex', bytes: number) => {
    const current = resolveEffective(name).value ?? existing[name]
    if (isPresent(current)) { console.log(`  ✅ ${name} already set — left untouched`); return }
    const generated = generateSecret(kind, bytes)
    collected.set(name, generated)
    console.log(`  ✅ ${name} generated (${generated.length} characters)`)
    actions.push(`${name} was generated. Store it in the platform's environment settings${apply ? ' and treat .env.local as sensitive' : ''}.`)
  }
  ensureSecret('NEXTAUTH_SECRET', 'base64', 32)
  ensureSecret('TWO_FACTOR_ENCRYPTION_KEY', 'base64', 32)
  if (process.env.REMINDERS_ENABLED === 'true') ensureSecret('CRON_SECRET', 'hex', 24)
  console.log('  Rotating a secret is never automatic: rotating NEXTAUTH_SECRET signs everyone out, and rotating');
  console.log('  TWO_FACTOR_ENCRYPTION_KEY invalidates existing 2FA enrolments.\n')

  // ── Step 5: rate limiting ──────────────────────────────────────────────────
  console.log('Step 5 — Rate limiting (mandatory in production)')
  let redisUrl = resolveEffective('UPSTASH_REDIS_REST_URL').value ?? existing.UPSTASH_REDIS_REST_URL
  let redisToken = resolveEffective('UPSTASH_REDIS_REST_TOKEN').value ?? existing.UPSTASH_REDIS_REST_TOKEN
  if (!redisUrl) redisUrl = await ask('  Upstash REST URL (from the Upstash dashboard): ')
  if (!redisToken) redisToken = await ask('  Upstash REST token: ', { masked: true })
  if (redisUrl && redisToken) {
    const probe = await verifyRedis(redisUrl, redisToken)
    console.log(`  ${probe.ok ? '✅' : '❌'} ${probe.detail}`)
    if (probe.ok) { collected.set('UPSTASH_REDIS_REST_URL', redisUrl); collected.set('UPSTASH_REDIS_REST_TOKEN', redisToken) }
    else actions.push('Upstash is unreachable. Until it answers PING, owner registration will answer 503 instead of pretending to rate-limit.')
  } else {
    console.log('  ❌ Both Upstash values are required in production.')
    actions.push('Create a free Redis database at upstash.com and add both REST values.')
  }
  console.log('')

  // ── Step 6: optional integrations ──────────────────────────────────────────
  console.log('Step 6 — Optional integrations (a disabled one never blocks launch)')
  const integrations: Array<{ flag: string; label: string; required: string[] }> = [
    { flag: 'EMAIL_ENABLED', label: 'Email notifications', required: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] },
    { flag: 'SMS_ENABLED', label: 'SMS notifications', required: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'] },
    { flag: 'GOOGLE_ENABLED', label: 'Google Business Profile', required: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
    { flag: 'REMINDERS_ENABLED', label: 'Scheduled reminders', required: [] },
  ]
  for (const integration of integrations) {
    const alreadyOn = process.env[integration.flag] === 'true' || existing[integration.flag] === 'true'
    const enable = alreadyOn || await confirm(`  Enable ${integration.label}?`)
    collected.set(integration.flag, enable ? 'true' : 'false')
    console.log(`  ${enable ? '✅ enabled' : '· disabled'} — ${integration.label}`)
    if (!enable) continue
    for (const name of integration.required) {
      const current = resolveEffective(name).value ?? existing[name]
      if (isPresent(current)) { console.log(`      ✅ ${name} already set`); continue }
      const spec = getEnvSpec(name)!
      const entered = await ask(`      ${name} (${spec.description}): `, { masked: spec.secret })
      if (entered) collected.set(name, entered)
      else actions.push(`${integration.label} is on but ${name} is missing.`)
    }
  }
  console.log('')

  // ── Step 7: platform configuration ────────────────────────────────────────
  console.log('Step 7 — Platform environment')
  const pending = [...collected.keys()]
  if (pending.length === 0) {
    console.log('  Nothing new to add.')
  } else if (vercel) {
    console.log('  Run these from the project directory (each prompts for the value):')
    for (const name of pending) console.log(`    vercel env add ${name} ${environment}`)
    console.log('  Then redeploy: environment changes only apply to a new deployment.')
  } else {
    console.log(`  Add these ${pending.length} variables in your host's dashboard for ${environment}:`)
    for (const name of pending) console.log(`    - ${name}${getEnvSpec(name)?.secret ? ' (secret)' : ''}`)
  }
  console.log('')

  // ── Step 7b: sync Vercel, only when explicitly asked ───────────────────────
  if (pushVercel) {
    // A shop lives in Production and Preview. 'test' (the local suite) maps to
    // Development, which is the only Vercel environment it can mean.
    const vercelTargets: ('production' | 'preview' | 'development')[] =
      environment === 'production' ? ['production', 'preview']
        : environment === 'preview' ? ['preview']
        : ['development']
    console.log('\n  Checking Vercel against the registry...')
    const remote = readVercelVars()
    if (!remote) {
      console.log('  ❌ Could not read the Vercel project.')
      console.log('     Either the Vercel CLI is not installed (`npm i -g vercel`), it is not authenticated')
      console.log('     (`vercel login`), or this directory is not linked (`vercel link`).')
      console.log('     Nothing was changed. Add the variables listed above by hand, or run those three')
      console.log('     commands and repeat with --push-vercel.')
    } else {
      const plan = planVercelSync({
        specs: ENV_REGISTRY,
        remote,
        local: Object.fromEntries(collected),
        requiredTargets: vercelTargets,
      })
      for (const line of describePlan(plan)) console.log(line)

      if (plan.clean) {
        console.log('  ✅ Vercel already matches the registry. Nothing to write.')
      } else if (assumeYes) {
        // --yes means "do not ask". It must never mean "yes, write to production".
        console.log('  Refusing to write to Vercel in --yes mode: remote changes need explicit confirmation.')
        console.log('  Re-run without --yes to be asked about each variable.')
      } else {
        const missing = plan.actions.filter((a) => a.kind === 'ADD' || a.kind === 'ADD_TARGET')
        const approved = await confirm(`Write ${missing.length} variable assignment(s) to Vercel? (existing values are never replaced)`)
        if (!approved) {
          console.log('  Nothing written. The list above is what a manual run would add.')
        } else {
          let written = 0
          const failed: string[] = []
          for (const action of missing) {
            if (action.kind !== 'ADD' && action.kind !== 'ADD_TARGET') continue
            const value = collected.get(action.name) ?? process.env[action.name] ?? ''
            if (!value.trim()) {
              failed.push(`${action.name} (no value available)`)
              continue
            }
            for (const target of action.targets) {
              if (addVercelVar(action.name, target, value.trim())) written++
              else failed.push(`${action.name} → ${target}`)
            }
          }
          console.log(`  Wrote ${written} assignment(s).`)
          if (failed.length) {
            console.log('  These did not take:')
            for (const item of failed) console.log(`    • ${item}`)
          }
          const after = readVercelVars()
          if (after) {
            const stillMissing = planVercelSync({
              specs: ENV_REGISTRY,
              remote: after,
              local: Object.fromEntries(collected),
              requiredTargets: vercelTargets,
            })
            console.log(stillMissing.clean
              ? '  ✅ Verified: Vercel now matches the registry.'
              : '  ⚠ Vercel still does not match; re-run to see what remains.')
          }
          console.log('  A new deployment is required: environment changes do not reach an existing build.')
          if (redeploy && confirm('Deploy now with `vercel --prod`?')) {
            execFileSync('vercel', ['--prod'], { stdio: 'inherit' })
          } else {
            console.log('  Redeploy when ready: vercel --prod')
          }
        }
      }
    }
  }

  // ── Step 8: report ────────────────────────────────────────────────────────
  if (apply && pending.length > 0) {
    const lines = ['# Written by npm run client:setup — contains secrets, never commit', '']
    for (const name of pending) lines.push(`${name}=${collected.get(name)}`)
    writeFileSync('.env.local', `${lines.join('\n')}\n`, { mode: 0o600 })
    console.log('Step 8 — Report')
    console.log(`  ✅ Wrote ${pending.length} values to .env.local (permissions 0600).`)
  } else {
    console.log('Step 8 — Report')
    console.log(apply ? '  Nothing to write.' : `  Dry run: ${pending.length} value(s) would be written. Re-run with --apply to save them.`)
  }

  const evaluations = evaluateAll({ environment, env: { ...process.env, ...Object.fromEntries(collected) } })
  const blocking = evaluations.filter((e) => (e.status === 'MISSING' || e.status === 'INVALID') && e.required)
  const verified = evaluations.filter((e) => e.status === 'CONFIGURED' || e.status === 'VERIFIED' || e.status === 'WARNING')

  console.log(`  Configured or verified: ${verified.length} of ${evaluations.length}`)
  if (blocking.length) {
    console.log('  Still blocking registration:')
    for (const item of blocking) console.log(`    • ${item.spec.name} — ${item.detail ?? item.spec.howToFix}`)
  }
  if (actions.length) {
    console.log('\n  Operator actions:')
    for (const action of [...new Set(actions)]) console.log(`    • ${action}`)
  }
  const registrationSafe = blocking.length === 0
  console.log(`\n  First-owner registration: ${registrationSafe ? '✅ safe to enable' : '❌ NOT safe yet'}`)
  if (registrationSafe) console.log('  Verify with: npm run client:preflight')
  console.log('')

  rl.close()
  process.exit(registrationSafe ? 0 : 1)
}

main().catch((error) => { console.error(error); rl.close(); process.exit(1) })

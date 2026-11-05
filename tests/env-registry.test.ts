/**
 * The environment registry is now the single contract that the runtime checker,
 * the CLIs and the preflight read. These tests protect the contract itself, and
 * encode the exact failures that existed before it: Redis mandatory in production
 * but absent from the inventory, the retired provisioning token still listed, and
 * a whitespace-only value counted as configured.
 *
 * Run: npx tsx tests/env-registry.test.ts
 */

import {
  ENV_REGISTRY, blockingEvaluations, describeValue, evaluateAll, evaluateVar,
  getEnvSpec, isPresent, normalizeEnvironment, resolveEffective,
} from '../src/lib/env-registry'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}
const status = (name: string, env: Record<string, string>, environment: 'production' | 'preview' | 'development' | 'test' = 'production') =>
  evaluateVar(getEnvSpec(name)!, { environment, env: env as Record<string, string | undefined> }).status

const healthy: Record<string, string> = {
  DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/shop?sslmode=require',
  NEXTAUTH_SECRET: 'a'.repeat(48),
  NEXTAUTH_URL: 'https://shop.example.com',
  NEXT_PUBLIC_APP_URL: 'https://shop.example.com',
  UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
  UPSTASH_REDIS_REST_TOKEN: 'token-value-here',
}

console.log('\n📦 The registry is internally consistent')
{
  const names = ENV_REGISTRY.map((s) => s.name)
  assert(new Set(names).size === names.length, 'no variable is declared twice')
  const allowed = new Set(['CORE','SECURITY','DATABASE','STORAGE','PAYMENTS','EMAIL','SMS','GOOGLE','SCHEDULED_TASKS','OBSERVABILITY','TENANT_CONFIGURATION','INTERNAL','DEVELOPMENT_ONLY','PLATFORM_MANAGED','RETIRED'])
  assert(ENV_REGISTRY.every((s) => allowed.has(s.category)), 'every category is one of the fifteen declared')
  assert(ENV_REGISTRY.every((s) => !(s.secret && s.public)), 'no variable is both secret and public')
  assert(ENV_REGISTRY.filter((s) => s.name.startsWith('NEXT_PUBLIC_')).every((s) => !s.secret), 'nothing in NEXT_PUBLIC_* is a secret')
  assert(ENV_REGISTRY.every((s) => s.howToFix.trim().length > 0 && s.howToObtain.trim().length > 0), 'every variable says how to get it and how to fix it')
  assert(ENV_REGISTRY.filter((s) => s.retired).every((s) => s.requiredIn.length === 0), 'retired variables are never required')
  assert(ENV_REGISTRY.filter((s) => s.platformManaged).every((s) => s.requiredIn.length === 0), 'platform-managed variables are never demanded from the operator')
}

console.log('\n📦 The old inventory defects cannot come back')
{
  const names = ENV_REGISTRY.map((s) => s.name)
  for (const must of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'BLOB_READ_WRITE_TOKEN', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWO_FACTOR_ENCRYPTION_KEY', 'REQUIRE_OWNER_2FA', 'CSP_NONCE_ENABLED']) {
    assert(names.includes(must), `${must} is in the inventory`)
  }
  assert(status('UPSTASH_REDIS_REST_URL', { ...healthy, UPSTASH_REDIS_REST_URL: '' }) === 'MISSING', 'Redis is MISSING in production when absent — the bug that broke registration')
  assert(status('UPSTASH_REDIS_REST_TOKEN', { ...healthy, UPSTASH_REDIS_REST_TOKEN: '' }) === 'MISSING', 'a missing Redis token is MISSING, not "configured"')
  const retired = evaluateVar(getEnvSpec('OWNER_PROVISIONING_TOKEN')!, { environment: 'production', env: { OWNER_PROVISIONING_TOKEN: 'x'.repeat(20) } as Record<string, string | undefined> })
  assert(retired.status === 'RETIRED', 'the retired provisioning token is reported as retired')
  assert(retired.required === false, 'and is never required')
}

console.log('\n📦 Presence is not configuration')
{
  assert(!isPresent('   '), 'whitespace alone is not a value')
  assert(status('DATABASE_URL', { ...healthy, DATABASE_URL: '   ' }) === 'MISSING', 'a whitespace-only DATABASE_URL is MISSING')
  assert(status('NEXTAUTH_URL', { ...healthy, NEXTAUTH_URL: 'not-a-url', VERCEL_URL: '' }) === 'INVALID', 'a malformed URL is INVALID, not configured')
  assert(status('NEXTAUTH_SECRET', { ...healthy, NEXTAUTH_SECRET: 'short' }) === 'INVALID', 'a too-short session secret is INVALID')
  assert(status('DATABASE_URL', { ...healthy, DATABASE_URL: 'mysql://x' }) === 'INVALID', 'a non-Postgres URL is INVALID')
  assert(status('SMTP_PORT', { ...healthy, EMAIL_ENABLED: 'true', SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'a@b.co', SMTP_PORT: 'abc' }) === 'INVALID', 'a non-numeric port is INVALID')
}

console.log('\n📦 Aliases and fallbacks count, and are reported as derived')
{
  const viaAlias = { ...healthy, DATABASE_URL: '', NEON_POSTGRES_PRISMA_URL: 'postgresql://u:p@h:5432/d' }
  assert(status('DATABASE_URL', viaAlias) === 'WARNING', 'a database URL supplied through the Neon alias is accepted, with a warning')
  const resolved = resolveEffective('DATABASE_URL', viaAlias as Record<string, string | undefined>)
  assert(resolved.derived && resolved.source === 'NEON_POSTGRES_PRISMA_URL', 'and the report names where the value came from')

  const viaAppUrl = { ...healthy, NEXTAUTH_URL: '' }
  assert(status('NEXTAUTH_URL', viaAppUrl) === 'WARNING', 'the public URL can be derived from NEXT_PUBLIC_APP_URL')
  assert(resolveEffective('NEXTAUTH_URL', viaAppUrl as Record<string, string | undefined>).value === 'https://shop.example.com', 'preferring the explicitly configured public URL')

  const viaVercel = { ...healthy, NEXTAUTH_URL: '', NEXT_PUBLIC_APP_URL: '', VERCEL_URL: 'shop-abc.vercel.app' }
  assert(status('NEXTAUTH_URL', viaVercel) === 'WARNING', 'and from the platform hostname when nothing else is set')
  assert(resolveEffective('NEXTAUTH_URL', viaVercel as Record<string, string | undefined>).value === 'https://shop-abc.vercel.app', 'which is turned into an absolute https URL')
}

console.log('\n📦 A disabled integration never blocks a launch')
{
  assert(status('SMTP_HOST', { ...healthy, EMAIL_ENABLED: 'false' }) === 'NOT_REQUIRED', 'SMTP is not required while email is off')
  assert(status('SMTP_HOST', { ...healthy, EMAIL_ENABLED: 'true' }) === 'MISSING', 'SMTP is required the moment email is switched on')
  assert(status('TWILIO_ACCOUNT_SID', { ...healthy }) === 'NOT_REQUIRED', 'Twilio is not required while SMS is off')
  assert(status('CRON_SECRET', { ...healthy, REMINDERS_ENABLED: 'true' }) === 'MISSING', 'the cron secret is required once reminders are on')
  assert(status('CRON_SECRET', { ...healthy, REMINDERS_ENABLED: 'false' }) === 'NOT_REQUIRED', 'and not before')
  assert(status('STRIPE_WEBHOOK_SECRET', { ...healthy }) === 'NOT_REQUIRED', 'Stripe is not required when no key is configured')
  assert(status('STRIPE_WEBHOOK_SECRET', { ...healthy, STRIPE_SECRET_KEY: 'sk_test_x' }) === 'MISSING', 'but a configured Stripe key makes the webhook secret required')
  assert(status('GOOGLE_CLIENT_ID', { ...healthy, GOOGLE_ENABLED: 'true' }) === 'MISSING', 'enabling Google requires its credentials')
}

console.log('\n📦 A healthy production environment has no blockers')
{
  const blocking = blockingEvaluations({ environment: 'production', env: healthy as Record<string, string | undefined> })
  assert(blocking.length === 0, `no blocking variables in a healthy production setup${blocking.length ? ` (found ${blocking.map((b) => b.spec.name).join(', ')})` : ''}`)
  const broken = blockingEvaluations({ environment: 'production', env: { ...healthy, NEXTAUTH_SECRET: '' } as Record<string, string | undefined> })
  assert(broken.length === 1 && broken[0].spec.name === 'NEXTAUTH_SECRET', 'removing one secret blocks exactly that variable')
}

console.log('\n📦 Test runs are not held to production requirements')
{
  assert(status('UPSTASH_REDIS_REST_URL', { DATABASE_URL: healthy.DATABASE_URL }, 'test') !== 'MISSING', 'CI does not demand a production Redis store')
  assert(status('UPSTASH_REDIS_REST_URL', { DATABASE_URL: healthy.DATABASE_URL }, 'production') === 'MISSING', 'production does')
}

console.log('\n📦 Secrets are described, never printed')
{
  const secretSpec = getEnvSpec('NEXTAUTH_SECRET')!
  const described = describeValue(secretSpec, 'super-secret-value-that-must-not-appear')
  assert(!described.includes('super-secret-value'), 'a secret value is never echoed')
  assert(described.includes('set'), 'but its presence is confirmed')
  assert(describeValue(secretSpec, undefined) === '(unset)', 'an absent secret reads as unset')
  assert(!JSON.stringify(evaluateAll({ environment: 'production', env: healthy as Record<string, string | undefined> })).includes('super-secret'), 'a full evaluation carries no secret values')
}

console.log('\n📦 Environment detection follows the platform')
{
  assert(normalizeEnvironment({ NODE_ENV: 'test' } as Record<string, string | undefined>) === 'test', 'NODE_ENV=test is the test environment')
  assert(normalizeEnvironment({ VERCEL_ENV: 'production' } as Record<string, string | undefined>) === 'production', 'Vercel production is production')
  assert(normalizeEnvironment({ VERCEL_ENV: 'preview' } as Record<string, string | undefined>) === 'preview', 'Vercel preview is preview')
  assert(normalizeEnvironment({} as Record<string, string | undefined>) === 'development', 'a local shell is development')
}

console.log(`\nEnvironment registry: ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)

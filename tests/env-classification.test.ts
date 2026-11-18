/**
 * Part 2.3 of the Neon/configuration directive, pinned.
 *
 * The environment registry is the single authority for whether a value is a secret
 * and whether it may be shipped to the browser. These assertions exist so a future
 * edit cannot quietly mark a credential public, or classify a public URL as secret
 * to look careful.
 */
import { ENV_REGISTRY } from '../src/lib/env-registry'

let passed = 0
let failed = 0
const ok = (name: string, condition: boolean, detail?: unknown) => {
  if (condition) { passed++; return }
  failed++
  console.log('  FAIL', name, detail === undefined ? '' : `(said: ${JSON.stringify(detail)})`)
}

const entry = (name: string) => ENV_REGISTRY.find((e) => e.name === name)

// The directive's classification table, exactly.
const SECRETS = ['DATABASE_URL', 'NEON_POSTGRES_PRISMA_URL', 'NEXTAUTH_SECRET', 'UPSTASH_REDIS_REST_TOKEN']
for (const name of SECRETS) {
  const e = entry(name)
  ok(`${name} is declared`, Boolean(e))
  ok(`${name} is a secret`, e?.secret === true, e?.secret)
  ok(`${name} is never public`, e?.public === false, e?.public)
}

const SERVER_ONLY = ['NEXTAUTH_URL', 'UPSTASH_REDIS_REST_URL']
for (const name of SERVER_ONLY) {
  const e = entry(name)
  ok(`${name} is declared`, Boolean(e))
  ok(`${name} is not a secret (it carries no credential)`, e?.secret === false, e?.secret)
  ok(`${name} is not public`, e?.public === false, e?.public)
}

const PUBLIC = ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_APP_NAME']
for (const name of PUBLIC) {
  const e = entry(name)
  ok(`${name} is declared`, Boolean(e))
  ok(`${name} is public`, e?.public === true, e?.public)
  ok(`${name} is not a secret`, e?.secret === false, e?.secret)
}

// Rules that hold for the whole registry, not just the names above.
const conflicts = ENV_REGISTRY.filter((e) => e.secret && e.public).map((e) => e.name)
ok('no variable is both secret and public', conflicts.length === 0, conflicts)

const publicSecrets = ENV_REGISTRY.filter((e) => e.name.startsWith('NEXT_PUBLIC_') && e.secret).map((e) => e.name)
ok('no NEXT_PUBLIC_ variable is a secret', publicSecrets.length === 0, publicSecrets)

const unnamed = ENV_REGISTRY.filter((e) => !e.name || !e.description || !e.category).map((e) => e.name)
ok('every declared variable has a name, description and category', unnamed.length === 0, unnamed)

const dupes = ENV_REGISTRY.map((e) => e.name).filter((n, i, all) => all.indexOf(n) !== i)
ok('no variable is declared twice', dupes.length === 0, dupes)

// The four values the Neon integration does not supply must be declared, because a
// customer following only the integration would otherwise be missing them silently.
for (const name of ['NEXTAUTH_SECRET', 'NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
  ok(`${name} is declared so setup can ask for it`, Boolean(entry(name)))
}

// A database URL is required in production: an unset one is the difference between a
// working shop and a 500 on every page.
const dbUrl = entry('DATABASE_URL')
ok('DATABASE_URL is required in production', Array.isArray(dbUrl?.requiredIn) && dbUrl!.requiredIn.includes('production'), dbUrl?.requiredIn)

console.log(`\nEnvironment classification: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

/**
 * The database-connection contract has one owner.
 *
 * It had two: src/lib/env-registry.ts accepted DATABASE_URL plus four aliases, while
 * scripts/vercel-build.mjs accepted only three of them. A deployment whose connection
 * arrived as POSTGRES_URL therefore passed every diagnostic the operator could run and
 * then failed to build, which is the worst possible place to discover a config error.
 *
 * Both now read config/db-url-aliases.json, and these tests are what keeps it that way.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DB_URL_ALIASES, evaluateVar, getEnvSpec } from '../src/lib/env-registry'

const contract = JSON.parse(readFileSync('config/db-url-aliases.json', 'utf8')) as { aliases: string[] }

console.log('\n📦 One list, read by the build and the runtime')
assert(Array.isArray(contract.aliases) && contract.aliases.length > 0, 'the contract lists aliases')
assert.equal(contract.aliases[0], 'DATABASE_URL', 'DATABASE_URL stays canonical and first')
assert.equal(new Set(contract.aliases).size, contract.aliases.length, 'no alias is listed twice')
assert.deepEqual(DB_URL_ALIASES, contract.aliases, 'the registry reads the contract, not a copy of it')
console.log(`  ✅ the registry and the build agree on ${contract.aliases.length} names`)

console.log('\n📦 The aliases the build used to reject are now accepted everywhere')
const previouslyRejected = ['POSTGRES_PRISMA_URL', 'POSTGRES_URL']
for (const alias of previouslyRejected) {
  assert(contract.aliases.includes(alias), `${alias} is in the shared contract`)
  const evaluation = evaluateVar(getEnvSpec('DATABASE_URL')!, { env: { [alias]: 'postgresql://u:p@h:5432/db' } })
  assert.notEqual(evaluation.status, 'MISSING', `${alias} alone satisfies the runtime check`)
  console.log(`  ✅ ${alias} alone resolves a database connection`)
}

console.log('\n📦 Every alias is a declared variable in its own right')
for (const alias of contract.aliases) {
  const spec = getEnvSpec(alias)
  assert(spec, `${alias} has its own registry entry`)
  assert.equal(spec!.category, 'DATABASE', `${alias} is categorised as DATABASE`)
  console.log(`  ✅ ${alias} is declared`)
}
console.log(`\nDatabase contract: ${contract.aliases.length} aliases, one source of truth`)

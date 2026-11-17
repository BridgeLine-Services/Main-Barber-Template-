#!/usr/bin/env node
/**
 * Backward-compatibility gate for the newest Prisma migration (Part 11).
 *
 *   node scripts/check-migration-compat.mjs            # newest migration only
 *   node scripts/check-migration-compat.mjs --all      # whole chain (informational)
 *
 * A deploy order of "run migrations, then swap the app" means the previous
 * application version runs against the new schema for a short window, and a
 * rollback means the new schema must serve the old code again. Both only work if
 * migrations are additive. This gate refuses obviously destructive statements in
 * the newest migration unless that migration is explicitly marked BREAKING with a
 * reason, forcing expand-and-contract instead of a surprise outage.
 *
 * Exit: 0 compatible, 1 destructive statement found, 2 nothing to check.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(process.cwd(), 'prisma', 'migrations')
const DESTRUCTIVE = [
  { re: /\bDROP\s+TABLE\b(?!\s+IF\s+EXISTS)/i, why: 'drops a table the running application may still read' },
  { re: /\bDROP\s+COLUMN\b/i, why: 'removes a column the running application may still select' },
  { re: /\bRENAME\s+(TABLE|COLUMN|TO)\b/i, why: 'renames an object the running application addresses by name' },
  { re: /\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i, why: 'rejects rows the previous version could still write' },
  { re: /\bALTER\s+COLUMN\s+\S+\s+TYPE\b/i, why: 'changes a column type in place; prefer add-new, backfill, then contract later' },
  { re: /\bTRUNCATE\b/i, why: 'deletes rows' },
  { re: /\bDELETE\s+FROM\b/i, why: 'deletes rows in a migration' },
]

function migrations() {
  return readdirSync(ROOT)
    .filter((name) => statSync(path.join(ROOT, name)).isDirectory())
    .sort()
}

function inspect(name) {
  const file = path.join(ROOT, name, 'migration.sql')
  const sql = readFileSync(file, 'utf8')
  const breaking = /--\s*BREAKING:/.test(sql)
  const hits = DESTRUCTIVE.filter((rule) => rule.re.test(sql)).map((rule) => rule.why)
  return { name, hits, breaking }
}

const all = migrations()
if (all.length === 0) { console.error('No migrations found.'); process.exit(2) }
const targets = process.argv.includes('--all') ? all : [all[all.length - 1]]

let failed = 0
for (const name of targets) {
  const result = inspect(name)
  if (result.hits.length === 0) {
    if (process.argv.includes('--all')) console.log(`ok    ${name}`)
    continue
  }
  if (result.breaking) {
    console.log(`note  ${name} is marked BREAKING, so a rollback needs the documented plan`)
    continue
  }
  failed++
  console.error(`FAIL  ${name}`)
  for (const why of result.hits) console.error(`      ${why}`)
}

if (failed > 0) {
  console.error('\nUse expand-and-contract: add the new shape, backfill, ship the app, then contract in a later release.')
  console.error('If the change is genuinely required, mark it with a "-- BREAKING: <reason>" comment so the reviewer sees it.')
  process.exit(1)
}
if (!process.argv.includes('--all')) console.log(`Newest migration (${targets[0]}) is backward compatible.`)

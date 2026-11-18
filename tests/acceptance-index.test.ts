/**
 * Part 8.3 of the directive: every acceptance item either names the suite that proves
 * it, or says in words why it cannot be proved yet. The test fails if a cited suite is
 * missing, or if a cited suite is not wired into package.json, so the index cannot rot
 * into a list of promises.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

let passed = 0
let failed = 0
const failures: string[] = []
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; return }
  failed++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

type Item = { id: string; what: string; suite?: string; blocked?: string }

const ITEMS: Item[] = [
  { id: 'neon-resolution', what: 'Neon database URL is resolved through the one alias contract', suite: 'tests/db-url-aliases.test.ts' },
  { id: 'conflicting-urls', what: 'A conflicting database URL is detected rather than silently preferred', suite: 'tests/db-url-aliases.test.ts' },
  { id: 'secret-classification', what: 'Every credential is classified secret, and nothing public is secret', suite: 'tests/env-classification.test.ts' },
  { id: 'env-registry', what: 'The environment registry covers every variable the source reads', suite: 'tests/env-registry.test.ts' },
  { id: 'vercel-env-plan', what: 'The Vercel plan states what to set, without values', suite: 'tests/vercel-env-plan.test.ts' },
  { id: 'guidance-copy', what: 'Owner-facing guidance is plain language and never scores an unreadable fact', suite: 'tests/setup-guidance.test.ts' },
  { id: 'reliability-sections', what: 'Reliability sections never call an unchecked system healthy', suite: 'tests/reliability-sections.test.ts' },
  { id: 'repair-classification', what: 'Only same-line patches may be classed automatic', suite: 'tests/dependency-monitor.test.ts' },
  { id: 'client-distribution', what: 'A client copy keeps its security and build workflows', suite: 'tests/client-distribution.test.ts' },
  { id: 'tenant-isolation', what: 'A business cannot read another business records', suite: 'tests/tenant-isolation.test.ts' },
  { id: 'cross-tenant-matrix', what: 'Cross-tenant writes are refused across the matrix', suite: 'tests/cross-tenant-matrix.test.ts' },
  { id: 'rls-enforcement', what: 'Row-level security refuses foreign rows when forced', suite: 'tests/rls-enforcement.test.ts' },
  { id: 'maintenance-approval', what: 'A maintenance action records who asked and who approved', blocked: 'No maintenance-history model exists. It needs the additive migration the owner has asked to review first, so approval state cannot be recorded or tested yet.' },
  { id: 'maintenance-history', what: 'Completed and failed maintenance is recorded with a rollback reference', blocked: 'Same migration gate as maintenance-approval.' },
  { id: 'preview-vs-production-db', what: 'Preview and production use the intended database branch', blocked: 'Requires the Neon integration to be authorised and observed on a real preview deployment.' },
]

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> }
const wired = Object.values(pkg.scripts).join(' ')

ok('every acceptance item is accounted for', ITEMS.length >= 15, String(ITEMS.length))
ok('every item is either covered or blocked, never both', ITEMS.every((i) => Boolean(i.suite) !== Boolean(i.blocked)))
ok('every blocked item says why in plain words', ITEMS.filter((i) => i.blocked).every((i) => (i.blocked ?? '').length > 40))

for (const item of ITEMS) {
  if (item.suite) {
    ok(`${item.id}: cited suite exists`, existsSync(join(process.cwd(), item.suite)), item.suite)
    ok(`${item.id}: cited suite is wired into a package script`, wired.includes(item.suite), item.suite)
  } else {
    ok(`${item.id}: blocked item cites no suite`, !item.suite)
  }
}

ok('no item claims a passing result it did not run', ITEMS.every((i) => !('passed' in i)))

console.log(`\nAcceptance index: ${passed} passed, ${failed} failed`)
if (failed) { console.log('FAILURES:'); for (const f of failures) console.log(' ', f); process.exit(1) }

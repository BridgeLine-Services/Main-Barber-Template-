/**
 * Part 4.1 of the directive: the setting the policies read must be the setting the
 * application writes. Before this test, production-rls.sql read app.business_id while
 * tenant-context.ts wrote app.current_business_id, and the enforcement suite passed
 * because it set the old name itself. RLS would have denied every query in production
 * while every test was green.
 */
import { readFileSync } from 'node:fs'

let passed = 0
const failures: string[] = []
const ok = (name: string, condition: boolean, detail = '') => {
  if (condition) { passed++; console.log(`  PASS ${name}`) }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const helper = readFileSync('src/lib/tenant-context.ts', 'utf8')
const policies = readFileSync('prisma/rls/production-rls.sql', 'utf8')
const enforcement = readFileSync('tests/rls-enforcement.test.ts', 'utf8')

const written = [...helper.matchAll(/set_config\('([^']+)'/g)].map((m) => m[1])
const read = [...policies.matchAll(/current_setting\('([^']+)'/g)].map((m) => m[1])
const probed = [...enforcement.matchAll(/(?:SET LOCAL|current_setting\(')([a-z_.]+)/g)].map((m) => m[1])

ok('the helper writes exactly one tenant setting', written.length === 1, written.join(','))
ok('the helper writes a namespaced setting', /^app\./.test(written[0] ?? ''), written[0])
ok('policies read at least one setting', read.length > 0, String(read.length))
const PLATFORM = 'app.platform_staff'
ok('policies read the tenant setting', read.includes(written[0]), read.join(','))
ok('policies read nothing outside the two authorised settings',
  read.every((name) => name === written[0] || name === PLATFORM), [...new Set(read)].join(','))
ok('the runtime helper never grants itself platform access',
  !helper.includes(PLATFORM), 'tenant-context.ts must not set ' + PLATFORM)
ok('platform access is a separate, explicitly named setting', policies.includes(PLATFORM))
ok('no policy reads a stale name', !policies.includes('app.business_id'))
ok('the enforcement suite probes the same setting', probed.every((name) => name === written[0]), [...new Set(probed)].join(','))
ok('the enforcement suite does not probe a stale name', !enforcement.includes("app.business_id'"))
ok('the setting is transaction-local in the helper', /is_local\s*=>\s*true|,\s*true\)/.test(helper))
ok('policies fail closed when unset', policies.includes("NULLIF(current_setting('app.current_business_id', true), '')"))
ok('no policy uses a persistent SET', !/^\s*SET\s+app\./m.test(policies))

console.log(`\nRLS context name: ${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)

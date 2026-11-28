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
const organizationSetting = 'app.current_organization_id'
const platformSetting = 'app.platform_staff'

ok('the helper writes exactly one tenant setting', written.length === 1, written.join(','))
ok('the helper writes a namespaced setting', /^app\./.test(written[0] ?? ''), written[0])
ok('policies read at least one setting', read.length > 0, String(read.length))
ok('policies read the business tenant setting written by withTenant', read.includes(written[0]), read.join(','))
ok('policies read only documented business or organization context settings',
  read.every((name) => [written[0], organizationSetting].includes(name)), [...new Set(read)].join(','))
ok('the business helper never grants organization or platform scope',
  !helper.includes(organizationSetting) && !helper.includes(platformSetting))
ok('the staged policy documents organization scope separately', policies.includes(organizationSetting))
ok('platform access uses database role membership, not a caller-set variable',
  policies.includes("pg_has_role(current_user, 'barber_platform', 'member')") && !policies.includes(platformSetting))
const stageRoles = readFileSync('prisma/rls/stage-1-roles.sql', 'utf8')
ok('barber_app is not granted platform membership', !stageRoles.includes('GRANT barber_platform TO barber_app'))
ok('stage 1 revokes legacy support membership from barber_app', /REVOKE barber_platform FROM barber_app/.test(stageRoles))
ok('no policy reads a stale name', !policies.includes('app.business_id'))
ok('the enforcement suite probes only recognized tenant settings',
  probed.every((name) => [written[0], organizationSetting].includes(name)), [...new Set(probed)].join(','))
ok('the enforcement suite does not probe a stale name', !enforcement.includes("app.business_id'"))
ok('the setting is transaction-local in the helper', /is_local\s*=>\s*true|,\s*true\)/.test(helper))
ok('policies fail closed when unset', policies.includes("NULLIF(current_setting('app.current_business_id', true), '')"))
ok('no policy uses a persistent SET', !/^\s*SET\s+app\./m.test(policies))

console.log(`\nRLS context name: ${passed} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)

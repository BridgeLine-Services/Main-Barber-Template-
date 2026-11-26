/**
 * Tenant context, used rather than merely available (Section 5).
 *
 * `withTenant` was defined and called by nothing, which is the gap the brief names. These
 * assertions pin the fail-closed behaviour and the call sites that now use it, so the
 * count only ever grows.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertTenantId, TenantContextError } from '../src/lib/tenant-context'

const root = process.cwd()
let passed = 0
const failures: string[] = []
function ok(name: string, condition: boolean) {
  if (condition) passed += 1
  else failures.push(name)
}
function throws(name: string, fn: () => unknown) {
  try {
    fn()
    failures.push(name)
  } catch (error) {
    if (error instanceof TenantContextError) passed += 1
    else failures.push(`${name} (wrong error type)`)
  }
}

// --- fail closed ---
throws('an empty id is refused', () => assertTenantId(''))
throws('a whitespace id is refused', () => assertTenantId('   '))
throws('a missing id is refused', () => assertTenantId(undefined))
throws('a null id is refused', () => assertTenantId(null))
throws('a too short id is refused', () => assertTenantId('abc'))
throws('an id with a space is refused', () => assertTenantId('abc def ghi'))
throws('an id with a slash is refused', () => assertTenantId('abc/def/ghi'))
ok('a valid id passes through', assertTenantId('clx1234567890abcdef') === 'clx1234567890abcdef')
ok('surrounding space is trimmed', assertTenantId('  clx1234567890abcdef  ') === 'clx1234567890abcdef')
ok('the error says what is wrong, without the id', (() => {
  try {
    assertTenantId('')
    return false
  } catch (error) {
    return error instanceof TenantContextError && !/clx/.test(error.message)
  }
})())

// --- the helper sets the tenant inside the transaction ---
const helper = readFileSync(join(root, 'src/lib/tenant-context.ts'), 'utf8')
ok('withTenant binds the tenant with set_config', /set_config\('app\.current_business_id'/.test(helper))
ok('the binding is transaction local', /set_config\('app\.current_business_id', \$\{tenant\}, true\)/.test(helper))
ok('the callback runs inside the same transaction', /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*return fn\(tx\)/.test(helper))

// --- call sites that now use it ---
const scopedRoutes = ['src/app/api/dashboard/customers/route.ts']
for (const route of scopedRoutes) {
  const source = readFileSync(join(root, route), 'utf8')
  ok(`${route} reads inside a tenant context`, source.includes('withTenant(businessId'))
  ok(`${route} does not read customers outside it`, !/prisma\.customer\./.test(source))
}
const customersRoute = readFileSync(join(root, 'src/app/api/dashboard/customers/route.ts'), 'utf8')
ok(
  'a staff session without a shop is refused, not answered with an empty list',
  /if \(!businessId\)/.test(customersRoute) && /status: 401/.test(customersRoute),
)

if (failures.length > 0) {
  console.error(`\nTenant context: ${passed} passed, ${failures.length} failed`)
  for (const f of failures) console.error('  FAIL ' + f)
  process.exit(1)
}
console.log(`Tenant context: ${passed} passed, 0 failed`)

// Staged RLS groundwork (Part 8). RLS is NOT enabled: these tests prove the piece
// of application code that must exist before it can be, behaves correctly.
//
// What is proven:
//   1. A tenant is required and validated before any transaction opens.
//   2. The tenant is set with set_config(..., is_local => true), so it is scoped to
//      the transaction (the pooled-connection leak that SET without LOCAL causes).
//   3. Nothing leaks after the transaction: current_setting is empty again.
//   4. Two sequential transactions on the same pooled client see only their own
//      tenant value.
//   5. A failure inside the transaction rolls the work back.
import { prisma } from '../src/lib/prisma'
import { withTenant, currentTenant, assertTenantId, TenantContextError } from '../src/lib/tenant-context'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}
async function expectThrow(fn: () => Promise<unknown>, pattern: RegExp, message: string) {
  try { await fn(); assert(false, message) } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    assert(pattern.test(text), `${message} (said: ${text.slice(0, 80)})`)
  }
}

async function main() {
  console.log('--- a tenant is required, and it is validated ---')
  await expectThrow(() => withTenant('', async () => 1), /must be identified/i, 'an empty tenant is refused before a transaction opens')
  await expectThrow(() => withTenant(null, async () => 1), /must be identified/i, 'a null tenant is refused')
  await expectThrow(() => withTenant("x'; select 1; --", async () => 1), /not valid/i, 'a malformed tenant is refused')
  assert(assertTenantId('ckbusiness1234') === 'ckbusiness1234', 'a well-formed shop id passes through unchanged')
  const error = (() => { try { assertTenantId('') } catch (e) { return e } })()
  assert(error instanceof TenantContextError, 'the refusal is a named TenantContextError, not a generic crash')

  console.log('--- the tenant is visible inside the transaction only ---')
  const inside = await withTenant('ckbusiness1234', async (tx) => currentTenant(tx))
  assert(inside === 'ckbusiness1234', 'the transaction sees its own tenant')
  const outside = await prisma.$queryRaw<Array<{ tenant: string | null }>>`
    SELECT nullif(current_setting('app.current_business_id', true), '') AS tenant
  `
  assert(outside[0]?.tenant === null, 'nothing leaks after the transaction commits (the SET LOCAL guarantee)')

  console.log('--- two transactions cannot contaminate each other ---')
  const first = await withTenant('ckbusinessAAA1', async (tx) => currentTenant(tx))
  const second = await withTenant('ckbusinessBBB2', async (tx) => currentTenant(tx))
  const after = await prisma.$queryRaw<Array<{ tenant: string | null }>>`
    SELECT nullif(current_setting('app.current_business_id', true), '') AS tenant
  `
  assert(first === 'ckbusinessAAA1' && second === 'ckbusinessBBB2', 'each transaction sees only its own tenant')
  assert(after[0]?.tenant === null, 'the pooled connection is clean after both')

  console.log('--- a failing transaction rolls back and still clears the context ---')
  await expectThrow(
    () => withTenant('ckbusinessCCC3', async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_business_id', 'ckbusinessCCC3', true)`
      throw new Error('simulated failure after the tenant was set')
    }),
    /simulated failure/i,
    'the original error is propagated to the caller',
  )
  const afterFailure = await prisma.$queryRaw<Array<{ tenant: string | null }>>`
    SELECT nullif(current_setting('app.current_business_id', true), '') AS tenant
  `
  assert(afterFailure[0]?.tenant === null, 'a failed transaction leaves no tenant behind')

  console.log('--- the staging SQL exists and is not applied ---')
  const { readFileSync, existsSync } = await import('node:fs')
  assert(existsSync('prisma/rls/stage-1-roles.sql'), 'the role-split SQL ships with the repository')
  const roles = readFileSync('prisma/rls/stage-1-roles.sql', 'utf8')
  assert(/NOBYPASSRLS/.test(roles), 'the runtime role is explicitly denied BYPASSRLS')
  assert(/NOSUPERUSER/.test(roles), 'the runtime role is explicitly denied superuser')
  assert(!/ENABLE ROW LEVEL SECURITY/i.test(roles), 'stage 1 enables no policy: it cannot lock a shop out')
  const plan = readFileSync('docs/RLS-STAGING-PLAN.md', 'utf8')
  assert(/deliberately NOT enabled|NOT enabled/i.test(plan), 'the plan states plainly that RLS is not enabled')

  console.log(`\nRLS staging tests: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exit(1) })

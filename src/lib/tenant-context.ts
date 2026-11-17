/**
 * Transaction-local tenant context (RLS layer 2, application side).
 *
 * Nothing in the running application uses this yet: RLS is not enabled, and
 * docs/RLS-STAGING-PLAN.md explains why enabling policies before the role split
 * would give a false guarantee. This helper is the one piece of application code
 * that must exist first, because every protected query has to run inside a
 * transaction that has already set the tenant.
 *
 * The tenant is set with `set_config(..., is_local => true)`, which is the
 * function form of SET LOCAL: it is scoped to this transaction and is released
 * when the transaction ends, so a pooled connection can never hand one shop's
 * context to the next request.
 *
 * An absent or malformed tenant is refused here rather than passed to the
 * database, because `current_tenant()` returning NULL makes every policy
 * comparison false. Refusing loudly in the application produces a clear error
 * instead of a mysteriously empty result set.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantContextError'
  }
}

/** Business ids are cuids in this schema; anything else is a programming error. */
const BUSINESS_ID = /^[A-Za-z0-9_-]{8,64}$/

export function assertTenantId(businessId: string | null | undefined): string {
  const value = (businessId ?? '').trim()
  if (!value) {
    throw new TenantContextError('A shop must be identified before tenant-scoped data can be read or written.')
  }
  if (!BUSINESS_ID.test(value)) {
    throw new TenantContextError('That shop identifier is not valid.')
  }
  return value
}

/**
 * Run `fn` inside a transaction whose tenant is fixed to `businessId`.
 *
 * Use this for any query that will be protected by RLS once policies are
 * enabled. Reads that must span tenants (platform administration) stay outside
 * it and must be explicitly authorised and audited.
 */
export async function withTenant<T>(
  businessId: string | null | undefined,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const tenant = assertTenantId(businessId)
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_business_id', ${tenant}, true)`
    return fn(tx)
  })
}

/** Read the tenant currently bound to this transaction, or null. Diagnostic only. */
export async function currentTenant(tx: Prisma.TransactionClient): Promise<string | null> {
  const rows = await tx.$queryRaw<Array<{ tenant: string | null }>>`
    SELECT nullif(current_setting('app.current_business_id', true), '') AS tenant
  `
  return rows[0]?.tenant ?? null
}

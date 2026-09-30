/**
 * Audit log: verifies real database-backed audit entries with full metadata
 * (who, what, when, entity, old/new values, tenant, IP, user agent) and
 * tenant scoping. No fake activity — every assertion reads AuditLog rows.
 *
 * Run: npx tsx tests/audit-log.test.ts
 */
// Set before the auth module loads (imports are hoisted, so logAudit is
// imported dynamically after the env is in place) — keeps the suite
// runnable from a bare CI shell.
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'ci-audit-test-secret-0123456789'

const { prisma } = require('../src/lib/prisma')
const { logAudit } = require('../src/lib/auth-helpers')

let passed = 0, failed = 0
function assert(c: boolean, m: string) {
  if (c) { console.log(`  ✅ ${m}`); passed++ } else { console.error(`  ❌ ${m}`); failed++ }
}

async function main() {
  console.log('\n══════════ Audit Log Test Suite ══════════')
  const stamp = Date.now()

  // Two tenants + a user to prove scoping
  const [bizA, bizB] = await Promise.all([
    prisma.business.create({ data: { name: `Audit A ${stamp}`, slug: `audit-a-${stamp}`, email: `a${stamp}@example.com`, phone: '555', address: 'a', city: 'c', state: 'CA', zipCode: '9', timezone: 'UTC' } }),
    prisma.business.create({ data: { name: `Audit B ${stamp}`, slug: `audit-b-${stamp}`, email: `b${stamp}@example.com`, phone: '555', address: 'a', city: 'c', state: 'CA', zipCode: '9', timezone: 'UTC' } }),
  ])
  const user = await prisma.user.create({
    data: { email: `auditor${stamp}@example.com`, name: 'Auditor', passwordHash: 'x'.repeat(60), role: 'OWNER', businessId: bizA.id },
  })
  try {
    // 1. Full metadata entry
    await logAudit({
      userId: user.id, businessId: bizA.id, action: 'SERVICE_CREATED',
      entityType: 'Service', entityId: 'svc_123',
      newValues: { name: 'Skin Fade', price: 40 },
      ipAddress: '203.0.113.7', userAgent: 'audit-test-agent',
    })
    let rows = await prisma.auditLog.findMany({ where: { businessId: bizA.id, action: 'SERVICE_CREATED' }, include: { user: true } })
    assert(rows.length === 1, 'SERVICE_CREATED entry recorded in database')
    const row = rows[0]
    assert(row.userId === user.id && row.user?.email === user.email, 'records WHO performed the action')
    assert(row.action === 'SERVICE_CREATED' && row.entityType === 'Service' && row.entityId === 'svc_123', 'records WHAT happened and the entity')
    assert(!!row.createdAt && row.createdAt.getTime() <= Date.now(), 'records WHEN it happened (timestamp)')
    const newValues = (row.newValues ?? {}) as Record<string, unknown>
    assert(newValues.name === 'Skin Fade' && newValues.price === 40, 'records NEW values')
    assert(row.ipAddress === '203.0.113.7' && row.userAgent === 'audit-test-agent', 'records IP address and user agent')

    // 2. Old + new values (update flow)
    await logAudit({
      userId: user.id, businessId: bizA.id, action: 'SERVICE_UPDATED',
      entityType: 'Service', entityId: 'svc_123',
      oldValues: { price: 40 }, newValues: { price: 45 },
      ipAddress: '203.0.113.7', userAgent: 'audit-test-agent',
    })
    const upd = await prisma.auditLog.findFirst({ where: { businessId: bizA.id, action: 'SERVICE_UPDATED' }, orderBy: { createdAt: 'desc' } })
    const updOld = (upd?.oldValues ?? {}) as Record<string, unknown>
    const updNew = (upd?.newValues ?? {}) as Record<string, unknown>
    assert(updOld.price === 40 && updNew.price === 45, 'update entries capture previous AND new values')

    // 3. All new audit actions accepted by the enum (regression for the migration)
    for (const action of ['SERVICE_CREATED', 'SERVICE_UPDATED', 'SERVICE_DEACTIVATED', 'SERVICE_DELETED', 'BARBER_CREATED', 'BARBER_UPDATED'] as const) {
      await logAudit({ userId: user.id, businessId: bizA.id, action, entityType: action.startsWith('SERVICE') ? 'Service' : 'Barber', entityId: 'x' })
    }
    const counts = await prisma.auditLog.groupBy({ by: ['action'], where: { businessId: bizA.id } })
    const recorded = new Set(counts.map(c => c.action))
    for (const a of ['SERVICE_CREATED', 'SERVICE_UPDATED', 'SERVICE_DEACTIVATED', 'SERVICE_DELETED', 'BARBER_CREATED', 'BARBER_UPDATED']) {
      assert(recorded.has(a as never), `${a} accepted by the AuditAction enum`)
    }

    // 4. Tenant scoping: business B sees NONE of business A's entries
    rows = await prisma.auditLog.findMany({ where: { businessId: bizA.id } })
    const bRows = await prisma.auditLog.findMany({ where: { businessId: bizB.id } })
    assert(rows.length > 0 && bRows.length === 0, 'audit log is tenant-scoped (Business B sees none of Business A)')

    // 5. No user AND no business → security event dropped (per logAudit contract)
    const before = await prisma.auditLog.count()
    await logAudit({ action: 'LOGIN_FAILED' })
    const after = await prisma.auditLog.count()
    assert(before === after, 'entries with no user and no business are not persisted (contract)')
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {})
    await prisma.business.delete({ where: { id: bizA.id } }).catch(() => {})
    await prisma.business.delete({ where: { id: bizB.id } }).catch(() => {})
  }
  console.log(`\nAudit log tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
  process.exit(0)
}
main().catch(e => { console.error('Test crashed:', e); process.exit(1) })

export {}

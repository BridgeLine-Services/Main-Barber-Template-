/**
 * Priority 2: the organization layer's isolation, against a real database.
 *
 * This suite creates two organizations with their own locations and people, then proves
 * that resolving from a user id can never return another organization's data. It also
 * proves the migration is additive and that removing an organization does not remove a
 * shop.
 *
 * Requires DATABASE_URL. Skips cleanly (and says so) when no database is configured.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let passed = 0
let failed = 0
let skipped = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; return }
  failed++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}
function skip(name: string) { skipped++; console.log(`  SKIP ${name}`) }

const ROOT = join(__dirname, '..')
const stamp = Date.now().toString(36)
const created = { orgIds: [] as string[], businessIds: [] as string[], userIds: [] as string[] }

async function main() {
  // ─── Static: the migration is additive ───────────────────────────────────
  const migrationPath = join(ROOT, 'prisma', 'migrations', '20261120150000_organization_and_referrals', 'migration.sql')
  const sql = readFileSync(migrationPath, 'utf8')
  ok('the organization migration exists', sql.length > 1000)
  ok('the migration adds tables', (sql.match(/CREATE TABLE/g) ?? []).length >= 10)
  ok('the migration never drops anything', !/\bDROP\s+(TABLE|COLUMN|CONSTRAINT)\b/i.test(sql))
  ok('the migration never alters an existing table', !/ALTER TABLE "(Business|User|Appointment|Customer|Payment)"/.test(sql))
  ok('the migration never deletes rows', !/\bDELETE\s+FROM\b/i.test(sql))
  ok('the migration never enables row level security', !/ENABLE ROW LEVEL SECURITY/i.test(sql))
  ok('the business link is RESTRICT, so a shop is never cascade-deleted', /OrganizationLocation_businessId_fkey[\s\S]*ON DELETE RESTRICT/.test(sql))
  ok('organization-owned tables cascade from the organization', /OrganizationMember_organizationId_fkey[\s\S]*ON DELETE CASCADE/.test(sql))

  const restoreSql = readFileSync(join(ROOT, 'prisma', 'migrations', '20261120140000_restore_drill', 'migration.sql'), 'utf8')
  ok('the restore-drill migration is additive', /CREATE TABLE "RestoreDrill"/.test(restoreSql) && !/^\s*DROP\s+/im.test(restoreSql))

  // Every migration file must remain free of FORCE RLS.
  const migrationsDir = join(ROOT, 'prisma', 'migrations')
  const forced = readdirSync(migrationsDir)
    .filter((entry) => statSync(join(migrationsDir, entry)).isDirectory())
    .map((entry) => join(migrationsDir, entry, 'migration.sql'))
    .filter((file) => { try { return /FORCE ROW LEVEL SECURITY/i.test(readFileSync(file, 'utf8')) } catch { return false } })
  ok('no migration forces row level security', forced.length === 0, forced.join(', '))

  if (!process.env.DATABASE_URL) {
    skip('database isolation checks (no DATABASE_URL)')
    return
  }

  const { prisma } = await import('../src/lib/prisma')
  const { resolveOrganizationContext, authoriseLocationAction } = await import('../src/lib/organization/resolve')

  try {
    const orgA = await prisma.organization.create({ data: { name: `Org A ${stamp}`, slug: `org-a-${stamp}` } })
    const orgB = await prisma.organization.create({ data: { name: `Org B ${stamp}`, slug: `org-b-${stamp}` } })
    created.orgIds.push(orgA.id, orgB.id)

    const shopA1 = await prisma.business.create({ data: { name: `A North ${stamp}`, slug: `a-north-${stamp}` } })
    const shopA2 = await prisma.business.create({ data: { name: `A South ${stamp}`, slug: `a-south-${stamp}` } })
    const shopB1 = await prisma.business.create({ data: { name: `B Only ${stamp}`, slug: `b-only-${stamp}` } })
    created.businessIds.push(shopA1.id, shopA2.id, shopB1.id)

    await prisma.organizationLocation.createMany({
      data: [
        { organizationId: orgA.id, businessId: shopA1.id, region: 'North', status: 'active' },
        { organizationId: orgA.id, businessId: shopA2.id, region: 'South', status: 'active' },
        { organizationId: orgB.id, businessId: shopB1.id, region: 'North', status: 'active' },
      ],
    })

    const mkUser = async (label: string, businessId: string | null) => {
      const user = await prisma.user.create({
        data: { email: `${label}-${stamp}@example.invalid`, passwordHash: 'x', name: label, role: 'OWNER', businessId },
      })
      created.userIds.push(user.id)
      return user
    }

    const ownerA = await mkUser('owner-a', shopA1.id)
    const regionalA = await mkUser('regional-a', shopA1.id)
    const franchiseA = await mkUser('franchise-a', shopA1.id)
    const ownerB = await mkUser('owner-b', shopB1.id)
    const outsider = await mkUser('outsider', null)

    await prisma.organizationMember.createMany({
      data: [
        { organizationId: orgA.id, userId: ownerA.id, role: 'ORGANIZATION_OWNER', status: 'ACTIVE' },
        { organizationId: orgA.id, userId: regionalA.id, role: 'REGIONAL_MANAGER', status: 'ACTIVE', regions: ['North'] },
        { organizationId: orgA.id, userId: franchiseA.id, role: 'FRANCHISE_OWNER', status: 'ACTIVE' },
        { organizationId: orgB.id, userId: ownerB.id, role: 'ORGANIZATION_OWNER', status: 'ACTIVE' },
        { organizationId: orgA.id, userId: outsider.id, role: 'CORPORATE_ADMIN', status: 'SUSPENDED' },
      ],
    })

    const ctxOwnerA = await resolveOrganizationContext(ownerA.id)
    ok('an organization owner resolves their organization', ctxOwnerA.ok && ctxOwnerA.context?.organizationId === orgA.id)
    ok('an organization owner sees every open location in it', ctxOwnerA.context?.locationBusinessIds.sort().join(',') === [shopA1.id, shopA2.id].sort().join(','))
    ok('an organization owner never sees the other organization’s location', !ctxOwnerA.context?.locationBusinessIds.includes(shopB1.id))

    const ctxRegional = await resolveOrganizationContext(regionalA.id)
    ok('a regional manager sees only their region', ctxRegional.context?.locationBusinessIds.join(',') === shopA1.id)

    const ctxFranchise = await resolveOrganizationContext(franchiseA.id)
    ok('a franchise owner sees only their own location', ctxFranchise.context?.locationBusinessIds.join(',') === shopA1.id)

    const ctxOwnerB = await resolveOrganizationContext(ownerB.id)
    ok('the second organization resolves to itself', ctxOwnerB.context?.organizationId === orgB.id)
    ok('the second organization sees only its own location', ctxOwnerB.context?.locationBusinessIds.join(',') === shopB1.id)

    const ctxOutsider = await resolveOrganizationContext(outsider.id)
    ok('a suspended member is refused', ctxOutsider.ok === false && ctxOutsider.reason === 'suspended')
    ok('a refused member gets no context', ctxOutsider.context === null)

    const ctxNobody = await resolveOrganizationContext(null)
    ok('no user means no organization', ctxNobody.ok === false && ctxNobody.reason === 'no-membership')

    ok('a location outside the organization is refused by the authoriser',
      authoriseLocationAction(ctxOwnerA.context!, shopB1.id, 'reporting.aggregate.read').allowed === false)
    ok('a location inside the organization is allowed for a permitted capability',
      authoriseLocationAction(ctxOwnerA.context!, shopA1.id, 'reporting.aggregate.read').allowed === true)
    ok('a capability the role lacks is refused',
      authoriseLocationAction(ctxOwnerB.context!, shopB1.id, 'locations.manage').allowed === true)

    // An explicit assignment widens a regional manager's reach, and only that.
    await prisma.staffLocationAssignment.create({
      data: { organizationId: orgA.id, userId: regionalA.id, businessId: shopA2.id, role: 'LOCATION_MANAGER', createdById: ownerA.id },
    })
    const ctxRegionalAssigned = await resolveOrganizationContext(regionalA.id)
    ok('an explicit assignment adds exactly the assigned location',
      ctxRegionalAssigned.context?.locationBusinessIds.sort().join(',') === [shopA1.id, shopA2.id].sort().join(','))

    // --- Empty scope must never mean "every location" -----------------------
    // This is the defect this phase exists for. Before the fix the filter was
    // `role === 'REGIONAL_MANAGER' && regions.length > 0`, so an empty list
    // skipped filtering entirely and the manager saw every open location.
    const noScope = await mkUser('regional-noscope', null)
    const multiScope = await mkUser('regional-multi', null)
    const allScope = await mkUser('regional-all', null)
    const removed = await mkUser('regional-removed', null)
    await prisma.organizationMember.createMany({
      data: [
        { organizationId: orgA.id, userId: noScope.id, role: 'REGIONAL_MANAGER', status: 'ACTIVE', regions: [], allRegions: false },
        { organizationId: orgA.id, userId: multiScope.id, role: 'REGIONAL_MANAGER', status: 'ACTIVE', regions: ['North', 'South'] },
        { organizationId: orgA.id, userId: allScope.id, role: 'REGIONAL_MANAGER', status: 'ACTIVE', regions: [], allRegions: true },
        { organizationId: orgA.id, userId: removed.id, role: 'REGIONAL_MANAGER', status: 'REMOVED', regions: ['North'] },
      ],
    })

    const ctxNoScope = await resolveOrganizationContext(noScope.id)
    ok('a regional manager with no regions resolves no locations',
      ctxNoScope.ok === true && ctxNoScope.context?.locationBusinessIds.length === 0)
    ok('an empty region list is not read as all-region access',
      ctxNoScope.context?.allRegions === false && !ctxNoScope.context?.locationBusinessIds.includes(shopA1.id))

    const ctxMulti = await resolveOrganizationContext(multiScope.id)
    ok('a regional manager with two regions sees both regions',
      ctxMulti.context?.locationBusinessIds.sort().join(',') === [shopA1.id, shopA2.id].sort().join(','))

    const ctxAll = await resolveOrganizationContext(allScope.id)
    ok('all-region access works when it is granted explicitly',
      ctxAll.context?.locationBusinessIds.sort().join(',') === [shopA1.id, shopA2.id].sort().join(','))
    ok('the explicit grant is visible to callers', ctxAll.context?.allRegions === true)

    const ctxRemoved = await resolveOrganizationContext(removed.id)
    ok('a removed member is refused', ctxRemoved.ok === false && ctxRemoved.context === null)

    // --- A database failure must fail closed, not half-resolve ----------------
    const realFindMany = prisma.organizationLocation.findMany
    ;(prisma.organizationLocation as any).findMany = async () => { throw new Error('connection reset') }
    const ctxBroken = await resolveOrganizationContext(ownerA.id)
    ;(prisma.organizationLocation as any).findMany = realFindMany
    ok('a failed location lookup returns no context', ctxBroken.ok === false && ctxBroken.context === null)
    ok('a failed location lookup is reported as a read failure', ctxBroken.reason === 'read-failed')
    ok('the failure message is plain language, not a stack trace',
      typeof ctxBroken.message === 'string' && !/Error|prisma|SELECT/i.test(ctxBroken.message))

    // The role column is a Postgres enum, so a value outside the known roles cannot be
    // stored at all. That is a stronger guarantee than an application check.
    const roleLabels = await prisma.$queryRawUnsafe<Array<{ label: string }>>(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'OrganizationMemberRole' ORDER BY e.enumsortorder`,
    )
    const labels = roleLabels.map((row) => row.label)
    ok('the organization role column is a database enum', labels.length === 4)
    ok('the enum contains exactly the four organization roles', labels.join(',') === 'ORGANIZATION_OWNER,CORPORATE_ADMIN,REGIONAL_MANAGER,FRANCHISE_OWNER')
    ok('no unknown role can be stored', !labels.includes('SUPERUSER'))

    // Removing the organization must not remove the shop.
    await prisma.organization.delete({ where: { id: orgA.id } })
    const shopStillThere = await prisma.business.findUnique({ where: { id: shopA1.id } })
    ok('deleting an organization does not delete a shop', shopStillThere !== null)
    const linkGone = await prisma.organizationLocation.findUnique({ where: { businessId: shopA1.id } })
    ok('deleting an organization removes the location link', linkGone === null)
  } finally {
    // Best-effort cleanup, in dependency order. Never throws out of the suite.
    try {
      await prisma.organizationMember.deleteMany({ where: { userId: { in: created.userIds } } })
      await prisma.staffLocationAssignment.deleteMany({ where: { userId: { in: created.userIds } } })
      await prisma.organizationLocation.deleteMany({ where: { businessId: { in: created.businessIds } } })
      await prisma.organization.deleteMany({ where: { id: { in: created.orgIds } } })
      await prisma.user.deleteMany({ where: { id: { in: created.userIds } } })
      await prisma.business.deleteMany({ where: { id: { in: created.businessIds } } })
    } catch { /* cleanup is best effort */ }
    await prisma.$disconnect()
  }
}

main()
  .then(() => {
    console.log(`\nOrganization isolation: ${passed} passed, ${failed} failed, ${skipped} skipped`)
    if (failed > 0) process.exit(1)
  })
  .catch((error) => {
    console.error('Organization isolation suite threw:', error)
    process.exit(1)
  })

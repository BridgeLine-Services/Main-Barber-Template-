/**
 * Organization service templates: the standard list corporate publishes.
 *
 * These tests exercise the real database path, not the pure validators alone, because the
 * rules that matter here are about scope and about not overwriting a location's approved
 * price. Both are database facts.
 *
 * Run: npx tsx tests/organization-service-templates.test.ts
 */

import { prisma } from '../src/lib/prisma'
import {
  createServiceTemplate,
  listServiceTemplates,
  updateServiceTemplate,
} from '../src/lib/organization/service-template-service'
import { can } from '../src/lib/organization/capabilities'

let passed = 0
let failed = 0
function ok(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}

async function main() {
  const stamp = Date.now()
  const orgIds: string[] = []
  const businessIds: string[] = []
  const userIds: string[] = []

  try {
    const orgA = await prisma.organization.create({ data: { name: `Svc Org A ${stamp}`, slug: `svc-org-a-${stamp}` } })
    const orgB = await prisma.organization.create({ data: { name: `Svc Org B ${stamp}`, slug: `svc-org-b-${stamp}` } })
    orgIds.push(orgA.id, orgB.id)

    const shopA = await prisma.business.create({ data: { name: `Svc Shop A ${stamp}`, slug: `svc-shop-a-${stamp}` } })
    const shopB = await prisma.business.create({ data: { name: `Svc Shop B ${stamp}`, slug: `svc-shop-b-${stamp}` } })
    businessIds.push(shopA.id, shopB.id)

    const mkUser = async (label: string) => {
      const u = await prisma.user.create({
        data: { email: `${label}-${stamp}@example.invalid`, passwordHash: 'x', name: label, role: 'OWNER', businessId: shopA.id },
      })
      userIds.push(u.id)
      return u
    }
    const owner = await mkUser('svc-owner')
    const manager = await mkUser('svc-manager')

    await prisma.organizationMember.createMany({
      data: [
        { organizationId: orgA.id, userId: owner.id, role: 'ORGANIZATION_OWNER', status: 'ACTIVE', regions: [], allRegions: true },
        { organizationId: orgA.id, userId: manager.id, role: 'REGIONAL_MANAGER', status: 'ACTIVE', regions: ['North'] },
      ],
    })

    // --- Create ---------------------------------------------------------------
    const created = await createServiceTemplate(orgA.id, owner.id, {
      name: 'Haircut', description: 'Wash, cut and finish', durationMinutes: 30, defaultPriceCents: 3500,
    })
    ok(created.ok === true, 'an owner can add a standard service')
    ok(created.template?.name === 'Haircut', 'the service is stored with its name')
    ok(created.template?.defaultPriceCents === 3500, 'the standard price is stored in cents')
    ok((created.template?.locationExceptions ?? -1) === 0, 'a new service has no local price exceptions')

    const auditAfterCreate = await prisma.organizationConfigAudit.findFirst({
      where: { organizationId: orgA.id, entity: 'OrganizationServiceTemplate', entityId: created.template?.id },
      orderBy: { createdAt: 'desc' },
    })
    ok(auditAfterCreate !== null, 'adding a service is recorded in the audit log')
    ok(
      typeof auditAfterCreate?.summary === 'string' && auditAfterCreate.summary.includes('Haircut'),
      'the audit entry names the service in plain words'
    )

    // --- Validation is the existing one, not a second copy --------------------
    const noName = await createServiceTemplate(orgA.id, owner.id, { name: '  ', durationMinutes: 30, defaultPriceCents: 3500 })
    ok(noName.ok === false, 'a service with no name is refused')
    ok(noName.errors.some((e) => /needs a name/i.test(e)), 'the refusal is a plain-language message')

    const badDuration = await createServiceTemplate(orgA.id, owner.id, { name: 'Beard', durationMinutes: 0, defaultPriceCents: 1000 })
    ok(badDuration.ok === false, 'a zero-length service is refused')

    const negativePrice = await createServiceTemplate(orgA.id, owner.id, { name: 'Shave', durationMinutes: 20, defaultPriceCents: -1 })
    ok(negativePrice.ok === false, 'a negative price is refused')

    const stringPrice = await createServiceTemplate(orgA.id, owner.id, { name: 'Fade', durationMinutes: 45, defaultPriceCents: '4000' })
    ok(stringPrice.ok === false, 'a price sent as text is refused rather than coerced')

    // --- Update ---------------------------------------------------------------
    const updated = await updateServiceTemplate(orgA.id, owner.id, created.template!.id, { defaultPriceCents: 4000 })
    ok(updated.ok === true, 'the standard price can be changed')
    ok(updated.template?.defaultPriceCents === 4000, 'the new standard price is stored')
    ok(updated.template?.name === 'Haircut', 'fields that were not sent are left alone')

    const auditAfterUpdate = await prisma.organizationConfigAudit.findFirst({
      where: { organizationId: orgA.id, action: 'service-template.update', entityId: created.template!.id },
      orderBy: { createdAt: 'desc' },
    })
    ok(auditAfterUpdate !== null, 'a change is recorded in the audit log')
    ok(
      JSON.stringify(auditAfterUpdate?.previousValue ?? {}).includes('3500') &&
      JSON.stringify(auditAfterUpdate?.newValue ?? {}).includes('4000'),
      'the audit entry records the old and the new price'
    )

    // --- A location's approved price survives a standard price change --------
    await prisma.organizationServicePriceException.create({
      data: { templateId: created.template!.id, businessId: shopA.id, priceCents: 3000, reason: 'Smaller shop', approvedById: owner.id },
    })
    const afterException = await updateServiceTemplate(orgA.id, owner.id, created.template!.id, { defaultPriceCents: 4500 })
    const exceptionRow = await prisma.organizationServicePriceException.findFirst({
      where: { templateId: created.template!.id, businessId: shopA.id },
    })
    ok(afterException.ok === true, 'the standard price can still be changed')
    ok(exceptionRow?.priceCents === 3000, "a location's approved price is not overwritten by a standard change")
    const listed = await listServiceTemplates(orgA.id)
    ok(listed.find((t) => t.id === created.template!.id)?.locationExceptions === 1,
      'the screen can say how many locations keep their own price')

    // --- Scope ---------------------------------------------------------------
    const otherOrgList = await listServiceTemplates(orgB.id)
    ok(otherOrgList.length === 0, 'another organization sees none of these services')

    const crossOrgUpdate = await updateServiceTemplate(orgB.id, owner.id, created.template!.id, { defaultPriceCents: 100 })
    ok(crossOrgUpdate.ok === false, 'an organization cannot change another organization’s service')
    const stillThere = await prisma.organizationServiceTemplate.findUnique({ where: { id: created.template!.id } })
    ok(stillThere?.defaultPriceCents === 4500, 'the refused cross-organization change wrote nothing')

    const unknown = await updateServiceTemplate(orgA.id, owner.id, 'not-a-real-id', { defaultPriceCents: 100 })
    ok(unknown.ok === false, 'an unknown service id is refused')

    // --- Capability model ----------------------------------------------------
    ok(can('ORGANIZATION_OWNER', 'services.manage') === true, 'an organization owner may manage services')
    ok(can('CORPORATE_ADMIN', 'services.manage') === true, 'a corporate admin may manage services')
    ok(can('REGIONAL_MANAGER', 'services.manage') === false, 'a regional manager may not manage the standard list')
    ok(can('FRANCHISE_OWNER', 'services.manage') === false, 'a franchise owner may not manage the standard list')
    ok(can('REGIONAL_MANAGER', 'services.read') === true, 'a regional manager may still read the list')

    // --- Deactivated services stay visible to management ---------------------
    const deactivated = await updateServiceTemplate(orgA.id, owner.id, created.template!.id, { active: false })
    ok(deactivated.template?.active === false, 'a service can be taken out of the standard list')
    const afterDeactivate = await listServiceTemplates(orgA.id)
    ok(afterDeactivate.some((t) => t.id === created.template!.id), 'a deactivated service is still listed for management')
  } finally {
    await prisma.organizationServicePriceException.deleteMany({ where: { businessId: { in: businessIds } } }).catch(() => {})
    await prisma.organizationConfigAudit.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
    await prisma.organizationServiceTemplate.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
    await prisma.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {})
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => {})
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } }).catch(() => {})
  }

  console.log(`\nOrganization service templates: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

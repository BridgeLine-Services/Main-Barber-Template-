/**
 * Corporate branding: the shared look, its limits, and what a location may change.
 *
 * The rules being pinned here are the ones that stop a location from quietly redefining the
 * brand, and stop a logo field from becoming a way to point the site at an arbitrary URL.
 *
 * Run: npx tsx tests/organization-branding.test.ts
 */

import { prisma } from '../src/lib/prisma'
import {
  loadBrandSettings,
  loadLocationBrands,
  saveBrandSettings,
} from '../src/lib/organization/brand-settings-service'
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
    const orgA = await prisma.organization.create({ data: { name: `Brand Org A ${stamp}`, slug: `brand-org-a-${stamp}` } })
    const orgB = await prisma.organization.create({ data: { name: `Brand Org B ${stamp}`, slug: `brand-org-b-${stamp}` } })
    orgIds.push(orgA.id, orgB.id)

    const shopA = await prisma.business.create({
      data: { name: `Brand Shop A ${stamp}`, slug: `brand-shop-a-${stamp}`, primaryColor: '#ff0000' },
    })
    const shopB = await prisma.business.create({ data: { name: `Brand Shop B ${stamp}`, slug: `brand-shop-b-${stamp}` } })
    businessIds.push(shopA.id, shopB.id)

    await prisma.organizationLocation.createMany({
      data: [
        { organizationId: orgA.id, businessId: shopA.id, region: 'North', status: 'active' },
        { organizationId: orgA.id, businessId: shopB.id, region: 'South', status: 'active' },
      ],
    })

    const mkUser = async (label: string) => {
      const u = await prisma.user.create({
        data: { email: `${label}-${stamp}@example.invalid`, passwordHash: 'x', name: label, role: 'OWNER', businessId: shopA.id },
      })
      userIds.push(u.id)
      return u
    }
    const owner = await mkUser('brand-owner')

    // --- Nothing set yet -------------------------------------------------------
    const empty = await loadBrandSettings(orgA.id)
    ok(empty !== null && empty.logoUrl === null, 'an organization with no brand reads as unset, not as an error')
    ok(empty?.boundary.includes('Every location uses the shared brand'), 'the boundary is explained in plain words when nothing is set')

    // --- Validation -----------------------------------------------------------
    const badColour = await saveBrandSettings(orgA.id, owner.id, { primaryColor: 'red' })
    ok(badColour.ok === false, 'a colour that is not a hex value is refused')
    ok(badColour.errors.some((e) => /hex value/i.test(e)), 'the refusal explains the format')

    const externalLogo = await saveBrandSettings(orgA.id, owner.id, { logoUrl: 'https://evil.example/logo.png' })
    ok(externalLogo.ok === false, 'a logo hosted somewhere else is refused')
    ok(externalLogo.errors.some((e) => /uploaded through this application/i.test(e)), 'the refusal says where the logo must come from')

    const unknownField = await saveBrandSettings(orgA.id, owner.id, { allowedOverrides: ['themeCss'] })
    ok(unknownField.ok === false, 'an unknown field cannot be made overridable')

    // --- An override needs a shared value first -------------------------------
    const prematureOverride = await saveBrandSettings(orgA.id, owner.id, { allowedOverrides: ['accentColor'] })
    ok(prematureOverride.ok === false, 'a location cannot be allowed to override a field the shared brand does not set')
    ok(prematureOverride.errors.some((e) => /does not set it yet/i.test(e)), 'the refusal explains why')

    // --- A valid save ---------------------------------------------------------
    const saved = await saveBrandSettings(orgA.id, owner.id, {
      primaryColor: '#1a1a1a', accentColor: '#d4a853', allowedOverrides: ['accentColor'],
    })
    ok(saved.ok === true, 'a valid brand is saved')
    ok(saved.settings?.primaryColor === '#1a1a1a', 'the main colour is stored')
    ok(JSON.stringify(saved.settings?.allowedOverrides) === JSON.stringify(['accentColor']), 'only the chosen field is overridable')
    ok(saved.settings?.boundary.includes('accentColor'), 'the boundary names what locations may change')

    const audit = await prisma.organizationConfigAudit.findFirst({
      where: { organizationId: orgA.id, entity: 'OrganizationBrandSettings' },
      orderBy: { createdAt: 'desc' },
    })
    ok(audit !== null, 'the change is recorded in the audit log')
    ok(typeof audit?.summary === 'string' && /shared brand/i.test(audit.summary), 'the audit entry is written in plain words')

    // --- Location resolution ---------------------------------------------------
    // Shop A has its own primary colour, but corporate never allowed primaryColor to be
    // overridden, so the shared value must win.
    await prisma.business.update({ where: { id: shopA.id }, data: { accentColor: '#00ff00' } })
    const brands = await loadLocationBrands(orgA.id)
    const shopABrand = brands.find((b) => b.businessId === shopA.id)
    const shopBBrand = brands.find((b) => b.businessId === shopB.id)

    ok(brands.length === 2, 'both open locations are listed')
    ok(shopABrand?.resolved.find((f) => f.field === 'primaryColor')?.source === 'organization',
      'a location cannot override a field corporate did not allow')
    ok(shopABrand?.resolved.find((f) => f.field === 'accentColor')?.source === 'location',
      'a location does override a field corporate did allow')
    ok(shopABrand?.usesOwnValue === true, 'the location is reported as using its own value')
    // The trap worth pinning: Business.accentColor has a schema default (#d4af37), so once
    // corporate allows an accent override, a location that never chose a colour still renders
    // its own default instead of the shared brand. That is what the shop will really show, so
    // the screen reports it rather than pretending the location is inheriting.
    ok(shopBBrand?.usesOwnValue === true,
      'allowing an override means an existing location uses its own stored value, even a schema default')
    ok(shopBBrand?.resolved.find((f) => f.field === 'accentColor')?.source === 'location',
      'the shared accent is not used at a location whose own accent differs')

    // And a location whose own value matches the shared brand is not reported as customised.
    await prisma.business.update({ where: { id: shopB.id }, data: { accentColor: '#d4a853' } })
    const brandsAfterMatch = await loadLocationBrands(orgA.id)
    ok(brandsAfterMatch.find((b) => b.businessId === shopB.id)?.usesOwnValue === false,
      'a location whose value equals the shared brand is reported as using the shared brand')

    // --- Scope ----------------------------------------------------------------
    const otherOrg = await loadBrandSettings(orgB.id)
    ok(otherOrg?.primaryColor === null, 'another organization sees none of this brand')

    const secondSave = await saveBrandSettings(orgB.id, owner.id, { primaryColor: '#222222' })
    ok(secondSave.ok === true, 'a second organization keeps its own brand')
    const aAfter = await loadBrandSettings(orgA.id)
    ok(aAfter?.primaryColor === '#1a1a1a', 'saving one organization does not change another')

    // --- Capabilities ---------------------------------------------------------
    ok(can('ORGANIZATION_OWNER', 'branding.manage') === true, 'an organization owner may change the brand')
    ok(can('CORPORATE_ADMIN', 'branding.manage') === true, 'a corporate admin may change the brand')
    ok(can('REGIONAL_MANAGER', 'branding.manage') === false, 'a regional manager may not change the brand')
    ok(can('FRANCHISE_OWNER', 'branding.manage') === false, 'a franchise owner may not change the brand')
    ok(can('REGIONAL_MANAGER', 'branding.read') === true, 'a regional manager may still read it')
  } finally {
    await prisma.organizationConfigAudit.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
    await prisma.organizationBrandSettings.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
    await prisma.organizationLocation.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {})
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => {})
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } }).catch(() => {})
  }

  console.log(`\nOrganization branding: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })

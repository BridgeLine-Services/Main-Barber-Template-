/**
 * The organization overview against real records.
 *
 * The other organization-dashboard suite proves the words and the page structure. This one
 * proves the data path the page actually runs: who resolves to which locations, and what
 * the report says when one location cannot be read. It writes its own organization, three
 * shops and a handful of appointments and payments, then removes them, and it touches no
 * existing record.
 *
 * Run: npx tsx tests/organization-dashboard-data.test.ts  (needs the test database)
 */

import { prisma } from '../src/lib/prisma'
import { resolveOrganizationContext } from '../src/lib/organization/resolve'
import { buildOrganizationReport } from '../src/lib/organization/reporting'
import { loadLocationRefs, loadLocationRollup } from '../src/lib/organization/report-query'
import { aggregateOnlyGuard } from '../src/lib/organization/privacy'
import { summaryMetrics, locationViews, unverifiedNotice, UNVERIFIED } from '../src/lib/organization/dashboard-view'

let passed = 0
let failed = 0
function ok(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

async function makeShop(label: string) {
  return prisma.business.create({
    data: {
      name: `Org ${label} ${stamp}`,
      slug: `org-${label}-${stamp}`,
      email: `org-${label}-${stamp}@test.example`,
      phone: '555-0100',
      address: '1 Test Way',
      city: 'Testville',
      state: 'CA',
      zipCode: '90001',
      timezone: 'America/Los_Angeles',
    },
  })
}

async function main() {
  const created = {
    businessIds: [] as string[],
    userIds: [] as string[],
    organizationId: '' as string,
  }

  try {
    console.log('\n--- setting up an organization with three locations ---')
    const north = await makeShop('north')
    const south = await makeShop('south')
    const closed = await makeShop('closed')
    created.businessIds.push(north.id, south.id, closed.id)

    const organization = await prisma.organization.create({
      data: { name: `Test Group ${stamp}`, slug: `test-group-${stamp}` },
    })
    created.organizationId = organization.id

    for (const [business, region, status] of [
      [north, 'north', 'active'],
      [south, 'south', 'active'],
      [closed, 'north', 'closed'],
    ] as const) {
      await prisma.organizationLocation.create({
        data: { organizationId: organization.id, businessId: business.id, region, status },
      })
    }

    const owner = await prisma.user.create({
      data: {
        email: `owner-${stamp}@test.example`,
        passwordHash: 'not-a-real-password-hash',
        name: 'Owner',
        role: 'OWNER',
        businessId: north.id,
      },
    })
    const regional = await prisma.user.create({
      data: {
        email: `regional-${stamp}@test.example`,
        passwordHash: 'not-a-real-password-hash',
        name: 'Regional',
        role: 'OWNER',
        businessId: south.id,
      },
    })
    const locationManager = await prisma.user.create({
      data: {
        email: `locmgr-${stamp}@test.example`,
        passwordHash: 'not-a-real-password-hash',
        name: 'Location manager',
        role: 'BARBER',
        businessId: south.id,
      },
    })
    const outsider = await prisma.user.create({
      data: {
        email: `outsider-${stamp}@test.example`,
        passwordHash: 'not-a-real-password-hash',
        name: 'Single shop',
        role: 'OWNER',
        businessId: south.id,
      },
    })
    created.userIds.push(owner.id, regional.id, locationManager.id, outsider.id)

    await prisma.organizationMember.create({
      data: { organizationId: organization.id, userId: owner.id, role: 'ORGANIZATION_OWNER', status: 'ACTIVE', regions: [] },
    })
    await prisma.organizationMember.create({
      data: { organizationId: organization.id, userId: regional.id, role: 'REGIONAL_MANAGER', status: 'ACTIVE', regions: ['north'] },
    })
    await prisma.organizationMember.create({
      data: { organizationId: organization.id, userId: locationManager.id, role: 'FRANCHISE_OWNER', status: 'ACTIVE', regions: [] },
    })

    // One real appointment and two settled payments at the north shop.
    const barber = await prisma.barber.create({ data: { name: 'Barber', businessId: north.id } })
    const service = await prisma.service.create({
      data: { businessId: north.id, name: 'Cut', duration: 30, price: 40, isActive: true },
    })
    const customer = await prisma.customer.create({
      data: { businessId: north.id, firstName: 'A', lastName: 'Person', email: `c-${stamp}@test.example`, phone: '555-0111' },
    })
    const start = new Date(Date.now() - 2 * 86_400_000)
    await prisma.appointment.create({
      data: {
        confirmationNumber: `ORG-${stamp}`,
        customerAccessToken: `tok-${stamp}`,
        businessId: north.id,
        customerId: customer.id,
        barberId: barber.id,
        serviceId: service.id,
        startTime: start,
        endTime: new Date(start.getTime() + 30 * 60_000),
        status: 'COMPLETED',
      },
    })
    await prisma.payment.create({
      data: {
        businessId: north.id,
        customerId: customer.id,
        kind: 'CHARGE',
        method: 'CASH',
        provider: 'in_person',
        amount: 40,
        status: 'SUCCEEDED',
        createdAt: start,
      },
    })
    await prisma.payment.create({
      data: {
        businessId: north.id,
        customerId: customer.id,
        kind: 'REFUND',
        method: 'CASH',
        provider: 'in_person',
        amount: 10,
        refundedAmount: 10,
        status: 'REFUNDED',
        createdAt: start,
      },
    })

    console.log('\n--- who may see which locations ---')
    const ownerContext = await resolveOrganizationContext(owner.id)
    ok(ownerContext.ok, 'the owner resolves to their organization')
    ok(ownerContext.context!.organizationId === organization.id, 'the organization comes from the membership, not the browser')
    ok(ownerContext.context!.locationBusinessIds.length === 2, 'a closed location is not counted as one the owner can manage')
    ok(ownerContext.context!.locationBusinessIds.includes(north.id) && ownerContext.context!.locationBusinessIds.includes(south.id), 'both open locations are visible to the owner')
    ok(!ownerContext.context!.locationBusinessIds.includes(closed.id), 'the closed location is excluded')

    const regionalContext = await resolveOrganizationContext(regional.id)
    ok(regionalContext.ok, 'the regional manager resolves to the organization')
    ok(regionalContext.context!.locationBusinessIds.length === 1 && regionalContext.context!.locationBusinessIds[0] === north.id, 'a regional manager sees only their region, and not the closed shop in it')

    const locMgrContext = await resolveOrganizationContext(locationManager.id)
    ok(locMgrContext.ok, 'the location manager resolves to the organization')
    ok(locMgrContext.context!.locationBusinessIds.length === 1 && locMgrContext.context!.locationBusinessIds[0] === south.id, 'a location manager sees only the location they work at')

    const outsiderContext = await resolveOrganizationContext(outsider.id)
    ok(!outsiderContext.ok && outsiderContext.context === null, 'a single-shop user resolves to no organization')
    ok(outsiderContext.reason === 'no-membership', 'and is told why, so the page can offer their shop dashboard')

    console.log('\n--- the figures the page shows ---')
    const range = { start: new Date(Date.now() - 30 * 86_400_000), end: new Date(), label: 'the last 30 days' }
    const refs = await loadLocationRefs(ownerContext.context!.locationBusinessIds)
    ok(refs.length === 2, 'the page loads exactly the locations the context allows')
    const rollups = await Promise.all(refs.map((ref) => loadLocationRollup(ref, range)))
    const report = buildOrganizationReport(organization.id, rollups, { generatedAt: new Date().toISOString(), rangeLabel: range.label })

    ok(report.totals.appointments === 1, 'appointments are counted for the period')
    ok(report.totals.completed === 1, 'completed appointments are counted')
    ok(report.totals.grossRevenueCents === 4000, 'money taken before refunds is read from settled payments')
    ok(report.totals.refundsCents === 1000, 'refunds are read separately')
    ok(report.totals.netRevenueCents === 3000, 'money after refunds is gross minus refunds')
    ok(report.totals.profitCents === null, 'no profit figure is invented')

    const guard = aggregateOnlyGuard(report)
    ok(guard.safe, 'the report contains no customer identity')
    const serialised = JSON.stringify(report)
    ok(!/firstName|lastName|"email"|"phone"|customerName/i.test(serialised), 'no customer name, email or phone appears anywhere in it')

    const metrics = summaryMetrics(report)
    ok(metrics.some((m) => m.label === 'Money taken after refunds' && m.value.startsWith('$')), 'money is shown in plain words with a real figure')
    ok(locationViews(report).length === 2, 'each visible location gets its own card')

    console.log('\n--- a readable shop with nothing in it ---')
    const quiet = rollups.find((r) => r.businessId === south.id)
    ok(quiet !== undefined, 'the second shop is present in the report')
    ok(quiet!.appointments === 0 && quiet!.netRevenueCents === 0, 'a shop that simply had no trade reads zero, which is a fact')
    ok(report.totals.netRevenueCents === 3000, 'and its zero does not disturb the organization total')

    console.log('\n--- one location whose figures could not be read ---')
    // This is the shape loadLocationRollup returns when a query fails: every figure null,
    // never zero. The page must not present it as a quiet shop.
    const unreadable = {
      businessId: `unreadable-${stamp}`,
      name: 'Shop we cannot read',
      region: null,
      status: 'active',
      grossRevenueCents: null,
      refundsCents: null,
      netRevenueCents: null,
      commissionsCents: null,
      recordedExpensesCents: null,
      appointments: null,
      completed: null,
      cancelled: null,
      newCustomers: null,
      returningCustomers: null,
      activeMemberships: null,
      membershipRevenueCents: null,
      utilisationPercent: null,
      staffCount: null,
    }
    const partial = buildOrganizationReport(organization.id, [...rollups, unreadable], {
      generatedAt: new Date().toISOString(),
      rangeLabel: range.label,
    })
    ok(partial.totals.netRevenueCents === null, 'the organization total is not a smaller sum over the shops that answered')
    ok(partial.unverifiedLocations.includes('Shop we cannot read'), 'the page can name the location it could not read')
    const partialMetrics = summaryMetrics(partial)
    ok(partialMetrics.every((m) => m.value === UNVERIFIED), 'every affected figure reads "Could not verify"')
    const notice = unverifiedNotice(partial)
    ok(Boolean(notice && notice.includes('Shop we cannot read')), 'the notice names the location and says the total is not complete')
  } finally {
    // Remove only what this test created, in dependency order.
    if (created.organizationId) {
      await prisma.organizationMember.deleteMany({ where: { organizationId: created.organizationId } })
      await prisma.organizationLocation.deleteMany({ where: { organizationId: created.organizationId } })
      await prisma.organization.deleteMany({ where: { id: created.organizationId } })
    }
    for (const businessId of created.businessIds) {
      await prisma.payment.deleteMany({ where: { businessId } })
      await prisma.appointment.deleteMany({ where: { businessId } })
      await prisma.customer.deleteMany({ where: { businessId } })
      await prisma.service.deleteMany({ where: { businessId } })
      await prisma.barber.deleteMany({ where: { businessId } })
      await prisma.business.deleteMany({ where: { id: businessId } })
    }
    if (created.userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: created.userIds } } })
    await prisma.$disconnect()
  }

  console.log(`\nOrganization dashboard data: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error('Test error:', error)
  await prisma.$disconnect()
  process.exit(1)
})

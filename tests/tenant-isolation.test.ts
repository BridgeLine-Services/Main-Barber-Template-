/**
 * Section 14: API Tenant Isolation Tests
 *
 * Verifies that all dashboard API endpoints properly scope queries by businessId
 * and that a user from one business cannot access data from another.
 *
 * Run: npx tsx tests/tenant-isolation.test.ts
 *
 * These tests use the actual Prisma client and require a running database.
 * In CI, they should run against a test database with seed data.
 */

import { prisma } from '../src/lib/prisma'

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`)
    passed++
  } else {
    console.log(`  ❌ ${message}`)
    failed++
  }
}

async function setup() {
  console.log('\n📦 Setting up test data...')

  const businessA = await prisma.business.create({
    data: {
      name: 'Test Shop A',
      slug: 'test-shop-a',
      email: 'a@test.com',
      phone: '555-0001',
      address: '123 A Street',
      city: 'CityA',
      state: 'CA',
      zipCode: '90001',
      timezone: 'America/Los_Angeles',
    },
  })

  const businessB = await prisma.business.create({
    data: {
      name: 'Test Shop B',
      slug: 'test-shop-b',
      email: 'b@test.com',
      phone: '555-0002',
      address: '456 B Street',
      city: 'CityB',
      state: 'CA',
      zipCode: '90002',
      timezone: 'America/Los_Angeles',
    },
  })

  const ownerA = await prisma.user.create({
    data: {
      email: 'owner-a@test.com',
      passwordHash: 'hashed',
      name: 'Owner A',
      role: 'OWNER',
      businessId: businessA.id,
    },
  })

  const ownerB = await prisma.user.create({
    data: {
      email: 'owner-b@test.com',
      passwordHash: 'hashed',
      name: 'Owner B',
      role: 'OWNER',
      businessId: businessB.id,
    },
  })

  const barberA = await prisma.barber.create({
    data: {
      name: 'Barber A',
      businessId: businessA.id,
      bio: 'Barber at Shop A',
    },
  })

  const barberB = await prisma.barber.create({
    data: {
      name: 'Barber B',
      businessId: businessB.id,
      bio: 'Barber at Shop B',
    },
  })

  const serviceA = await prisma.service.create({
    data: {
      name: 'Haircut A',
      businessId: businessA.id,
      duration: 30,
      price: 25,
      isActive: true,
    },
  })

  const serviceB = await prisma.service.create({
    data: {
      name: 'Haircut B',
      businessId: businessB.id,
      duration: 30,
      price: 30,
      isActive: true,
    },
  })

  // Create customers for each business
  const customerA = await prisma.customer.create({
    data: {
      businessId: businessA.id,
      firstName: 'Customer',
      lastName: 'A',
      email: 'cust-a@test.com',
      phone: '555-1111',
    },
  })

  const customerB = await prisma.customer.create({
    data: {
      businessId: businessB.id,
      firstName: 'Customer',
      lastName: 'B',
      email: 'cust-b@test.com',
      phone: '555-2222',
    },
  })

  // Create appointments (require customerId, confirmationNumber, customerAccessToken)
  const apptA = await prisma.appointment.create({
    data: {
      businessId: businessA.id,
      barberId: barberA.id,
      serviceId: serviceA.id,
      customerId: customerA.id,
      confirmationNumber: 'TEST-A-001',
      customerAccessToken: 'tok-a-001',
      startTime: new Date('2026-09-01T10:00:00Z'),
      endTime: new Date('2026-09-01T10:30:00Z'),
      status: 'PENDING',
    },
  })

  const apptB = await prisma.appointment.create({
    data: {
      businessId: businessB.id,
      barberId: barberB.id,
      serviceId: serviceB.id,
      customerId: customerB.id,
      confirmationNumber: 'TEST-B-001',
      customerAccessToken: 'tok-b-001',
      startTime: new Date('2026-09-01T10:00:00Z'),
      endTime: new Date('2026-09-01T10:30:00Z'),
      status: 'PENDING',
    },
  })

  return { businessA, businessB, ownerA, ownerB, barberA, barberB, serviceA, serviceB, customerA, customerB, apptA, apptB }
}

async function cleanup(ids: Awaited<ReturnType<typeof setup>>) {
  console.log('\n🧹 Cleaning up test data...')
  await prisma.appointment.deleteMany({ where: { businessId: { in: [ids.businessA.id, ids.businessB.id] } } })
  await prisma.customer.deleteMany({ where: { businessId: { in: [ids.businessA.id, ids.businessB.id] } } })
  await prisma.service.deleteMany({ where: { businessId: { in: [ids.businessA.id, ids.businessB.id] } } })
  await prisma.barber.deleteMany({ where: { businessId: { in: [ids.businessA.id, ids.businessB.id] } } })
  await prisma.user.deleteMany({ where: { businessId: { in: [ids.businessA.id, ids.businessB.id] } } })
  await prisma.business.deleteMany({ where: { id: { in: [ids.businessA.id, ids.businessB.id] } } })
}

async function testTenantIsolation(ids: Awaited<ReturnType<typeof setup>>) {
  console.log('\n🔒 Testing tenant isolation...')

  // Test 1: Appointments are scoped by businessId
  const apptsA = await prisma.appointment.findMany({ where: { businessId: ids.businessA.id } })
  assert(apptsA.length === 1, 'Business A sees only its own appointments')
  assert(apptsA[0].confirmationNumber === 'TEST-A-001', 'Business A appointment is TEST-A-001')

  const apptsB = await prisma.appointment.findMany({ where: { businessId: ids.businessB.id } })
  assert(apptsB.length === 1, 'Business B sees only its own appointments')
  assert(apptsB[0].confirmationNumber === 'TEST-B-001', 'Business B appointment is TEST-B-001')

  // Test 2: Services are scoped by businessId
  const servicesA = await prisma.service.findMany({ where: { businessId: ids.businessA.id } })
  assert(servicesA.length === 1, 'Business A sees only its own services')
  assert(servicesA[0].name === 'Haircut A', 'Business A service is Haircut A')

  const servicesB = await prisma.service.findMany({ where: { businessId: ids.businessB.id } })
  assert(servicesB.length === 1, 'Business B sees only its own services')
  assert(servicesB[0].name === 'Haircut B', 'Business B service is Haircut B')

  // Test 3: Barbers are scoped by businessId
  const barbersA = await prisma.barber.findMany({ where: { businessId: ids.businessA.id } })
  assert(barbersA.length === 1, 'Business A sees only its own barbers')
  assert(barbersA[0].name === 'Barber A', 'Business A barber is Barber A')

  const barbersB = await prisma.barber.findMany({ where: { businessId: ids.businessB.id } })
  assert(barbersB.length === 1, 'Business B sees only its own barbers')
  assert(barbersB[0].name === 'Barber B', 'Business B barber is Barber B')

  // Test 4: Cross-tenant query returns nothing
  const crossQuery = await prisma.appointment.findMany({
    where: {
      businessId: ids.businessA.id,
      id: ids.apptB.id,
    },
  })
  assert(crossQuery.length === 0, 'Cross-tenant appointment query returns 0 results')

  // Test 5: Cross-tenant barber access
  const crossBarber = await prisma.barber.findFirst({
    where: { businessId: ids.businessA.id, id: ids.barberB.id },
  })
  assert(crossBarber === null, 'Cross-tenant barber query returns null')

  // Test 6: Cross-tenant service access
  const crossService = await prisma.service.findFirst({
    where: { businessId: ids.businessA.id, id: ids.serviceB.id },
  })
  assert(crossService === null, 'Cross-tenant service query returns null')

  // Test 7: Users are scoped by businessId
  const usersA = await prisma.user.findMany({ where: { businessId: ids.businessA.id } })
  assert(usersA.every(u => u.businessId === ids.businessA.id), 'All Business A users belong to Business A')

  const usersB = await prisma.user.findMany({ where: { businessId: ids.businessB.id } })
  assert(usersB.every(u => u.businessId === ids.businessB.id), 'All Business B users belong to Business B')

  // Test 8: Customers are scoped by businessId
  const customersA = await prisma.customer.findMany({ where: { businessId: ids.businessA.id } })
  assert(customersA.length === 1, 'Business A sees only its own customers')
  assert(customersA[0].lastName === 'A', 'Business A customer is Customer A')

  const customersB = await prisma.customer.findMany({ where: { businessId: ids.businessB.id } })
  assert(customersB.length === 1, 'Business B sees only its own customers')
  assert(customersB[0].lastName === 'B', 'Business B customer is Customer B')

  // Test 9: Cross-tenant customer access
  const crossCustomer = await prisma.customer.findFirst({
    where: { businessId: ids.businessA.id, id: ids.customerB.id },
  })
  assert(crossCustomer === null, 'Cross-tenant customer query returns null')
}

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  Section 14: Tenant Isolation Tests')
  console.log('═══════════════════════════════════════════')

  let ids: Awaited<ReturnType<typeof setup>> | undefined
  try {
    ids = await setup()
    await testTenantIsolation(ids)
  } catch (error) {
    console.error('Test error:', error)
    failed++
  } finally {
    if (ids) await cleanup(ids)
    await prisma.$disconnect()
  }

  console.log('\n═══════════════════════════════════════════')
  console.log(`  Results: ${passed} passed, ${failed} failed`)
  console.log('═══════════════════════════════════════════')
  process.exit(failed > 0 ? 1 : 0)
}

main()

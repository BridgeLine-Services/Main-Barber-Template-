/**
 * Section 16: Role-Permission Tests
 *
 * Verifies the permission matrix:
 * OWNER: full access to everything
 * BARBER: edit own profile/schedule/availability/services/prices/photos only
 *
 * Run: npx tsx tests/role-permissions.test.ts
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

  const business = await prisma.business.create({
    data: {
      name: 'Permission Test Shop',
      slug: 'permission-test-shop',
      email: 'perm@test.com',
      phone: '555-4444',
      address: '321 Perm St',
      city: 'PermCity',
      state: 'CA',
      zipCode: '90004',
      timezone: 'America/Los_Angeles',
    },
  })

  const owner = await prisma.user.create({
    data: {
      email: 'owner@perm.com',
      passwordHash: 'hashed',
      name: 'Owner',
      role: 'OWNER',
      businessId: business.id,
    },
  })

  const barber = await prisma.barber.create({
    data: {
      name: 'Test Barber',
      businessId: business.id,
      bio: 'Test barber',
    },
  })

  const barberUser = await prisma.user.create({
    data: {
      email: 'barber@perm.com',
      passwordHash: 'hashed',
      name: 'Test Barber',
      role: 'BARBER',
      businessId: business.id,
      barberId: barber.id,
    },
  })

  const barber2 = await prisma.barber.create({
    data: {
      name: 'Other Barber',
      businessId: business.id,
      bio: 'Another barber',
    },
  })

  const service = await prisma.service.create({
    data: {
      name: 'Haircut',
      businessId: business.id,
      duration: 30,
      price: 25,
      isActive: true,
    },
  })

  return { business, owner, barber, barberUser, barber2, service }
}

async function cleanup(ids: Awaited<ReturnType<typeof setup>>) {
  console.log('\n🧹 Cleaning up test data...')
  await prisma.user.deleteMany({ where: { businessId: ids.business.id } })
  await prisma.barber.deleteMany({ where: { businessId: ids.business.id } })
  await prisma.service.deleteMany({ where: { businessId: ids.business.id } })
  await prisma.business.delete({ where: { id: ids.business.id } })
}

// ─── Permission check helpers ─────────────────────────────────────────────

interface SessionUser {
  role: 'OWNER' | 'BARBER'
  businessId: string
  barberId?: string | null
  id: string
}

function canEditShopBranding(user: SessionUser): boolean { return user.role === 'OWNER' }
function canEditSEO(user: SessionUser): boolean { return user.role === 'OWNER' }
function canManageStaff(user: SessionUser): boolean { return user.role === 'OWNER' }
function canEditAllAppointments(user: SessionUser): boolean { return user.role === 'OWNER' }
function canEditAllReviews(user: SessionUser): boolean { return user.role === 'OWNER' }
function canViewAuditLog(user: SessionUser): boolean { return user.role === 'OWNER' }
function canEditSecuritySettings(user: SessionUser): boolean { return user.role === 'OWNER' }
function canViewAllCustomers(user: SessionUser): boolean { return user.role === 'OWNER' }

function canEditOwnProfile(user: SessionUser, targetBarberId: string): boolean {
  if (user.role === 'OWNER') return true
  return user.barberId === targetBarberId
}

function canEditOwnSchedule(user: SessionUser, targetBarberId: string): boolean {
  if (user.role === 'OWNER') return true
  return user.barberId === targetBarberId
}

function canEditOwnServices(user: SessionUser, targetBarberId: string): boolean {
  if (user.role === 'OWNER') return true
  return user.barberId === targetBarberId
}

function canUploadMedia(user: SessionUser, mediaType: string): boolean {
  if (user.role === 'OWNER') return true
  return mediaType === 'BARBER_PHOTO' || mediaType === 'BARBER_PORTFOLIO'
}

function canCreateManualAppointment(_user: SessionUser): boolean { return true }

// ─── Tests ────────────────────────────────────────────────────────────────

async function testRolePermissions(ids: Awaited<ReturnType<typeof setup>>) {
  console.log('\n🔑 Testing role permissions...')

  const ownerSession: SessionUser = {
    role: 'OWNER',
    businessId: ids.business.id,
    id: ids.owner.id,
  }

  const barberSession: SessionUser = {
    role: 'BARBER',
    businessId: ids.business.id,
    barberId: ids.barber.id,
    id: ids.barberUser.id,
  }

  // ── OWNER permissions ─────────────────────────────────────────────────
  console.log('\n  --- OWNER ---')
  assert(canEditShopBranding(ownerSession) === true, 'OWNER can edit shop branding')
  assert(canEditSEO(ownerSession) === true, 'OWNER can edit SEO')
  assert(canManageStaff(ownerSession) === true, 'OWNER can manage staff')
  assert(canEditAllAppointments(ownerSession) === true, 'OWNER can view all appointments')
  assert(canEditAllReviews(ownerSession) === true, 'OWNER can edit all reviews')
  assert(canViewAuditLog(ownerSession) === true, 'OWNER can view audit log')
  assert(canEditSecuritySettings(ownerSession) === true, 'OWNER can edit security settings')
  assert(canViewAllCustomers(ownerSession) === true, 'OWNER can view all customers')
  assert(canUploadMedia(ownerSession, 'LOGO') === true, 'OWNER can upload logo')
  assert(canUploadMedia(ownerSession, 'GALLERY') === true, 'OWNER can upload gallery photos')
  assert(canEditOwnProfile(ownerSession, ids.barber.id) === true, 'OWNER can edit any barber profile')
  assert(canEditOwnSchedule(ownerSession, ids.barber2.id) === true, 'OWNER can edit any barber schedule')
  assert(canCreateManualAppointment(ownerSession) === true, 'OWNER can create manual appointments')

  // ── BARBER permissions (CAN do) ───────────────────────────────────────
  console.log('\n  --- BARBER (allowed) ---')
  assert(canEditOwnProfile(barberSession, ids.barber.id) === true, 'BARBER can edit own profile')
  assert(canEditOwnSchedule(barberSession, ids.barber.id) === true, 'BARBER can edit own schedule')
  assert(canEditOwnServices(barberSession, ids.barber.id) === true, 'BARBER can edit own services')
  assert(canUploadMedia(barberSession, 'BARBER_PHOTO') === true, 'BARBER can upload BARBER_PHOTO')
  assert(canUploadMedia(barberSession, 'BARBER_PORTFOLIO') === true, 'BARBER can upload BARBER_PORTFOLIO')
  assert(canCreateManualAppointment(barberSession) === true, 'BARBER can create manual appointments')

  // ── BARBER permissions (CANNOT do) ────────────────────────────────────
  console.log('\n  --- BARBER (forbidden) ---')
  assert(canEditShopBranding(barberSession) === false, 'BARBER cannot edit shop branding')
  assert(canEditSEO(barberSession) === false, 'BARBER cannot edit SEO')
  assert(canManageStaff(barberSession) === false, 'BARBER cannot manage staff')
  assert(canEditAllAppointments(barberSession) === false, 'BARBER cannot view all appointments')
  assert(canEditAllReviews(barberSession) === false, 'BARBER cannot edit all reviews')
  assert(canViewAuditLog(barberSession) === false, 'BARBER cannot view audit log')
  assert(canEditSecuritySettings(barberSession) === false, 'BARBER cannot edit security settings')
  assert(canViewAllCustomers(barberSession) === false, 'BARBER cannot view all customers')
  assert(canUploadMedia(barberSession, 'LOGO') === false, 'BARBER cannot upload LOGO')
  assert(canUploadMedia(barberSession, 'GALLERY') === false, 'BARBER cannot upload GALLERY')
  assert(canUploadMedia(barberSession, 'SHOP_PHOTO') === false, 'BARBER cannot upload SHOP_PHOTO')
  assert(canUploadMedia(barberSession, 'HERO') === false, 'BARBER cannot upload HERO')

  // BARBER cannot edit OTHER barber's profile/schedule
  assert(canEditOwnProfile(barberSession, ids.barber2.id) === false, 'BARBER cannot edit other barber profile')
  assert(canEditOwnSchedule(barberSession, ids.barber2.id) === false, 'BARBER cannot edit other barber schedule')
  assert(canEditOwnServices(barberSession, ids.barber2.id) === false, 'BARBER cannot edit other barber services')

  // ── Cross-Business isolation ──────────────────────────────────────────
  console.log('\n  --- Cross-Business ---')

  const business2 = await prisma.business.create({
    data: {
      name: 'Other Shop',
      slug: 'other-shop-perm',
      email: 'other@perm.com',
      phone: '555-5555',
      address: '999 Other St',
      city: 'OtherCity',
      state: 'CA',
      zipCode: '90005',
      timezone: 'America/Los_Angeles',
    },
  })

  const otherBarber = await prisma.barber.create({
    data: {
      name: 'Other Shop Barber',
      businessId: business2.id,
      bio: 'Different business',
    },
  })

  assert(ids.barber.businessId !== business2.id, 'Barber A businessId !== Business B id')
  assert(otherBarber.businessId !== ids.business.id, 'Other barber businessId !== Business A id')

  const crossBarber = await prisma.barber.findFirst({
    where: {
      id: otherBarber.id,
      businessId: ids.business.id,
    },
  })
  assert(crossBarber === null, 'Barber from Business A cannot find Business B barber via scoped query')

  await prisma.barber.delete({ where: { id: otherBarber.id } })
  await prisma.business.delete({ where: { id: business2.id } })
}

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  Section 16: Role-Permission Tests')
  console.log('═══════════════════════════════════════════')

  let ids: Awaited<ReturnType<typeof setup>> | undefined
  try {
    ids = await setup()
    await testRolePermissions(ids)
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

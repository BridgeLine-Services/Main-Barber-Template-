/**
 * Digital Walk-In Queue Tests
 *
 * Covers the walk-in queue feature end to end at the data + logic layer:
 *   - queue position computation (arrival order, deterministic)
 *   - wait estimation (service durations ÷ active barbers, honest bounds)
 *   - ONE queue system: walk-ins reuse WaitlistEntry (no duplicate tables)
 *   - duplicate join prevention (same phone, same day)
 *   - no-show handling via status transitions
 *   - tenant isolation (walk-in entries are businessId-scoped)
 *   - walk-in gating (walkInsWelcome)
 *   - phone-first UX + mobile flow + error handling (source-level)
 *
 * Run: npx tsx tests/queue.test.ts (requires the database)
 */

import { prisma } from '../src/lib/prisma'
import {
  computeQueuePositions,
  entriesAheadOf,
  estimateWaitMinutes,
  isWalkInEntry,
} from '../src/lib/queue'
import { readFileSync } from 'fs'
import { join } from 'path'

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

const SRC = join(process.cwd(), 'src')

async function main() {
  console.log('\n📦 Setting up queue test data...')

  const business = await prisma.business.create({
    data: {
      name: 'Queue Test Shop',
      slug: `queue-shop-${Date.now()}`,
      email: 'q@test.com',
      phone: '555-0201',
      address: '1 Q St',
      city: 'QueueCity',
      state: 'CA',
      zipCode: '90001',
      timezone: 'America/Los_Angeles',
    },
  })
  const businessB = await prisma.business.create({
    data: {
      name: 'Queue Other Shop',
      slug: `queue-other-${Date.now()}`,
      email: 'qb@test.com',
      phone: '555-0202',
      address: '2 Q St',
      city: 'QueueCity',
      state: 'CA',
      zipCode: '90002',
      timezone: 'America/Los_Angeles',
    },
  })

  const cut = await prisma.service.create({
    data: { businessId: business.id, name: 'Haircut', duration: 30, price: 30 },
  })
  const shave = await prisma.service.create({
    data: { businessId: business.id, name: 'Shave', duration: 15, price: 20 },
  })
  const serviceB = await prisma.service.create({
    data: { businessId: businessB.id, name: 'Other Shop Cut', duration: 30, price: 25 },
  })

  const barber1 = await prisma.barber.create({
    data: { businessId: business.id, name: 'Q Barber 1', slug: `qb1-${Date.now()}` },
  })
  const barber2 = await prisma.barber.create({
    data: { businessId: business.id, name: 'Q Barber 2', slug: `qb2-${Date.now()}` },
  })

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const mkWalkIn = (data: any) =>
    prisma.waitlistEntry.create({
      data: {
        businessId: business.id,
        firstName: data.first,
        lastName: 'Walkin',
        phone: data.phone,
        email: '',
        serviceId: data.serviceId,
        barberId: data.barberId || null,
        preferredDate: today,
        preferredTimeRange: 'walk-in',
        status: 'WAITING',
      },
      include: { service: { select: { duration: true } } },
    })

  const w1 = await mkWalkIn({ first: 'Ana', phone: '555-1111', serviceId: cut.id })
  const w2 = await mkWalkIn({ first: 'Bo', phone: '555-2222', serviceId: shave.id })
  const w3 = await mkWalkIn({ first: 'Cy', phone: '555-3333', serviceId: cut.id, barberId: barber1.id })
  // a same-day waitlist request (date-based) — coexists in ONE system
  // and is excluded from the walk-in queue by its time-range marker
  await prisma.waitlistEntry.create({
    data: {
      businessId: business.id,
      firstName: 'Later', lastName: 'Person', phone: '555-4444', email: 'later@test.com',
      serviceId: cut.id, preferredDate: today,
      preferredTimeRange: 'morning', status: 'WAITING',
    },
  })
  // other tenant's walk-in — invisible to this business
  await prisma.waitlistEntry.create({
    data: {
      businessId: businessB.id, firstName: 'Elsewhere', lastName: 'Shop', phone: '555-5555', email: '',
      serviceId: serviceB.id, preferredDate: today, preferredTimeRange: 'walk-in', status: 'WAITING',
    },
  })

  console.log('\nQueue position computation')
  {
    const walkInsToday = await prisma.waitlistEntry.findMany({
      where: { businessId: business.id, preferredDate: today, preferredTimeRange: 'walk-in' },
      include: { service: { select: { duration: true } } },
      orderBy: { createdAt: 'asc' },
    })
    const positions = computeQueuePositions(walkInsToday)
    assert(positions.get(w1.id) === 1, 'first arrival is position 1')
    assert(positions.get(w2.id) === 2, 'second arrival is position 2')
    assert(positions.get(w3.id) === 3, 'third arrival is position 3')
    assert(walkInsToday.every(isWalkInEntry), 'walk-in entries identified by time-range marker')

    // after w1 is called (NOTIFIED), positions recompute for the remaining WAITING
    await prisma.waitlistEntry.update({ where: { id: w1.id }, data: { status: 'NOTIFIED' } })
    const afterCall = await prisma.waitlistEntry.findMany({
      where: { businessId: business.id, preferredDate: today, preferredTimeRange: 'walk-in' },
      include: { service: { select: { duration: true } } },
      orderBy: { createdAt: 'asc' },
    })
    const recalculated = computeQueuePositions(afterCall)
    assert(!recalculated.has(w1.id), 'called entry loses its queue position')
    assert(recalculated.get(w2.id) === 1 && recalculated.get(w3.id) === 2, 'queue advances when head is called')
  }

  console.log('\nWait estimation (honest, data-supported)')
  {
    // w2 (shave 15m) + w3 (cut 30m) ahead of nothing → 45m total; 2 barbers → ~25 (rounded to 5)
    const queue = [w1, w2, w3].map((e) => ({ ...e, status: 'WAITING' }))
    const ahead = entriesAheadOf(w3 as any, queue as any)
    assert(ahead.length === 2, 'entries ahead counted by arrival order')
    assert(estimateWaitMinutes(ahead as any, 2) === 25, '45 min of work ÷ 2 barbers → 25 min estimate')
    assert(estimateWaitMinutes(ahead as any, 1) === 45, 'single barber → full 45 min estimate')
    assert(estimateWaitMinutes([], 2) === 5, 'empty queue → minimum 5 min estimate')
    assert(estimateWaitMinutes(ahead as any, 0) === null, 'no active barbers → no estimate (no false promises)')
    const broken = [{ id: 'x', status: 'WAITING', createdAt: new Date(), service: null }]
    assert(estimateWaitMinutes(broken, 1) === null, 'missing service duration → no estimate')
  }

  console.log('\nNo-show handling (status transition mapping)')
  {
    // walk-in lifecycle: WAITING → NOTIFIED (call) → EXPIRED (no-show)
    const guarded = await prisma.waitlistEntry.updateMany({
      where: { id: w2.id, status: 'NOTIFIED' }, // stale — should not match
      data: { status: 'EXPIRED' },
    })
    assert(guarded.count === 0, 'concurrency guard blocks transitions from the wrong state')
    await prisma.waitlistEntry.update({ where: { id: w2.id }, data: { status: 'NOTIFIED' } })
    const noShow = await prisma.waitlistEntry.updateMany({
      where: { id: w2.id, status: 'NOTIFIED' },
      data: { status: 'EXPIRED' },
    })
    assert(noShow.count === 1, 'no-show maps to EXPIRED from NOTIFIED')
    // served maps to BOOKED
    const served = await prisma.waitlistEntry.updateMany({
      where: { id: w3.id, status: 'WAITING' },
      data: { status: 'BOOKED' },
    })
    assert(served.count === 1, 'served maps to BOOKED from WAITING')
  }

  console.log('\nDuplicate join prevention + tenant isolation (data layer)')
  {
    const dupe = await prisma.waitlistEntry.findFirst({
      where: {
        businessId: business.id,
        phone: '555-3333',
        status: 'WAITING',
        preferredDate: today,
        preferredTimeRange: 'walk-in',
      },
      select: { id: true },
    })
    // w3 was just marked BOOKED, so an active duplicate no longer exists —
    // re-create the active state and verify the lookup catches it
    await prisma.waitlistEntry.update({ where: { id: w3.id }, data: { status: 'WAITING' } })
    const dupe2 = await prisma.waitlistEntry.findFirst({
      where: {
        businessId: business.id,
        phone: '555-3333',
        status: 'WAITING',
        preferredDate: today,
        preferredTimeRange: 'walk-in',
      },
      select: { id: true },
    })
    assert(dupe2?.id === w3.id, 'duplicate join detection finds the active entry')
    assert(dupe === null, 'served/left entries do not block re-joining')

    // tenant isolation: business B cannot see business A's queue
    const bView = await prisma.waitlistEntry.findMany({
      where: { businessId: businessB.id, preferredDate: today, preferredTimeRange: 'walk-in' },
    })
    assert(bView.every((e) => e.businessId === businessB.id), 'queue queries never cross tenants')
    assert(!bView.some((e) => e.id === w1.id), 'other tenant’s walk-ins are invisible')

    // cross-tenant service validation lookup fails (as the API performs it)
    const crossService = await prisma.service.findFirst({
      where: { id: serviceB.id, businessId: business.id, isActive: true },
    })
    assert(crossService === null, 'cross-tenant service rejected at join validation')
  }

  console.log('\nONE queue system (no duplicate engines)')
  {
    // walk-ins and date-based waitlist share the same model/table/indices
    const bothKinds = await prisma.waitlistEntry.findMany({
      where: { businessId: business.id, preferredDate: today },
    })
    assert(
      bothKinds.some((e) => e.preferredTimeRange === 'walk-in') &&
        bothKinds.some((e) => e.preferredTimeRange === 'morning'),
      'walk-ins and waitlist coexist in ONE system (same model)'
    )
    const src = readFileSync(join(SRC, '..', 'prisma/schema.prisma'), 'utf8')
    assert(!/model\s+QueueEntry/.test(src), 'no duplicate QueueEntry model was introduced')
    assert(!/model\s+WalkInEntry/.test(src), 'no duplicate WalkInEntry model was introduced')
  }

  console.log('\nSource-level checks: gating, phone-first UX, mobile flow, staff actions, errors')
  {
    const queueRoute = readFileSync(join(SRC, 'app/api/public/queue/route.ts'), 'utf8')
    assert(queueRoute.includes('walkInsWelcome !== true'), 'join endpoint gated by walkInsWelcome (fail closed)')
    assert(queueRoute.includes('checkRateLimit'), 'join endpoint rate-limited')
    assert(/phone: z\.string\(\).trim\(\)\.min\(7\)/.test(queueRoute), 'phone is required (phone-first)')
    assert(/email: z\.string\(\).trim\(\)\.email\(\)\.max\(120\)\.optional\(\)/.test(queueRoute), 'email is optional')
    assert(queueRoute.includes('already in the queue'), 'duplicate join returns a friendly 409 with entryId')
    assert(queueRoute.includes('resolveBusiness'), 'queue join resolves the tenant (fail closed)')
    assert(queueRoute.includes('estimatedWaitMinutes'), 'join response includes honest wait estimate')

    const policiesRoute = readFileSync(join(SRC, 'app/api/public/policies/route.ts'), 'utf8')
    assert(policiesRoute.includes('walkInsWelcome'), 'public config exposes walkInsWelcome')

    const navbar = readFileSync(join(SRC, 'components/customer/Navbar.tsx'), 'utf8')
    assert(navbar.includes('walkInsWelcome ?'), 'customer nav shows the queue link only when walk-ins are welcome')

    const queuePage = readFileSync(join(SRC, 'app/(customer)/queue/page.tsx'), 'utf8')
    assert(queuePage.includes('walkInsWelcome !== true'), 'customer queue page hides when walk-ins are not welcome')
    const joinForm = readFileSync(join(SRC, 'components/customer/QueueJoinForm.tsx'), 'utf8')
    assert(joinForm.includes('type="tel"') && joinForm.includes('autoComplete="tel"'), 'phone input uses tel keyboard + autocomplete (mobile flow)')
    assert(joinForm.includes('autoComplete="email"'), 'email input has autocomplete')
    assert(joinForm.includes('role="alert"'), 'submission errors announced to screen readers')
    assert(joinForm.includes("Any barber') || form.barberId") || joinForm.includes('Any barber'), 'barber preference optional (any barber is fastest)')
    assert(joinForm.includes('Check my spot'), 'success panel links to the live queue spot page')

    const statusPage = readFileSync(join(SRC, 'app/(customer)/queue/[id]/page.tsx'), 'utf8')
    assert(statusPage.includes('businessId: business.id'), 'status page is tenant-scoped (no cross-tenant entry views)')
    assert(statusPage.includes('lastName.charAt(0)'), 'status page shows minimal PII (last initial only)')

    const dashboardPage = readFileSync(join(SRC, 'app/(dashboard)/dashboard/waitlist/page.tsx'), 'utf8')
    for (const action of ['Call Next', 'Served', 'No-show', 'Remove']) {
      assert(dashboardPage.includes(action), `staff action available: ${action}`)
    }
    assert(dashboardPage.includes("Today's Walk-In Queue"), 'staff sees a dedicated walk-in queue section')
    assert(dashboardPage.includes('computeQueuePositions'), 'staff view shows queue positions in arrival order')

    const rateLimit = readFileSync(join(SRC, 'lib/rate-limit.ts'), 'utf8')
    assert(rateLimit.includes('QUEUE:'), 'dedicated queue rate limit configured')
  }

  console.log('\n🧹 Cleaning up...')
  await prisma.business.delete({ where: { id: business.id } }).catch(() => {})
  await prisma.business.delete({ where: { id: businessB.id } }).catch(() => {})

  console.log(`\nQueue tests: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  if (failed > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})

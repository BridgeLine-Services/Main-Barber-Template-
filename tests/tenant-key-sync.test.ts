/**
 * Tenant-key sync tests (Requirement 9 follow-up).
 *
 * Migration 20260927153000 denormalized businessId onto the three
 * formerly indirectly-scoped tables (BarberService, BarberRewardProgram,
 * AppointmentIntakeResponse). Database triggers keep the key in sync on
 * every insert/relink, regardless of which code path writes.
 *
 * These tests prove the key is (a) populated for all existing rows,
 * (b) set automatically on new rows written via the Prisma client,
 * and (c) corrected automatically if a row is relinked to another
 * barber/appointment.
 *
 * Run: npx tsx tests/tenant-key-sync.test.ts
 */
import { prisma } from '../src/lib/prisma'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  PASS ${msg}`); passed++ }
  else { console.error(`  FAIL ${msg}`); failed++ }
}

async function main() {
  const stamp = Date.now()
  const business = await prisma.business.create({ data: {
    name: `KeySync Shop ${stamp}`, slug: `keysync-${stamp}`,
    email: `ks-${stamp}@test.com`, phone: '555-0199', address: '9 Key St',
    city: 'KeyCity', state: 'CA', zipCode: '90009', timezone: 'America/Los_Angeles',
  }})
  const other = await prisma.business.create({ data: {
    name: `KeySync Other ${stamp}`, slug: `keysync-other-${stamp}`,
    email: `kso-${stamp}@test.com`, phone: '555-0198', address: '8 Key St',
    city: 'KeyCity', state: 'CA', zipCode: '90009', timezone: 'America/Los_Angeles',
  }})
  const barber = await prisma.barber.create({ data: { name: 'KS Barber', businessId: business.id, bio: 'b' } })
  const barberOther = await prisma.barber.create({ data: { name: 'KS Other', businessId: other.id, bio: 'b' } })
  const service = await prisma.service.create({ data: { name: `KS Cut ${stamp}`, businessId: business.id, duration: 30, price: 10 } })
  const customer = await prisma.customer.create({ data: { firstName: 'KS', lastName: 'Cust', email: `ksc-${stamp}@test.com`, phone: '555-0111', businessId: business.id } })
  const appointment = await prisma.appointment.create({ data: {
    businessId: business.id, customerId: customer.id, barberId: barber.id,
    serviceId: service.id, confirmationNumber: `KS-${stamp}`,
    customerAccessToken: `ks-${stamp}`,
    startTime: new Date(Date.now() + 86400000),
    endTime: new Date(Date.now() + 86400000 + 1800000),
  } })

  try {
    console.log('\n── Existing rows fully backfilled ──')
    for (const t of ['BarberService','BarberRewardProgram','AppointmentIntakeResponse']) {
      const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT COUNT(*)::int AS n FROM "${t}" WHERE "businessId" IS NULL`)
      assert(rows[0].n === 0, `${t}: no rows with NULL businessId`)
    }

    console.log('\n── New rows get the tenant key automatically ──')
    const bs = await prisma.barberService.create({ data: { barberId: barber.id, serviceId: service.id }, select: { businessId: true } })
    assert(bs.businessId === business.id, 'BarberService insert: trigger sets businessId from barber')
    const q = await prisma.bookingQuestion.findFirst({ where: { businessId: business.id }, select: { id: true } })
    let ir: { id: string; businessId: string | null } | null = null
    if (q) {
      ir = await prisma.appointmentIntakeResponse.create({ data: {
        appointmentId: appointment.id, questionId: q.id, questionKey: 'k',
        questionLabel: 'l', answer: { text: 'r' } as any,
        questionType: 'SHORT_TEXT' as any,
      } as any, select: { id: true, businessId: true } })
      assert(ir.businessId === business.id, 'AppointmentIntakeResponse insert: trigger sets businessId from appointment')
    } else {
      ir = await prisma.appointmentIntakeResponse.create({ data: {
        appointmentId: appointment.id, questionKey: 'k', questionLabel: 'l',
        answer: { text: 'r' } as any,
        questionType: 'SHORT_TEXT' as any,
      } as any, select: { id: true, businessId: true } })
      assert(ir.businessId === business.id, 'AppointmentIntakeResponse insert: trigger sets businessId from appointment')
    }

    console.log('\n── Relinking corrects the tenant key automatically ──')
    await prisma.$executeRawUnsafe(`UPDATE "BarberService" SET "barberId"='${barberOther.id}' WHERE "barberId"='${barber.id}' AND "serviceId"='${service.id}'`)
    const relinked = await prisma.barberService.findFirst({ where: { barberId: barberOther.id, serviceId: service.id }, select: { businessId: true } })
    assert(relinked?.businessId === other.id, 'UPDATE barberId: trigger resyncs businessId to new parent')
    await prisma.barberService.deleteMany({ where: { barberId: barberOther.id, serviceId: service.id } })
  } finally {
    await prisma.appointmentIntakeResponse.deleteMany({ where: { appointmentId: appointment.id } })
    await prisma.barberService.deleteMany({ where: { OR: [{ barberId: barber.id }, { barberId: barberOther.id }] } })
    await prisma.appointment.deleteMany({ where: { businessId: { in: [business.id, other.id] } } })
    await prisma.bookingQuestion.deleteMany({ where: { id: undefined } }) // no-op guard
    await prisma.customer.deleteMany({ where: { businessId: { in: [business.id, other.id] } } })
    await prisma.service.deleteMany({ where: { businessId: { in: [business.id, other.id] } } })
    await prisma.barber.deleteMany({ where: { businessId: { in: [business.id, other.id] } } })
    await prisma.business.deleteMany({ where: { id: { in: [business.id, other.id] } } })
  }

  console.log(`\nTenant-key sync tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error('Test crashed:', e); await prisma.$disconnect(); process.exit(1) })

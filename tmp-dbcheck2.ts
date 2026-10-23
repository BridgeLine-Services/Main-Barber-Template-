import { prisma } from './src/lib/prisma'
async function main() {
  const bs = await prisma.business.findMany({ where: { slug: { startsWith: 'verify-shop-' } }, select: { id: true, slug: true, themeMode: true } })
  console.log(JSON.stringify(bs))
  for (const b of bs) {
    const appts = await prisma.appointment.findMany({ where: { businessId: b.id }, include: { customer: true } })
    console.log('appointments:', JSON.stringify(appts.map(a => ({ id: a.id, start: a.startTime, customer: a.customer.firstName + ' ' + a.customer.lastName })), null, 1).slice(0, 600))
    const cust = await prisma.customer.count({ where: { businessId: b.id } })
    console.log('customers:', cust)
  }
}
main().then(() => prisma.$disconnect())

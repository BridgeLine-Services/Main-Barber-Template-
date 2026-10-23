import { prisma } from './src/lib/prisma'
async function main() {
  const stale = await prisma.business.findMany({
    where: { slug: { startsWith: 'verify-shop-' } },
    select: { id: true, slug: true },
  })
  // keep the newest complete shop, drop the partial one
  const keep = stale[stale.length - 1]
  for (const s of stale.filter((x) => x.id !== keep.id)) {
    await prisma.auditLog.deleteMany({ where: { businessId: s.id } }).catch(() => {})
    await prisma.service.deleteMany({ where: { businessId: s.id } }).catch(() => {})
    await prisma.websiteContent.deleteMany({ where: { businessId: s.id } }).catch(() => {})
    await prisma.user.deleteMany({ where: { businessId: s.id } }).catch(() => {})
    await prisma.business.delete({ where: { id: s.id } }).catch(() => {})
    console.log('removed partial shop', s.slug)
  }
  console.log('kept', keep.slug, await prisma.user.count({ where: { businessId: keep.id } }), 'users')
}
main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1) })

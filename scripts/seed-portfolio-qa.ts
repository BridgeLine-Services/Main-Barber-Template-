/**
 * QA seed: real published portfolio assets for the test shop so the
 * featured-work section (chips, attribution, lightbox) renders with data.
 * Idempotent — removes previously seeded QA assets first.
 * Run: bash -c 'set -a; source ../local.env; set +a; npx tsx scripts/seed-portfolio-qa.ts'
 */
import { prisma } from '../src/lib/prisma'

async function main() {
  const business = await prisma.business.findFirst({ select: { id: true, slug: true } })
  if (!business) throw new Error('no business found')

  // Idempotent: clear previously seeded QA assets (QA url pattern)
  await prisma.beforeAfterPair.deleteMany({ where: { businessId: business.id, caption: { contains: 'QA seed' } } })
  const old = await prisma.mediaAsset.findMany({
    where: { businessId: business.id, url: { contains: '/qa-media/' } },
    select: { id: true },
  })
  await prisma.mediaAsset.deleteMany({ where: { id: { in: old.map((a) => a.id) } } })

  const barber = await prisma.barber.findFirst({ where: { businessId: business.id, isActive: true }, select: { id: true, slug: true } })
  const services = await prisma.service.findMany({
    where: { businessId: business.id, isActive: true },
    select: { id: true, name: true },
  })
  const svc = (needle: string) => services.find((s) => s.name.toLowerCase().includes(needle))

  const haircut = svc('haircut + beard') ?? svc('haircut')
  const beard = svc('beard')
  const kids = svc('kids')
  const premium = svc('premium')

  const img = (n: number) => `/qa-media/p${n}.svg`

  const assets = [
    { url: img(1), caption: 'Classic taper with crisp line-up', serviceId: haircut?.id ?? null, focalX: 50, focalY: 30 },
    { url: img(2), caption: 'Skin fade, mid burst', serviceId: haircut?.id ?? null, focalX: 45, focalY: 35 },
    { url: img(3), caption: 'Beard sculpt + hot towel', serviceId: beard?.id ?? null, focalX: 50, focalY: 45 },
    { url: img(4), caption: 'Sharp beard detail work', serviceId: beard?.id ?? null, focalX: 55, focalY: 40 },
    { url: img(5), caption: 'First haircut, happy client', serviceId: kids?.id ?? null, focalX: 50, focalY: 40 },
    { url: img(6), caption: 'Premium cut — full service', serviceId: premium?.id ?? null, focalX: 40, focalY: 30 },
  ]

  for (const [i, a] of assets.entries()) {
    await prisma.mediaAsset.create({
      data: {
        businessId: business.id,
        barberId: barber?.id ?? null,
        type: 'BARBER_PORTFOLIO',
        url: a.url,
        altText: a.caption,
        caption: a.caption,
        focalX: a.focalX,
        focalY: a.focalY,
        sortOrder: i,
        isPublished: true,
      },
    })
  }

  // One published before/after pair so the "Before & After" chip has content
  const before = await prisma.mediaAsset.create({
    data: {
      businessId: business.id,
      barberId: barber?.id ?? null,
      type: 'GALLERY',
      url: img(2),
      altText: 'Before — grown out',
      caption: 'Before: four weeks grown out',
      sortOrder: 90,
      isPublished: true,
    },
  })
  const after = await prisma.mediaAsset.create({
    data: {
      businessId: business.id,
      barberId: barber?.id ?? null,
      type: 'GALLERY',
      url: img(1),
      altText: 'After — fresh fade',
      caption: 'After: fresh skin fade',
      sortOrder: 91,
      isPublished: true,
    },
  })
  await prisma.beforeAfterPair.create({
    data: {
      businessId: business.id,
      beforeAssetId: before.id,
      afterAssetId: after.id,
      barberId: barber?.id ?? null,
      serviceId: haircut?.id ?? null,
      caption: 'QA seed — transformation',
    },
  })

  const count = await prisma.mediaAsset.count({
    where: { businessId: business.id, type: { in: ['BARBER_PORTFOLIO', 'GALLERY'] }, isPublished: true },
  })
  console.log(`Seeded QA portfolio for ${business.slug}: ${count} published assets (incl. 1 before/after pair)`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

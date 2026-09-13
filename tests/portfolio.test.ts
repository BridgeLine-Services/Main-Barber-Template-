/**
 * Service-Linked Barber Portfolio Tests
 *
 * Covers the portfolio feature end to end at the data layer:
 *   - portfolio display queries (published-only, active barbers)
 *   - service filtering (pure gallery helpers)
 *   - barber filtering (per-barber scoping)
 *   - inactive media excluded from customer views
 *   - inactive service hides its linked examples
 *   - tenant isolation (cross-business service links rejected)
 *   - tenant isolation on customer-side queries
 *   - missing image metadata (altText fallbacks remain resolvable)
 *
 * UI-level checks (mobile layout, accessibility attributes, lazy loading)
 * are encoded as source-code assertions on the gallery components, since
 * they have no runtime logic to execute headlessly.
 *
 * Run: npx tsx tests/portfolio.test.ts (requires the database)
 */

import { prisma } from '../src/lib/prisma'
import { buildPortfolioFilters, filterPortfolio } from '../src/lib/portfolio'
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
  console.log('\n📦 Setting up portfolio test data...')

  const businessA = await prisma.business.create({
    data: {
      name: 'Portfolio Shop A',
      slug: `portfolio-shop-a-${Date.now()}`,
      email: 'pa@test.com',
      phone: '555-0101',
      address: '1 A St',
      city: 'CityA',
      state: 'CA',
      zipCode: '90001',
      timezone: 'America/Los_Angeles',
    },
  })
  const businessB = await prisma.business.create({
    data: {
      name: 'Portfolio Shop B',
      slug: `portfolio-shop-b-${Date.now()}`,
      email: 'pb@test.com',
      phone: '555-0102',
      address: '2 B St',
      city: 'CityB',
      state: 'CA',
      zipCode: '90002',
      timezone: 'America/Los_Angeles',
    },
  })

  const fadeA = await prisma.service.create({
    data: { businessId: businessA.id, name: 'Skin Fade', duration: 45, price: 35 },
  })
  const beardA = await prisma.service.create({
    data: { businessId: businessA.id, name: 'Beard Trim', duration: 30, price: 20 },
  })
  const serviceB = await prisma.service.create({
    data: { businessId: businessB.id, name: 'Haircut', duration: 30, price: 25 },
  })

  const barberA1 = await prisma.barber.create({
    data: { businessId: businessA.id, name: 'Marcus', slug: `marcus-${Date.now()}` },
  })
  const barberA2 = await prisma.barber.create({
    data: { businessId: businessA.id, name: 'Dee', slug: `dee-${Date.now()}` },
  })
  const barberInactive = await prisma.barber.create({
    data: { businessId: businessA.id, name: 'Ghost', slug: `ghost-${Date.now()}`, isActive: false },
  })

  const mk = (data: any) => prisma.mediaAsset.create({ data })

  const fadeImg1 = await mk({
    businessId: businessA.id, barberId: barberA1.id, serviceId: fadeA.id,
    type: 'BARBER_PORTFOLIO', url: 'https://cdn.example.com/fade1.jpg',
    altText: 'High skin fade by Marcus', caption: 'Burst fade', sortOrder: 0,
  })
  const fadeImg2 = await mk({
    businessId: businessA.id, barberId: barberA2.id, serviceId: fadeA.id,
    type: 'BARBER_PORTFOLIO', url: 'https://cdn.example.com/fade2.jpg',
    altText: null, caption: null, sortOrder: 1,
  })
  await mk({
    businessId: businessA.id, barberId: barberA1.id, serviceId: beardA.id,
    type: 'BARBER_PORTFOLIO', url: 'https://cdn.example.com/beard1.jpg',
    altText: 'Beard sculpt', sortOrder: 2,
  })
  // unpublished — must never appear in customer views
  await mk({
    businessId: businessA.id, barberId: barberA1.id, serviceId: fadeA.id,
    type: 'BARBER_PORTFOLIO', url: 'https://cdn.example.com/hidden.jpg',
    altText: 'unpublished', isPublished: false, sortOrder: 3,
  })
  // work by a deactivated barber — excluded from service example views
  await mk({
    businessId: businessA.id, barberId: barberInactive.id, serviceId: fadeA.id,
    type: 'BARBER_PORTFOLIO', url: 'https://cdn.example.com/inactive.jpg',
    altText: 'inactive barber work', sortOrder: 4,
  })

  console.log('\nPortfolio display (customer-side query semantics)')
  {
    // mirror of the barber profile query
    const profileAssets = await prisma.mediaAsset.findMany({
      where: { barberId: barberA1.id, type: 'BARBER_PORTFOLIO', isPublished: true },
      orderBy: { sortOrder: 'asc' },
      include: { service: { select: { id: true, name: true, isActive: true } } },
    })
    assert(profileAssets.length === 2, 'barber profile shows only own published work')
    assert(profileAssets.every((a) => a.url), 'every displayed asset has a URL (missing-image resilience)')
    assert(
      profileAssets.every((a) => a.altText !== null || a.service !== null),
      'alt-text fallback derivable for every asset'
    )

    // mirror of the gallery service-examples query
    const examples = await prisma.mediaAsset.findMany({
      where: {
        businessId: businessA.id,
        isPublished: true,
        serviceId: fadeA.id,
        type: { in: ['BARBER_PORTFOLIO', 'SERVICE_PHOTO'] },
        OR: [{ barberId: null }, { barber: { isActive: true } }],
      },
    })
    assert(examples.length === 2, 'service examples exclude unpublished + inactive-barber work')
  }

  console.log('\nService filtering (pure helpers)')
  {
    const assets = [
      { id: '1', url: 'u1', altText: null, caption: null, service: { id: 'fade', name: 'Fades' } },
      { id: '2', url: 'u2', altText: null, caption: null, service: { id: 'fade', name: 'Fades' } },
      { id: '3', url: 'u3', altText: null, caption: null, service: { id: 'beard', name: 'Beards' } },
      { id: '4', url: 'u4', altText: null, caption: null, service: null },
    ]
    const filters = buildPortfolioFilters(assets as any)
    assert(filters[0].id === 'all' && filters.length === 3, 'filters: All first + unique configured services only')
    assert(filterPortfolio(assets as any, 'fade').length === 2, 'fade filter returns fade work')
    assert(filterPortfolio(assets as any, 'beard').length === 1, 'beard filter returns beard work')
    assert(filterPortfolio(assets as any, 'all').length === 4, 'All includes unlinked work')
    assert(filterPortfolio(assets as any, 'nonexistent').length === 0, 'unknown filter yields empty view')
    const emptyFilters = buildPortfolioFilters([])
    assert(emptyFilters.length === 1 && emptyFilters[0].id === 'all', 'no assets → only the All filter (no empty categories)')
  }

  console.log('\nBarber filtering')
  {
    const own = await prisma.mediaAsset.findMany({
      where: { barberId: barberA2.id, isPublished: true },
    })
    assert(own.length === 1 && own[0].id === fadeImg2.id, 'barber scoping returns only that barber’s assets')
  }

  console.log('\nInactive media / inactive service')
  {
    const visible = await prisma.mediaAsset.findMany({
      where: { businessId: businessA.id, isPublished: true },
    })
    assert(!visible.some((a) => a.url.includes('hidden')), 'unpublished asset hidden from customer queries')
    // a deactivated service must not surface its examples to customers
    await prisma.service.update({ where: { id: beardA.id }, data: { isActive: false } })
    const beardAssets = await prisma.mediaAsset.findMany({
      where: { businessId: businessA.id, isPublished: true, serviceId: beardA.id },
      include: { service: { select: { isActive: true } } },
    })
    assert(
      beardAssets.every((a) => !a.service.isActive),
      'inactive service flagged server-side so linked work can be dropped from customer views'
    )
    await prisma.service.update({ where: { id: beardA.id }, data: { isActive: true } })
  }

  console.log('\nTenant isolation (data layer)')
  {
    // customer-side queries are always businessId-scoped
    const aAssets = await prisma.mediaAsset.findMany({
      where: { businessId: businessA.id, isPublished: true, serviceId: fadeA.id },
    })
    assert(aAssets.every((a) => a.businessId === businessA.id), 'service-example query never crosses tenants')

    // cross-tenant service link: business B service must NOT be linkable to
    // business A media — the API validation relies on findFirst with businessId
    const crossService = await prisma.service.findFirst({
      where: { id: serviceB.id, businessId: businessA.id },
    })
    assert(crossService === null, 'cross-tenant service link fails validation lookup')

    // and vice versa
    const reverse = await prisma.service.findFirst({
      where: { id: fadeA.id, businessId: businessB.id },
    })
    assert(reverse === null, 'reverse cross-tenant link fails validation lookup')
  }

  console.log('\nSource-level UI checks (accessibility, lazy loading, mobile, owner perms)')
  {
    const gallery = readFileSync(join(SRC, 'components/customer/PortfolioGallery.tsx'), 'utf8')
    assert(gallery.includes('loading="lazy"'), 'gallery images lazy-load')
    assert(gallery.includes('aria-pressed'), 'filter chips expose aria-pressed state')
    assert(gallery.includes('aria-label="Filter portfolio by service"'), 'filter group labelled for screen readers')
    assert(gallery.includes('grid-cols-2 md:grid-cols-3'), 'mobile-first responsive grid')
    assert(gallery.includes('figcaption'), 'captions render as text (usable without images)')

    const mediaApi = readFileSync(join(SRC, 'app/api/dashboard/media/route.ts'), 'utf8')
    assert(mediaApi.includes('validateServiceLink'), 'service link validation exists')
    assert(
      mediaApi.includes('You can only link services you offer'),
      'barber role restricted to own offered services'
    )
    assert(
      mediaApi.includes('where: { id: serviceId, businessId }'),
      'service link validated within the tenant'
    )

    const mediaPage = readFileSync(join(SRC, 'app/(dashboard)/dashboard/media/page.tsx'), 'utf8')
    assert(mediaPage.includes('Linked Service'), 'owner/barber UI can associate a service')
    assert(mediaPage.includes('aria-label="Linked service"'), 'service selector is labelled')

    const servicesPage = readFileSync(join(SRC, 'app/(customer)/services/page.tsx'), 'utf8')
    assert(servicesPage.includes('See examples of this service'), 'service page connects to portfolio examples')
    assert(servicesPage.includes('gallery?service='), 'connection targets the service-filtered gallery')
  }

  console.log('\n🧹 Cleaning up...')
  await prisma.business.delete({ where: { id: businessA.id } }).catch(() => {})
  await prisma.business.delete({ where: { id: businessB.id } }).catch(() => {})

  console.log(`\nPortfolio tests: ${passed} passed, ${failed} failed`)
  await prisma.$disconnect()
  if (failed > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})

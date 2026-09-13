import type { Metadata } from 'next'
import { generatePageMetadata } from '@/lib/generate-page-metadata'
import Link from 'next/link'
import { Calendar, Images } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { resolveBusiness } from '@/lib/tenant'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return generatePageMetadata({
    titleSuffix: "Gallery",
    description: "Browse the latest work and atmosphere from our shop.",
    path: "/gallery",
  })
}

export default async function GalleryPage({
  searchParams,
}: {
  searchParams?: { service?: string }
}) {
  const business = await resolveBusiness()

  if (!business) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="text-3xl font-bold">Gallery unavailable</h1>
        <p className="mt-3 text-muted-foreground">This business has not been configured yet.</p>
      </div>
    )
  }

  // ── Service examples view (?service=<id>) ─────────────────────────────────
  // Landing destination for "See examples of this service": shows published
  // service-linked portfolio work across the shop's barbers.
  const serviceId = searchParams?.service
  if (serviceId) {
    const service = await prisma.service.findFirst({
      where: { id: serviceId, businessId: business.id, isActive: true },
      select: { id: true, name: true, description: true },
    }).catch(() => null)

    if (!service) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-20 text-center">
          <h1 className="text-3xl font-bold">Examples unavailable</h1>
          <p className="mt-3 text-muted-foreground">
            This service does not have example work to show.
          </p>
        </div>
      )
    }

    const examples = await prisma.mediaAsset.findMany({
      where: {
        businessId: business.id,
        isPublished: true,
        serviceId: service.id,
        type: { in: ['BARBER_PORTFOLIO', 'SERVICE_PHOTO'] },
        OR: [{ barberId: null }, { barber: { isActive: true } }],
      },
      include: { barber: { select: { name: true, slug: true } } },
      orderBy: { sortOrder: 'asc' },
      take: 48, // keep the payload light — no huge image sets by default
    }).catch(() => [])

    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <header className="mx-auto max-w-2xl text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Images aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            {service.name} Examples
          </h1>
          <p className="mt-4 text-pretty leading-6 text-muted-foreground">
            Real {service.name.toLowerCase()} work from our barbers. Every photo is a
            haircut someone actually got here.
          </p>
        </header>

        {examples.length === 0 ? (
          <Card className="mx-auto mt-12 max-w-xl">
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <Images className="size-10 text-muted-foreground" aria-hidden="true" />
              <div>
                <h2 className="font-semibold">No examples yet</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Our barbers are still adding {service.name.toLowerCase()} work. Check back soon.
                </p>
              </div>
              <Button asChild>
                <Link href={`/book?serviceId=${service.id}`}>
                  <Calendar data-icon="inline-start" />Book this service
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {examples.map((image) => (
              <figure key={image.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
                <div className="aspect-[4/3] bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.url}
                    alt={image.altText || `${service.name} example${image.barber ? ` by ${image.barber.name}` : ''}`}
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover"
                  />
                </div>
                <figcaption className="px-4 py-3 text-sm leading-6 text-muted-foreground">
                  {image.caption && <span>{image.caption}</span>}
                  {image.barber?.slug && (
                    <Link
                      href={`/barbers/${image.barber.slug}`}
                      className="mt-1 inline-block text-xs font-semibold text-accent hover:underline"
                    >
                      View {image.barber.name}&apos;s work
                    </Link>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        <div className="mt-12 flex justify-center">
          <Button asChild>
            <Link href={`/book?serviceId=${service.id}`}>
              <Calendar data-icon="inline-start" />Book this service
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  // ── Default shop gallery ──────────────────────────────────────────────────
  const images = await prisma.mediaAsset.findMany({
    where: { businessId: business.id, type: 'GALLERY', isPublished: true, barberId: null },
    orderBy: { sortOrder: 'asc' },
  }).catch(() => [])

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
      <header className="mx-auto max-w-2xl text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Images aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-balance text-4xl font-bold tracking-tight sm:text-5xl">Gallery</h1>
        <p className="mt-4 text-pretty leading-6 text-muted-foreground">
          A look at the work, space, and details that make {business.name} unique.
        </p>
      </header>

      {images.length === 0 ? (
        <Card className="mx-auto mt-12 max-w-xl">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <Images className="size-10 text-muted-foreground" aria-hidden="true" />
            <div>
              <h2 className="font-semibold">Gallery coming soon</h2>
              <p className="mt-1 text-sm text-muted-foreground">Check back soon for new shop photos.</p>
            </div>
            <Button asChild>
              <Link href="/book"><Calendar data-icon="inline-start" />Book an appointment</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((image) => (
            <figure key={image.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="aspect-[4/3] bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt={image.altText || `${business.name} gallery photo`} className="size-full object-cover" />
              </div>
              {image.caption && <figcaption className="px-4 py-3 text-sm leading-6 text-muted-foreground">{image.caption}</figcaption>}
            </figure>
          ))}
        </div>
      )}

      {images.length > 0 && (
        <div className="mt-12 flex justify-center">
          <Button asChild><Link href="/book"><Calendar data-icon="inline-start" />Book an appointment</Link></Button>
        </div>
      )}
    </div>
  )
}

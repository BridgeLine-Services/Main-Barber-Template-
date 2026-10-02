import type { Metadata } from 'next'
import { generatePageMetadata } from '@/lib/generate-page-metadata'
import { Images } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { resolveBusiness } from '@/lib/tenant'
import { prisma } from '@/lib/prisma'
import { Section, SectionHeading } from '@/components/customer/Section'
import { BookButton } from '@/components/customer/Cta'
import { Reveal } from '@/components/motion/reveal'
import { visualConfigFromContent } from '@/lib/visual-config'
import { GalleryGrid } from '@/components/customer/GalleryGrid'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return generatePageMetadata({
    titleSuffix: "Gallery",
    description: "Browse the latest work and atmosphere from our shop.",
    path: "/gallery",
  })
}

export default async function GalleryPage(
  props: {
    searchParams?: Promise<{ service?: string }>
  }
) {
  const searchParams = await props.searchParams;
  const business = await resolveBusiness()

  if (!business) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="display-heading text-display-3 text-foreground">Gallery unavailable</h1>
        <p className="mt-3 text-muted-foreground">This business has not been configured yet.</p>
      </div>
    )
  }

  // Tenant visual identity (published snapshot → composition).
  const rawContent = await prisma.websiteContent.findUnique({
    where: { businessId: business.id },
  }).catch(() => null)
  const content = rawContent?.publishedContent
    ? { ...rawContent, ...(rawContent.publishedContent as Record<string, unknown>) }
    : rawContent
  const visual = visualConfigFromContent(content)

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
          <h1 className="display-heading text-display-3 text-foreground">Examples unavailable</h1>
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
      include: { barber: { select: { name: true, slug: true } }, service: { select: { id: true, name: true } } },
      orderBy: { sortOrder: 'asc' },
      take: 48, // keep the payload light — no huge image sets by default
    }).catch(() => [])

    return (
      <Section className="pt-12 lg:pt-20">
        <SectionHeading
          eyebrow="Our Work"
          title={`${service.name} Examples`}
          description={`Real ${service.name.toLowerCase()} work from our barbers. Every photo is a haircut someone actually got here.`}
        />

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
              <BookButton href={`/book?serviceId=${service.id}`} label="Book this service" size="md" />
            </CardContent>
          </Card>
        ) : (
          <Reveal>
            <GalleryGrid
              images={examples.map((image) => ({
                id: image.id,
                url: image.url,
                altText: image.altText || `${service.name} example${image.barber ? ` by ${image.barber.name}` : ''}`,
                caption: image.caption,
                barber: image.barber,
                service: image.service,
              }))}
              layout={visual.galleryLayout}
              contextLabel={`${business.name} ${service.name}`}
            />
          </Reveal>
        )}

        <Reveal className="mt-14 flex justify-center">
          <BookButton href={`/book?serviceId=${service.id}`} label="Book this service" />
        </Reveal>
      </Section>
    )
  }

  // ── Default shop gallery ──────────────────────────────────────────────────
  const images = await prisma.mediaAsset.findMany({
    where: { businessId: business.id, type: 'GALLERY', isPublished: true, barberId: null },
    include: {
      barber: { select: { name: true, slug: true } },
      service: { select: { id: true, name: true } },
    },
    orderBy: { sortOrder: 'asc' },
  }).catch(() => [])

  return (
    <Section className="pt-12 lg:pt-20">
      <SectionHeading
        eyebrow="Gallery"
        title="The Shop, In Pictures"
        description={`A look at the work, space, and details that make ${business.name} unique.`}
      />

      {images.length === 0 ? (
        <Card className="mx-auto mt-12 max-w-xl">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <Images className="size-10 text-muted-foreground" aria-hidden="true" />
            <div>
              <h2 className="font-semibold">Gallery coming soon</h2>
              <p className="mt-1 text-sm text-muted-foreground">Check back soon for new shop photos.</p>
            </div>
            <BookButton href="/book" label="Book an appointment" size="md" />
          </CardContent>
        </Card>
      ) : (
        <Reveal>
          <GalleryGrid
            images={images.map((image) => ({
              id: image.id,
              url: image.url,
              altText: image.altText || `${business.name} gallery photo`,
              caption: image.caption,
              barber: image.barber,
              service: image.service,
            }))}
            layout={visual.galleryLayout}
            contextLabel={business.name}
          />
        </Reveal>
      )}

      {images.length > 0 && (
        <Reveal className="mt-14 flex justify-center">
          <BookButton href="/book" label="Book an appointment" />
        </Reveal>
      )}
    </Section>
  )
}

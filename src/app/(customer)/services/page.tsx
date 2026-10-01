export const dynamic = 'force-dynamic'
import { generatePageMetadata } from '@/lib/generate-page-metadata'

import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { formatDuration, formatPrice } from '@/lib/utils'
import { PAYMENT_DISCLAIMER } from '@/lib/constants'
import { resolveBusiness } from '@/lib/tenant'
import { Clock, CreditCard, Images } from 'lucide-react'
import { Section, SectionHeading } from '@/components/customer/Section'
import { BookButton, GhostButton } from '@/components/customer/Cta'
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal'

export async function generateMetadata(): Promise<Metadata> {
  return generatePageMetadata({
    titleSuffix: "Services & Pricing",
    description: "View our full service menu and prices. Book your appointment online and pay in person.",
    path: "/services",
  })
}


export default async function ServicesPage() {
  const business = await resolveBusiness().catch(() => null)

  if (!business) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <h1 className="display-heading text-display-3 text-foreground mb-4">Shop Not Configured</h1>
          <p className="text-muted-foreground">An administrator needs to run the setup process.</p>
        </div>
      </div>
    )
  }

  const services = await prisma.service.findMany({
    where: { businessId: business.id, isActive: true },
    orderBy: { order: 'asc' },
  })

  // Service-linked portfolio work (barber portfolio + service photos that
  // the business has published and linked to a service) — used for the
  // "See examples of this service" connection.
  const portfolioCounts = await prisma.mediaAsset.groupBy({
    by: ['serviceId'],
    where: {
      businessId: business.id,
      isPublished: true,
      serviceId: { not: null },
      type: { in: ['BARBER_PORTFOLIO', 'SERVICE_PHOTO'] },
      // only count work by active barbers for honest examples
      OR: [{ barberId: null }, { barber: { isActive: true } }],
    },
    _count: { id: true },
  }).catch(() => [])
  const examplesByService = new Map(
    portfolioCounts
      .filter((row) => row.serviceId)
      .map((row) => [row.serviceId as string, row._count.id])
  )

  return (
    <Section className="pt-12 lg:pt-20">
      {/* Header */}
      <SectionHeading
        eyebrow="Service Menu"
        title="Barbering Services & Pricing"
        description="From classic precision haircuts to luxury beard sculpting and hot towel shaves. All services include consultation and style finishing."
      />


      {/* Service menu — editorial hairline rows, the same grammar as the
          landing services section. Book and example links stay inline. */}
      <Stagger className="border-t border-border/60">
        {services.map((service) => (
          <StaggerItem key={service.id} className="border-b border-border/60">
            <div className="group flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:py-7">
              <div className="min-w-0">
                <h2 className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  {service.name}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground line-clamp-2 max-w-2xl">
                  {service.description || 'Professional barbering service tailored to your style preferences.'}
                </p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  {formatDuration(service.duration)}
                  <span className="mx-1 text-border" aria-hidden="true">·</span>
                  Pay in person
                </p>
              </div>
              <div className="flex items-center justify-between gap-6 sm:shrink-0 sm:self-center">
                <span className="font-display text-lg font-bold text-foreground tabular-nums sm:text-xl">
                  {formatPrice(service.price)}
                </span>
                <div className="flex items-center gap-4">
                  {(examplesByService.get(service.id) ?? 0) > 0 && (
                    <GhostButton
                      href={`/gallery?service=${service.id}`}
                      className="text-sm py-1"
                      aria-label={`See examples of ${service.name}`}
                    >
                      <Images className="h-4 w-4" aria-hidden="true" />
                      Examples
                    </GhostButton>
                  )}
                  <BookButton
                    href={`/book?serviceId=${service.id}`}
                    label="Book"
                    size="md"
                  />
                </div>
              </div>
            </div>
          </StaggerItem>
        ))}
      </Stagger>

      {/* Payment Disclaimer Banner */}
      <Reveal className="mt-16">
        <div className="hairline-t flex flex-col items-start gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="eyebrow-accent mb-1">In-Person Payment</p>
              <p className="text-sm text-muted-foreground max-w-xl">{PAYMENT_DISCLAIMER}</p>
            </div>
          </div>
          <GhostButton href="/book" className="shrink-0 py-3 text-sm">Reserve a Time Slot</GhostButton>
        </div>
      </Reveal>
    </Section>
  )
}

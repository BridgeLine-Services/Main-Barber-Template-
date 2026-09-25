export const dynamic = 'force-dynamic'
import { generatePageMetadata } from '@/lib/generate-page-metadata'

import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { formatDuration, formatPrice } from '@/lib/utils'
import { PAYMENT_DISCLAIMER } from '@/lib/constants'
import { resolveBusiness } from '@/lib/tenant'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
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

export const revalidate = 60

export default async function ServicesPage() {
  const business = await resolveBusiness().catch(() => null)

  if (!business) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-4">Shop Not Configured</h1>
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

      {/* Services Grid */}
      <Stagger className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {services.map((service) => (
          <StaggerItem key={service.id}>
          <Card className="group flex h-full flex-col justify-between border-border/70 bg-card/60 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-xl hover:shadow-black/20">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-xl text-foreground font-bold group-hover:text-accent transition-colors">
                    {service.name}
                  </CardTitle>
                  <CardDescription className="text-muted-foreground text-xs flex items-center gap-1.5 mt-1.5">
                    <Clock className="h-3.5 w-3.5 text-accent" />
                    {formatDuration(service.duration)}
                  </CardDescription>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-black text-accent">
                    {formatPrice(service.price)}
                  </div>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                    Pay in Person
                  </span>
                </div>
              </div>
            </CardHeader>

            <CardContent className="text-sm text-foreground/70 py-3 leading-relaxed flex-1">
              {service.description || 'Professional barbering service tailored to your style preferences.'}
            </CardContent>

            <CardFooter className="pt-4 border-t border-border/60 flex flex-col gap-2">
              <BookButton
                href={`/book?serviceId=${service.id}`}
                label="Book This Service"
                size="md"
                className="w-full"
              />
              {(examplesByService.get(service.id) ?? 0) > 0 && (
                <GhostButton
                  href={`/gallery?service=${service.id}`}
                  className="w-full py-3 text-sm"
                  aria-label={`See examples of ${service.name}`}
                >
                  <Images className="h-4 w-4 text-accent" aria-hidden="true" />
                  See examples of this service
                </GhostButton>
              )}
            </CardFooter>
          </Card>
          </StaggerItem>
        ))}
      </Stagger>

      {/* Payment Disclaimer Banner */}
      <Reveal className="mt-16">
        <div className="rounded-xl bg-card/90 border border-border p-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent border border-accent/30 shrink-0">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">In-Person Payment Notice</p>
              <p className="text-xs text-muted-foreground mt-0.5">{PAYMENT_DISCLAIMER}</p>
            </div>
          </div>
          <GhostButton href="/book" className="shrink-0 py-3 text-sm">Reserve Time Slot</GhostButton>
        </div>
      </Reveal>
    </Section>
  )
}

export const dynamic = 'force-dynamic'
import { generatePageMetadata } from '@/lib/generate-page-metadata'

import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { resolveBusiness } from '@/lib/tenant'
import { getInitials } from '@/lib/utils'
import type { Prisma } from '@prisma/client'

type BarberWithRelations = Prisma.BarberGetPayload<{
  include: {
    services: { include: { service: true } }
    reviews: { select: { rating: true } }
  }
}>
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Section, SectionHeading } from '@/components/customer/Section'
import {Stagger, StaggerItem } from '@/components/motion/reveal'
import { ArrowRight, Scissors, Calendar } from 'lucide-react'

export async function generateMetadata(): Promise<Metadata> {
  return generatePageMetadata({
    titleSuffix: "Meet Our Barbers",
    description: "Meet our team of professional barbers and book your next haircut with your favorite specialist.",
    path: "/barbers",
  })
}


export default async function BarbersPage() {
  // Production: resolve business from DB — no demo fallback
  const business = await resolveBusiness()

  if (!business) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="display-heading text-display-3 text-foreground mb-4">No business configured</h1>
        <p className="text-muted-foreground">Please run the setup wizard to configure your shop.</p>
      </div>
    )
  }

  const barbers: BarberWithRelations[] = await prisma.barber.findMany({
    where: { businessId: business.id, isActive: true },
    include: {
      services: {
        where: { isActive: true },
        include: { service: true },
        orderBy: { sortOrder: 'asc' },
      },
      reviews: {
        select: { rating: true },
      },
    },
    orderBy: { order: 'asc' },
  })

  return (
    <Section className="pt-12 lg:pt-20">
      {/* Header — configurable from business settings */}
      <SectionHeading
        eyebrow={business.teamSectionLabel || 'Our Team'}
        title={business.teamSectionTitle || `Meet the Barbers at ${business.name}`}
        description={business.teamSectionDescription || 'Each member of our team brings years of experience, attention to detail, and passion for precision cuts and classic grooming.'}
      />

      {/* Barbers Grid */}
      {barbers.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No barbers have been added yet. Add barbers in the Dashboard under Team.</p>
        </div>
      ) : (
        /* Portrait-led editorial profiles — the same grammar as the landing
           team section: photo left, name/specialty/bio beside it, services
           as quiet hairline rows, book as a text action. Review stats and
           per-barber pricing remain data-driven. */
        <Stagger className="grid grid-cols-1 gap-x-12 gap-y-12 md:grid-cols-2">
          {barbers.map((barber) => {
            // Calculate barber's review stats from actual records
            const barberReviews: Array<{ rating: number }> = barber.reviews || []
            const reviewCount = barberReviews.length
            const avgRating = reviewCount > 0
              ? (barberReviews.reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) / reviewCount).toFixed(1)
              : null

            return (
              <StaggerItem key={barber.id} className="h-full">
                <div className="group flex flex-col gap-6 sm:flex-row sm:gap-8">
                  <Avatar
                    className="h-28 w-28 shrink-0 rounded-lg ring-2 ring-background sm:h-32 sm:w-32"
                    style={{ borderWidth: '2px', borderColor: business.accentColor }}
                  >
                    {barber.photo && <AvatarImage src={barber.photo} alt={barber.name} className="rounded-lg object-cover" />}
                    <AvatarFallback className="rounded-lg font-display text-2xl font-semibold text-primary">
                      {getInitials(barber.name)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1 hairline-t pt-4 sm:hairline-t-0 sm:pt-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
                        {barber.name}
                      </h2>
                      {avgRating && (
                        <span className="text-xs font-medium text-muted-foreground">
                          {avgRating} ★ · {reviewCount} review{reviewCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {barber.specialty && (
                      <p className="eyebrow-accent mt-1.5">{barber.specialty}</p>
                    )}
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      &ldquo;{barber.bio || 'Dedicated to precision craftsmanship, clean line-ups, and legendary customer care.'}&rdquo;
                    </p>

                    {/* Services Offered with per-barber pricing — hairline rows */}
                    {barber.services && barber.services.length > 0 && (
                      <div className="mt-4 border-t border-border/60">
                        <p className="eyebrow mt-3 mb-1.5 flex items-center gap-1.5">
                          <Scissors className="h-3.5 w-3.5" aria-hidden="true" /> Services
                        </p>
                        <div className="divide-y divide-border/40">
                          {barber.services.map((bs) => {
                            const price = bs.priceOverride ?? bs.service?.price
                            const duration = bs.durationOverride ?? bs.service?.duration
                            return (
                              <div key={bs.serviceId} className="flex justify-between gap-4 py-1.5 text-sm">
                                <span className="text-foreground/80 truncate">{bs.service?.name || 'Service'}</span>
                                <span className="text-muted-foreground shrink-0 tabular-nums">
                                  {price != null && `$${price}`}
                                  {duration != null && ` · ${duration}min`}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Barber social links */}
                    {(barber.instagram || barber.facebook || barber.tiktok || barber.website) && (
                      <div className="mt-4 flex flex-wrap gap-4 text-xs">
                        {barber.instagram && (
                          <a href={barber.instagram.startsWith('http') ? barber.instagram : `https://instagram.com/${barber.instagram}`}
                             target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                            Instagram
                          </a>
                        )}
                        {barber.facebook && (
                          <a href={barber.facebook.startsWith('http') ? barber.facebook : `https://facebook.com/${barber.facebook}`}
                             target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                            Facebook
                          </a>
                        )}
                        {barber.tiktok && (
                          <a href={barber.tiktok.startsWith('http') ? barber.tiktok : `https://tiktok.com/@${barber.tiktok}`}
                             target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                            TikTok
                          </a>
                        )}
                        {barber.website && (
                          <a href={barber.website} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                            Website
                          </a>
                        )}
                      </div>
                    )}

                    <div className="mt-5 flex items-center gap-5">
                      <Link
                        href={`/book?barberId=${barber.id}`}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-all duration-micro hover:brightness-125 focus-ring rounded-sm px-1 py-1"
                      >
                        <Calendar className="h-4 w-4" aria-hidden="true" />
                        Book with {barber.name.split(' ')[0]}
                      </Link>
                      {barber.slug && (
                        <Link
                          href={`/barbers/${barber.slug}`}
                          className="group/view inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors duration-micro hover:text-foreground"
                        >
                          Full profile
                          <ArrowRight className="h-4 w-4 transition-transform duration-micro group-hover/view:translate-x-0.5" aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </StaggerItem>
            )
          })}
        </Stagger>
      )}
    </Section>
  )
}

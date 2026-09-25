export const dynamic = 'force-dynamic'
import { generatePageMetadata } from '@/lib/generate-page-metadata'

import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { resolveBusiness } from '@/lib/tenant'
import { getInitials } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Section, SectionHeading } from '@/components/customer/Section'
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal'
import { Scissors, Calendar } from 'lucide-react'

export async function generateMetadata(): Promise<Metadata> {
  return generatePageMetadata({
    titleSuffix: "Meet Our Barbers",
    description: "Meet our team of professional barbers and book your next haircut with your favorite specialist.",
    path: "/barbers",
  })
}

export const revalidate = 60

export default async function BarbersPage() {
  // Production: resolve business from DB — no demo fallback
  const business = await resolveBusiness()

  if (!business) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h1 className="text-3xl font-bold mb-4">No business configured</h1>
        <p className="text-muted-foreground">Please run the setup wizard to configure your shop.</p>
      </div>
    )
  }

  const barbers = await prisma.barber.findMany({
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
        <Stagger className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {barbers.map((barber) => {
            // Calculate barber's review stats from actual records
            const barberReviews: Array<{ rating: number }> = barber.reviews || []
            const reviewCount = barberReviews.length
            const avgRating = reviewCount > 0
              ? (barberReviews.reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) / reviewCount).toFixed(1)
              : null

            return (
              <StaggerItem key={barber.id} className="h-full">
              <Card className="flex h-full flex-col justify-between overflow-hidden border-border/70 bg-card/60 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-xl hover:shadow-black/20">
                <div>
                  <CardHeader className="text-center pt-8 pb-4">
                    <div className="mx-auto mb-4 relative">
                      <Avatar className="h-28 w-28" style={{ borderWidth: '2px', borderColor: business.accentColor }}>
                        {barber.photo && <AvatarImage src={barber.photo} alt={barber.name} />}
                        <AvatarFallback className="font-bold text-2xl">
                          {getInitials(barber.name)}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <CardTitle className="text-2xl font-bold">{barber.name}</CardTitle>
                    {barber.specialty && (
                      <p className="text-xs font-semibold mt-1 uppercase tracking-wider" style={{ color: business.accentColor }}>
                        {barber.specialty}
                      </p>
                    )}
                    {/* Auto-calculated review stats */}
                    {avgRating && (
                      <p className="text-sm text-muted-foreground mt-2">
                        {avgRating} ★ · {reviewCount} review{reviewCount !== 1 ? 's' : ''}
                      </p>
                    )}
                  </CardHeader>

                  <CardContent className="px-6 space-y-4 text-sm">
                    <p className="leading-relaxed text-center italic text-muted-foreground">
                      &ldquo;{barber.bio || 'Dedicated to precision craftsmanship, clean line-ups, and legendary customer care.'}&rdquo;
                    </p>

                    {/* Services Offered with per-barber pricing */}
                    {barber.services && barber.services.length > 0 && (
                      <div className="pt-4 border-t space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 text-muted-foreground">
                          <Scissors className="h-3.5 w-3.5" /> Services Offered:
                        </p>
                        <div className="space-y-1">
                          {barber.services.map((bs: any) => {
                            const price = bs.priceOverride ?? bs.service?.price
                            const duration = bs.durationOverride ?? bs.service?.duration
                            return (
                              <div key={bs.serviceId} className="flex justify-between text-sm">
                                <span>{bs.service?.name || 'Service'}</span>
                                <span className="text-muted-foreground">
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
                      <div className="flex gap-3 justify-center pt-2 text-xs">
                        {barber.instagram && (
                          <a href={barber.instagram.startsWith('http') ? barber.instagram : `https://instagram.com/${barber.instagram}`}
                             target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                            Instagram
                          </a>
                        )}
                        {barber.facebook && (
                          <a href={barber.facebook.startsWith('http') ? barber.facebook : `https://facebook.com/${barber.facebook}`}
                             target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                            Facebook
                          </a>
                        )}
                        {barber.tiktok && (
                          <a href={barber.tiktok.startsWith('http') ? barber.tiktok : `https://tiktok.com/@${barber.tiktok}`}
                             target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                            TikTok
                          </a>
                        )}
                        {barber.website && (
                          <a href={barber.website} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                            Website
                          </a>
                        )}
                      </div>
                    )}
                  </CardContent>
                </div>

                <CardFooter className="pt-6 pb-6 px-6 border-t mt-4">
                  <Button asChild className="w-full font-bold transition" style={{ backgroundColor: business.accentColor }}>
                    <Link href={`/book?barberId=${barber.id}`}>
                      <Calendar className="mr-2 h-4 w-4" />
                      Book with {barber.name.split(' ')[0]}
                    </Link>
                  </Button>
                  {barber.slug && (
                    <Link
                      href={`/barbers/${barber.slug}`}
                      className="text-xs text-muted-foreground hover:text-foreground mt-2 mx-auto"
                    >
                      View full profile →
                    </Link>
                  )}
                </CardFooter>
              </Card>
              </StaggerItem>
            )
          })}
        </Stagger>
      )}
    </Section>
  )
}

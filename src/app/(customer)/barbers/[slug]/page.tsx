export const dynamic = 'force-dynamic'

import { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getInitials } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Calendar, Star, Scissors, Instagram, Facebook, Globe, Phone } from 'lucide-react'
import PortfolioGallery from '@/components/customer/PortfolioGallery'

interface PageProps {
  params: { slug: string }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const barber = await prisma.barber.findUnique({
    where: { slug: params.slug },
    include: { business: true },
  })

  if (!barber) return { title: 'Barber Not Found' }

  // record, while the page itself still validates the full public tenant below.
  const businessName = barber.business?.name ?? 'Our Barbershop'
  const title = `${barber.name} | ${businessName}`
  const description = barber.specialty
    ? `${barber.name} — ${barber.specialty} at ${businessName}. Book your appointment online.`
    : `Book an appointment with ${barber.name} at ${businessName}.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: barber.photo ? [{ url: barber.photo }] : undefined,
    },
  }
}

export default async function BarberProfilePage({ params }: PageProps) {
  const barber = await prisma.barber.findUnique({
    where: { slug: params.slug },
    include: {
      business: {
        include: { seo: true },
      },
      services: {
        where: { isActive: true },
        include: { service: true },
        orderBy: { sortOrder: 'asc' },
      },
      reviews: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      mediaAssets: {
        where: { type: 'BARBER_PORTFOLIO', isPublished: true },
        orderBy: { sortOrder: 'asc' },
        include: { service: { select: { id: true, name: true, isActive: true } } },
      },
    },
  })

  if (!barber || !barber.isActive) {
    notFound()
  }

  // Calculate review stats from actual records (never manually entered)
  const allReviews = await prisma.review.findMany({
    where: { barberId: barber.id },
    select: { rating: true },
  })
  const reviewCount = allReviews.length
  const avgRating = reviewCount > 0
    ? (allReviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount).toFixed(1)
    : null

  const business = barber.business

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
      {/* Back link */}
      <Link href="/barbers" className="text-sm text-muted-foreground hover:text-foreground mb-6 inline-block">
        ← All Barbers
      </Link>

      {/* Profile Header */}
      <div className="flex flex-col md:flex-row gap-8 items-center md:items-start mb-12">
        <Avatar className="h-32 w-32 md:h-40 md:w-40 flex-shrink-0" style={{ borderWidth: '3px', borderColor: business.accentColor }}>
          {barber.photo && <AvatarImage src={barber.photo} alt={barber.name} />}
          <AvatarFallback className="font-bold text-4xl">
            {getInitials(barber.name)}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 text-center md:text-left">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">{barber.name}</h1>
          {barber.specialty && (
            <p className="text-lg font-semibold mb-3" style={{ color: business.accentColor }}>
              {barber.specialty}
            </p>
          )}

          {/* Auto-calculated reputation */}
          {avgRating && (
            <div className="flex items-center gap-2 justify-center md:justify-start mb-4">
              <div className="flex">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className={`h-5 w-5 ${star <= Math.round(parseFloat(avgRating)) ? 'fill-current' : 'fill-none'}`}
                    style={{ color: star <= Math.round(parseFloat(avgRating)) ? business.accentColor : undefined }}
                  />
                ))}
              </div>
              <span className="font-semibold">{avgRating}</span>
              <span className="text-muted-foreground">({reviewCount} review{reviewCount !== 1 ? 's' : ''})</span>
            </div>
          )}

          {barber.bio && (
            <p className="text-muted-foreground leading-relaxed max-w-2xl">{barber.bio}</p>
          )}

          {/* Social links */}
          <div className="flex gap-4 mt-4 justify-center md:justify-start">
            {barber.instagram && (
              <a href={barber.instagram.startsWith('http') ? barber.instagram : `https://instagram.com/${barber.instagram}`}
                 target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                <Instagram className="h-5 w-5" />
              </a>
            )}
            {barber.facebook && (
              <a href={barber.facebook.startsWith('http') ? barber.facebook : `https://facebook.com/${barber.facebook}`}
                 target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                <Facebook className="h-5 w-5" />
              </a>
            )}
            {barber.website && (
              <a href={barber.website} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                <Globe className="h-5 w-5" />
              </a>
            )}
            {barber.phone && (
              <a href={`tel:${barber.phone.replace(/\D/g, "")}`} className="text-muted-foreground hover:text-foreground">
                <Phone className="h-5 w-5" />
              </a>
            )}
          </div>

          <div className="mt-6">
            <Button asChild className="font-bold" style={{ backgroundColor: business.accentColor }}>
              <Link href={`/book?barberId=${barber.id}`}>
                <Calendar className="mr-2 h-4 w-4" />
                Book with {barber.name.split(' ')[0]}
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Services with per-barber pricing */}
      {barber.services.length > 0 && (
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <Scissors className="h-6 w-6" style={{ color: business.accentColor }} />
            Services & Pricing
          </h2>
          <div className="grid gap-4">
            {barber.services.map((bs: any) => {
              const price = bs.priceOverride ?? bs.service?.price
              const duration = bs.durationOverride ?? bs.service?.duration
              return (
                <Card key={bs.serviceId}>
                  <CardContent className="flex justify-between items-center py-4">
                    <div>
                      <h3 className="font-semibold">{bs.service?.name}</h3>
                      {bs.service?.description && (
                        <p className="text-sm text-muted-foreground mt-1">{bs.service.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">{duration} min</p>
                    </div>
                    <div className="text-xl font-bold">{price != null ? `$${price}` : ''}</div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </section>
      )}

      {/* Portfolio — service-linked work with optional category filter.
          Assets tied to a deactivated service are hidden server-side. */}
      {(() => {
        const portfolioAssets = barber.mediaAssets
          .filter((a: any) => !a.service || a.service.isActive)
          .map((a: any) => ({
            id: a.id,
            url: a.url,
            altText: a.altText,
            caption: a.caption,
            service: a.service ? { id: a.service.id, name: a.service.name } : null,
          }))
        return portfolioAssets.length > 0 ? (
          <section className="mb-12">
            <h2 className="text-2xl font-bold mb-6">View Work</h2>
            <PortfolioGallery assets={portfolioAssets} altFallback={barber.name} />
          </section>
        ) : null
      })()}

      {/* Recent Reviews */}
      {barber.reviews.length > 0 && (
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6">Recent Reviews</h2>
          <div className="grid gap-4">
            {barber.reviews.map((review: any) => (
              <Card key={review.id}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold">{review.authorName}</span>
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`h-4 w-4 ${star <= review.rating ? 'fill-current' : 'fill-none'}`}
                          style={{ color: star <= review.rating ? business.accentColor : undefined }}
                        />
                      ))}
                    </div>
                  </div>
                  {review.comment && (
                    <p className="text-muted-foreground text-sm">{review.comment}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    {new Date(review.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Booking CTA */}
      <div className="text-center py-8 border-t">
        <h2 className="text-2xl font-bold mb-2">Ready to book?</h2>
        <p className="text-muted-foreground mb-6">Schedule your next appointment with {barber.name}.</p>
        <Button asChild size="lg" className="font-bold" style={{ backgroundColor: business.accentColor }}>
          <Link href={`/book?barberId=${barber.id}`}>
            <Calendar className="mr-2 h-5 w-5" />
            Book Appointment
          </Link>
        </Button>
      </div>
    </div>
  )
}

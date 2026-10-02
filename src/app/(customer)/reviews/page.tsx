export const dynamic = 'force-dynamic'
import { generatePageMetadata } from '@/lib/generate-page-metadata'

import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { visualConfigFromContent } from '@/lib/visual-config'
import { resolveBusiness } from '@/lib/tenant'
import { formatFullDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Star, Calendar } from 'lucide-react'

export async function generateMetadata(): Promise<Metadata> {
  return generatePageMetadata({
    titleSuffix: "Client Reviews",
    description: "Read authentic client reviews and testimonials about our barbering services.",
    path: "/reviews",
  })
}


export default async function ReviewsPage() {
  let reviews: Awaited<ReturnType<typeof prisma.review.findMany>> = []
  let business: Awaited<ReturnType<typeof resolveBusiness>> = null

  try {
    business = await resolveBusiness()
    if (business) {
      reviews = await prisma.review.findMany({
        where: { businessId: business.id, isPublished: true },
        orderBy: { createdAt: 'desc' },
      })
    }
  } catch (error) {
    console.error('Failed to load reviews:', error)
  }

  // Tenant visual identity (published snapshot → review presentation).
  // Same resolution path as every other customer page.
  const rawContent = business
    ? await prisma.websiteContent.findUnique({ where: { businessId: business.id } }).catch(() => null)
    : null
  const content = rawContent?.publishedContent
    ? { ...rawContent, ...(rawContent.publishedContent as Record<string, unknown>) }
    : rawContent
  const visual = visualConfigFromContent(content)

  const totalReviews = reviews.length
  const avgRating =
    totalReviews > 0
      ? (reviews.reduce((acc, r) => acc + r.rating, 0) / totalReviews).toFixed(1)
      : '—'

  if (!business || totalReviews === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <Badge variant="outline" className="border-accent/40 text-accent px-3 py-1">
            Client Feedback
          </Badge>
          <h1 className="text-4xl sm:text-5xl font-display font-semibold text-foreground tracking-tight">
            Real Reviews from Real Clients
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed">
            We take pride in our precision cuts and unmatched customer satisfaction.
          </p>
        </div>
        <div className="mt-12 text-center">
          <p className="text-muted-foreground text-sm">
            {business ? 'No reviews yet. Be the first to leave one!' : 'Reviews will appear here once the shop is configured.'}
          </p>
          <Button asChild size="lg" className="bg-accent hover:brightness-110 text-accent-foreground font-bold mt-6">
            <Link href="/book">
              <Calendar className="mr-2 h-4 w-4" />
              Book Your Cut
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16 space-y-12">
      {/* Header */}
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <Badge variant="outline" className="border-accent/40 text-accent px-3 py-1">
          Client Feedback
        </Badge>
        <h1 className="text-4xl sm:text-5xl font-display font-semibold text-foreground tracking-tight">
          Real Reviews from Real Clients
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          We take pride in our precision cuts and unmatched customer satisfaction.
        </p>
      </div>

      {/* Rating Summary Banner */}
      <div className="rounded-2xl bg-card border border-border p-8 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
        <div className="flex flex-col md:flex-row items-center gap-6">
          <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-accent/10 border border-accent/30 min-w-[120px]">
            <span className="text-4xl font-black text-accent ">{avgRating}</span>
            <div className="flex items-center gap-0.5 mt-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`h-3.5 w-3.5 ${
                    i < Math.round(Number(avgRating)) ? 'fill-accent text-accent' : 'text-muted-foreground'
                  }`}
                />
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">
              Average Rating
            </span>
          </div>

          <div className="space-y-1">
            <h3 className="text-xl font-bold text-foreground ">
              Based on {totalReviews} Verified {totalReviews === 1 ? 'Review' : 'Reviews'}
            </h3>
            <p className="text-xs text-muted-foreground">
              100% genuine client testimonials from booked appointments.
            </p>
          </div>
        </div>

        <Button asChild size="lg" className="bg-accent hover:brightness-110 text-accent-foreground font-bold shrink-0">
          <Link href="/book">
            <Calendar className="mr-2 h-4 w-4" />
            Book Your Cut
          </Link>
        </Button>
      </div>

      {/* Review presentation — owner-selected variant (editorial / cards /
          strip). Same real published records in all three; only the
          composition changes. */}
      {visual.reviewPresentation === 'editorial' ? (
        /* EDITORIAL: full-width pull-quotes separated by hairlines —
           the menu-grammar treatment: type is the design. */
        <div className="max-w-3xl mx-auto divide-y divide-border/60">
          {reviews.map((review) => (
            <article key={review.id} className="py-10 first:pt-0">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`h-3.5 w-3.5 ${
                        i < review.rating ? 'fill-accent text-accent' : 'text-muted-foreground/30'
                      }`}
                    />
                  ))}
                </div>
                {review.isFeatured && (
                  <Badge variant="secondary" className="bg-accent/10 text-accent text-[10px] border border-accent/20">
                    Featured
                  </Badge>
                )}
              </div>
              <blockquote className="mt-4 font-display text-xl sm:text-2xl leading-snug text-foreground">
                &ldquo;{review.comment}&rdquo;
              </blockquote>
              <p className="mt-4 text-xs uppercase tracking-widest text-muted-foreground">
                {review.authorName || 'Anonymous'}
                {review.createdAt ? ` · ${formatFullDate(new Date(review.createdAt))}` : ''}
              </p>
            </article>
          ))}
        </div>
      ) : visual.reviewPresentation === 'strip' ? (
        /* STRIP: horizontal scroll-snap rail of compact quote cards —
           overflow-x scrolls, never overflows the viewport. */
        <div
          className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 -mx-4 px-4 sm:mx-0 sm:px-0"
          aria-label="Client reviews"
        >
          {reviews.map((review) => (
            <article
              key={review.id}
              className="snap-start shrink-0 w-[280px] sm:w-[320px] rounded-lg border border-border bg-card p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-2">
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`h-3.5 w-3.5 ${
                        i < review.rating ? 'fill-accent text-accent' : 'text-muted-foreground/30'
                      }`}
                    />
                  ))}
                </div>
                <p className="text-sm text-foreground/70 leading-relaxed line-clamp-5">
                  &ldquo;{review.comment}&rdquo;
                </p>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-bold text-foreground/80">{review.authorName || 'Anonymous'}</span>
                <span>{review.createdAt ? formatFullDate(new Date(review.createdAt)) : 'Recent'}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        /* CARDS (default): the classic balanced grid. */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {reviews.map((review) => (
            <Card key={review.id} className="bg-card/80 border-border p-6 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-4 w-4 ${
                          i < review.rating ? 'fill-accent text-accent' : 'text-muted-foreground/30'
                        }`}
                      />
                    ))}
                  </div>
                  {review.isFeatured && (
                    <Badge variant="secondary" className="bg-accent/10 text-accent text-[10px] border border-accent/20">
                      Featured
                    </Badge>
                  )}
                </div>

                <p className="text-sm text-foreground/70 italic leading-relaxed">
                  &ldquo;{review.comment}&rdquo;
                </p>
              </div>

              <div className="pt-4 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-bold text-foreground/80">{review.authorName || 'Anonymous'}</span>
                <span>{review.createdAt ? formatFullDate(new Date(review.createdAt)) : 'Recent'}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

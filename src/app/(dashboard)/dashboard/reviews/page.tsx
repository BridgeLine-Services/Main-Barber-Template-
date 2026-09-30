import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { canManageBusiness } from '@/lib/permissions'
import { ReviewsClient, type Barber, type Review } from './ReviewsClient'

export default async function ReviewsPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user
  if (!canManageBusiness(user.role)) {
    redirect('/dashboard')
  }

  let reviews: Review[] = []
  let barbers: Barber[] = []
  let avgRating = '0.0'
  let total = 0

  try {
    const [rawReviews, rawBarbers] = await Promise.all([
      prisma.review.findMany({
        where: { businessId: user.businessId },
        orderBy: { createdAt: 'desc' },
        include: { barber: { select: { name: true, slug: true } } },
      }),
      prisma.barber.findMany({
        where: { businessId: user.businessId, isActive: true },
        select: { id: true, name: true, slug: true },
        orderBy: { name: 'asc' },
      }),
    ])

    reviews = rawReviews.map(r => ({
      id: r.id,
      authorName: r.authorName,
      rating: r.rating,
      comment: r.comment,
      isFeatured: r.isFeatured,
      isPublished: r.isPublished,
      isGoogleReview: r.isGoogleReview,
      barberId: r.barberId,
      barberName: r.barber?.name || null,
      barberSlug: r.barber?.slug || null,
      createdAt: r.createdAt.toISOString(),
    }))

    barbers = rawBarbers

    avgRating = reviews.length > 0
      ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
      : '0.0'
    total = reviews.length
  } catch (error) {
    console.error('Failed to load reviews:', error)
  }

  return <ReviewsClient initialReviews={reviews} barbers={barbers} avgRating={avgRating} total={total} businessId={user.businessId} />
}

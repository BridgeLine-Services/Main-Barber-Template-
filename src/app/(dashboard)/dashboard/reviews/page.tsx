import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { canManageBusiness } from '@/lib/permissions'
import { ReviewsClient, type Barber, type Review } from './ReviewsClient'
import { ReviewInvites } from './ReviewInvites'
import {
  getReviewRequestSummary,
  listReviewRequests,
  type ReviewRequestListRow,
  type ReviewRequestSummary,
} from '@/lib/review-requests'

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
  // Invites load separately from reviews so a problem with one never blanks the other.
  let inviteSummary: ReviewRequestSummary | null = null
  let inviteRows: ReviewRequestListRow[] = []
  let inviteLoadFailed = false

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

  try {
    const [summary, list] = await Promise.all([
      getReviewRequestSummary(user.businessId),
      listReviewRequests(user.businessId, { take: 10 }),
    ])
    inviteSummary = summary
    inviteRows = list.rows
  } catch (error) {
    // Never a stack trace for the owner: the panel says it could not load, and the
    // reviews list below still works.
    console.error('Failed to load review invites:', error)
    inviteLoadFailed = true
  }

  return (
    <div className="space-y-6">
      <ReviewInvites summary={inviteSummary} rows={inviteRows} loadFailed={inviteLoadFailed} />
      <ReviewsClient initialReviews={reviews} barbers={barbers} avgRating={avgRating} total={total} businessId={user.businessId} />
    </div>
  )
}

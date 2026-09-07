import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/auth-helpers'
import { getClientIP } from '@/lib/rate-limit'
import { AuditAction } from '@prisma/client'
import { z } from 'zod'

// Validation schemas
const createReviewSchema = z.object({
  authorName: z.string().min(1).max(100),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
  barberId: z.string().optional().nullable(),
})

const updateReviewSchema = z.object({
  id: z.string().min(1),
  isFeatured: z.boolean().optional(),
  barberId: z.string().optional().nullable(),
  authorName: z.string().min(1).max(100).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(2000).optional(),
})

// POST — customer submits a review (unauthenticated but server-side tenant-resolved)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parseResult = createReviewSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid review data', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const data = parseResult.data

    // Resolve the business server-side from hostname/tenant config
    // Do NOT accept businessId from the request
    const { resolveBusinessId } = await import('@/lib/tenant')
    const businessId = await resolveBusinessId()

    // If barberId is provided, verify it belongs to this business
    if (data.barberId) {
      const barber = await prisma.barber.findFirst({
        where: { id: data.barberId, businessId },
      })
      if (!barber) {
        return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
      }
    }

    const review = await prisma.review.create({
      data: {
        businessId,
        barberId: data.barberId || null,
        authorName: data.authorName.trim(),
        rating: data.rating,
        comment: data.comment?.trim() || null,
      },
    })

    return NextResponse.json(review, { status: 201 })
  } catch (error) {
    console.error('Review submit error:', error)
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 })
  }
}

// GET — owner lists reviews (authenticated, OWNER only)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = session.user as any
  if (user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const barberId = searchParams.get('barberId')

    const where: any = { businessId: user.businessId }
    if (barberId) {
      where.barberId = barberId
    }

    const reviews = await prisma.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: barberId ? undefined : { barber: { select: { name: true, slug: true } } },
    })

    const serialized = reviews.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))

    const avgRating = reviews.length > 0
      ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
      : '0.0'

    return NextResponse.json({ reviews: serialized, avgRating, total: reviews.length })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 })
  }
}

// PATCH — owner updates review (toggle featured, assign barber, edit)
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = session.user as any
  if (user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const parseResult = updateReviewSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid review data', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { id, ...updateData } = parseResult.data

    // Verify review belongs to this business
    const review = await prisma.review.findFirst({
      where: { id, businessId: user.businessId },
    })

    if (!review) {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    }

    // If barberId is being set, verify it belongs to this business
    if (updateData.barberId) {
      const barber = await prisma.barber.findFirst({
        where: { id: updateData.barberId, businessId: user.businessId },
      })
      if (!barber) {
        return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
      }
    }

    const updated = await prisma.review.update({
      where: { id },
      data: {
        ...updateData,
        barberId: updateData.barberId === undefined ? undefined : (updateData.barberId || null),
      },
    })

    await logAudit({
      userId: user.id,
      businessId: user.businessId,
      action: AuditAction.SETTINGS_UPDATED,
      entityType: 'Review',
      entityId: id,
      oldValues: review,
      newValues: updateData,
      ipAddress: getClientIP(req),
      userAgent: req.headers.get('user-agent') || undefined,
    })

    return NextResponse.json(updated)
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update review' }, { status: 500 })
  }
}

// DELETE — owner deletes review
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = session.user as any
  if (user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Review ID required' }, { status: 400 })
    }

    const review = await prisma.review.findFirst({
      where: { id, businessId: user.businessId },
    })

    if (!review) {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    }

    await prisma.review.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete review' }, { status: 500 })
  }
}

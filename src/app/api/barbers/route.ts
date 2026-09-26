export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server"
import { prisma } from '@/lib/prisma'
import { resolveBusiness } from '@/lib/tenant'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * GET /api/barbers
 * Public endpoint: returns all active barbers for the resolved business.
 * No demo fallback in production — if no business exists, returns empty.
 */
export async function GET(req: NextRequest) {
  const rateLimitResult = checkRateLimit(req, 'barbers', RATE_LIMITS.API)
  if (rateLimitResult) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again in a moment.' },
      { status: rateLimitResult.status }
    )
  }

  const business = await resolveBusiness().catch(() => null)

  if (!business) {
    return NextResponse.json({ barbers: [], error: 'No business configured' }, { status: 404 })
  }

  const barbers = await prisma.barber.findMany({
    where: {
      businessId: business.id,
      isActive: true,
    },
    include: {
      services: {
        where: { isActive: true },
        include: { service: true },
        orderBy: { sortOrder: 'asc' },
      },
      reviews: {
        where: { isPublished: true },
        select: { rating: true },
      },
    },
    orderBy: { order: 'asc' },
  })

  return NextResponse.json({ barbers })
}

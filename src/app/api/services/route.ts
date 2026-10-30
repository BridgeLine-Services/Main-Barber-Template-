export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server"
import { prisma } from '@/lib/prisma'
import { resolveBusiness } from '@/lib/tenant'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * GET /api/services
 * Public endpoint: returns all active services for the resolved business.
 * No demo fallback in production.
 */
export async function GET(req: NextRequest) {
  const rateLimitResult = await checkRateLimit(req, 'services', RATE_LIMITS.API)
  if (rateLimitResult) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again in a moment.' },
      { status: rateLimitResult.status }
    )
  }

  const business = await resolveBusiness().catch(() => null)

  if (!business) {
    return NextResponse.json({ services: [], error: 'No business configured' }, { status: 404 })
  }

  const services = await prisma.service.findMany({
    where: {
      businessId: business.id,
      isActive: true,
    },
    orderBy: { order: 'asc' },
  })

  return NextResponse.json({ services })
}

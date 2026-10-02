export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireBusinessAdmin, getBusinessIdForUser } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'

/**
 * GET /api/dashboard/appearance/compare
 * OWNER only. Returns a small slice of the shop's REAL data (hero text,
 * services, barbers, gallery) used by the five-preset comparison view.
 * Read-only: never modifies settings, never serves other tenants.
 */
export async function GET(_req: NextRequest) {
  try {
    const auth = await requireBusinessAdmin()
    if (!auth.success) return auth.response

    const businessId = await getBusinessIdForUser(auth.user)
    if (!businessId) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 })
    }

    const [business, content, services, barbers, gallery] = await Promise.all([
      prisma.business.findUnique({
        where: { id: businessId },
        select: { name: true },
      }),
      prisma.websiteContent.findUnique({
        where: { businessId },
        select: {
          heroEyebrow: true,
          heroTitle: true,
          heroDescription: true,
          heroImageUrl: true,
        },
      }),
      prisma.service.findMany({
        where: { businessId, isActive: true },
        select: { name: true, price: true, duration: true },
        orderBy: { order: 'asc' },
        take: 3,
      }),
      prisma.barber.findMany({
        where: { businessId, isActive: true },
        select: { name: true, photo: true, specialty: true },
        orderBy: { createdAt: 'asc' },
        take: 3,
      }),
      prisma.mediaAsset.findMany({
        where: { businessId, isPublished: true, type: 'GALLERY', barberId: null },
        select: { url: true, altText: true },
        orderBy: { sortOrder: 'asc' },
        take: 4,
      }),
    ])

    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 })
    }

    return NextResponse.json({
      shop: {
        name: business.name,
        heroEyebrow: content?.heroEyebrow ?? null,
        heroTitle: content?.heroTitle ?? null,
        heroDescription: content?.heroDescription ?? null,
        heroImageUrl: content?.heroImageUrl ?? null,
      },
      services,
      barbers,
      gallery,
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/appearance/compare')
  }
}

export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logAudit } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'

/**
 * Before/After transformation pairs — owner-curated REAL image pairs.
 *
 * GET    /api/dashboard/before-after          → list published + draft pairs
 * POST   /api/dashboard/before-after          → create a pair
 *
 * Tenant safety: every lookup is scoped by businessId from the session.
 * Both images must be existing MediaAssets of THIS business (never another
 * shop's asset id); barber/service attribution is verified to belong to the
 * business. Barbers may only manage pairs attributed to themselves.
 */

const pairSchema = z.object({
  beforeAssetId: z.string().min(1),
  afterAssetId: z.string().min(1),
  barberId: z.string().optional().nullable(),
  serviceId: z.string().optional().nullable(),
  caption: z.string().max(120).optional().nullable(),
  details: z.string().max(1000).optional().nullable(),
  sortOrder: z.number().int().optional(),
  isPublished: z.boolean().optional(),
})

async function verifyAssets(businessId: string, beforeAssetId: string, afterAssetId: string) {
  if (beforeAssetId === afterAssetId) return 'Before and after images must be different'
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: [beforeAssetId, afterAssetId] }, businessId },
    select: { id: true },
  })
  if (assets.length !== 2) return 'Both images must belong to your shop'
  return null
}

async function verifyAttribution(
  businessId: string,
  barberId?: string | null,
  serviceId?: string | null
) {
  if (barberId) {
    const barber = await prisma.barber.findFirst({ where: { id: barberId, businessId }, select: { id: true } })
    if (!barber) return 'Barber not found'
  }
  if (serviceId) {
    const service = await prisma.service.findFirst({ where: { id: serviceId, businessId }, select: { id: true } })
    if (!service) return 'Service not found'
  }
  return null
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user?.role === 'CUSTOMER') return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
    const businessId = session.user?.businessId
    const role = session.user?.role
    const sessionBarberId = session.user?.barberId

    const pairs = await prisma.beforeAfterPair.findMany({
      where: { businessId, ...(role === 'BARBER' && sessionBarberId ? { OR: [{ barberId: sessionBarberId }, { barberId: null }] } : {}) },
      orderBy: { sortOrder: 'asc' },
      include: {
        beforeAsset: { select: { id: true, url: true, altText: true, focalX: true, focalY: true } },
        afterAsset: { select: { id: true, url: true, altText: true, focalX: true, focalY: true } },
        barber: { select: { id: true, name: true, slug: true } },
        service: { select: { id: true, name: true } },
      },
    })
    return NextResponse.json({ pairs })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/before-after')
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user?.role === 'CUSTOMER') return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
    const businessId = session.user?.businessId
    const role = session.user?.role
    const sessionBarberId = session.user?.barberId
    if (!businessId) return NextResponse.json({ error: 'No business context' }, { status: 400 })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    const parsed = pairSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid pair data', details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const data = parsed.data

    const assetError = await verifyAssets(businessId, data.beforeAssetId, data.afterAssetId)
    if (assetError) return NextResponse.json({ error: assetError }, { status: 403 })
    const attributionError = await verifyAttribution(businessId, data.barberId, data.serviceId)
    if (attributionError) return NextResponse.json({ error: attributionError }, { status: 403 })
    // Barbers may only create pairs attributed to themselves (or unattributed).
    if (role === 'BARBER' && sessionBarberId && data.barberId && data.barberId !== sessionBarberId) {
      return NextResponse.json({ error: 'You can only create pairs attributed to yourself' }, { status: 403 })
    }

    const pair = await prisma.beforeAfterPair.create({
      data: {
        businessId,
        beforeAssetId: data.beforeAssetId,
        afterAssetId: data.afterAssetId,
        barberId: data.barberId ?? null,
        serviceId: data.serviceId ?? null,
        caption: data.caption ?? null,
        details: data.details ?? null,
        sortOrder: data.sortOrder ?? 0,
        isPublished: data.isPublished ?? true,
      },
      include: {
        beforeAsset: { select: { url: true, altText: true } },
        afterAsset: { select: { url: true, altText: true } },
      },
    })

    await logAudit({
      userId: session.user.id,
      businessId,
      action: 'SETTINGS_UPDATED',
      entityType: 'BeforeAfterPair',
      entityId: pair.id,
      newValues: { beforeAssetId: pair.beforeAssetId, afterAssetId: pair.afterAssetId, isPublished: pair.isPublished },
    })
    return NextResponse.json({ pair }, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/before-after')
  }
}

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/auth-helpers'
import { getClientIP } from '@/lib/rate-limit'
import { AuditAction, MediaType } from '@prisma/client'
import { z } from 'zod'
import { handleApiError } from '@/lib/api-errors'
import { del } from '@vercel/blob'

const createMediaSchema = z.object({
  url: z.string().url(),
  type: z.nativeEnum(MediaType),
  barberId: z.string().optional().nullable(),
  serviceId: z.string().optional().nullable(),
  altText: z.string().max(300).optional().nullable(),
  caption: z.string().max(500).optional().nullable(),
  sortOrder: z.number().int().default(0),
  isPublished: z.boolean().default(true),
})

const updateMediaSchema = z.object({
  id: z.string().min(1),
  serviceId: z.string().optional().nullable(),
  altText: z.string().max(300).optional().nullable(),
  caption: z.string().max(500).optional().nullable(),
  sortOrder: z.number().int().optional(),
  isPublished: z.boolean().optional(),
})

/**
 * GET /api/dashboard/media?type=GALLERY&barberId=xxx
 * OWNER: list all media for business, optionally filtered by type/barber
 * BARBER: list only their own media (barberId forced from session)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const role = (session.user as any)?.role
    const businessId = (session.user as any)?.businessId
    const sessionBarberId = (session.user as any)?.barberId
    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') as MediaType | null
    const urlBarberId = searchParams.get('barberId')
    const serviceId = searchParams.get('serviceId')
    const where: any = { businessId }
    if (type) where.type = type
    if (serviceId) where.serviceId = serviceId
    if (role === 'BARBER') {
      where.barberId = sessionBarberId
    } else if (urlBarberId) {
      where.barberId = urlBarberId
    }
    const media = await prisma.mediaAsset.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    })
    // Service options for linking portfolio work:
    // OWNER — all active business services; BARBER — only services they offer.
    const services =
      role === 'BARBER' && sessionBarberId
        ? (
            await prisma.barberService.findMany({
              where: { barberId: sessionBarberId, isActive: true, service: { isActive: true } },
              select: { service: { select: { id: true, name: true } } },
              orderBy: { sortOrder: 'asc' },
            })
          ).map((bs) => bs.service)
        : await prisma.service.findMany({
            where: { businessId, isActive: true },
            select: { id: true, name: true },
            orderBy: { order: 'asc' },
          })
    return NextResponse.json({ media, services })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/media')
  }
}

/**
 * Validate that serviceId belongs to this business (and, for BARBER role,
 * that the barber offers the service). Returns an error string or null.
 * Smallest possible schema change for service-linked portfolio work:
 * MediaAsset.serviceId is optional and validated against the tenant.
 */
async function validateServiceLink(
  serviceId: string | null | undefined,
  businessId: string,
  role: string,
  barberId: string | null | undefined
): Promise<string | null> {
  if (!serviceId) return null
  const service = await prisma.service.findFirst({
    where: { id: serviceId, businessId },
    select: { id: true, isActive: true },
  })
  if (!service) return 'Service not found'
  if (role === 'BARBER') {
    const link = barberId
      ? await prisma.barberService.findFirst({
          where: { serviceId, barberId, isActive: true },
          select: { barberId: true },
        })
      : null
    if (!link) return 'You can only link services you offer'
  }
  return null
}

/**
 * POST /api/dashboard/media
 * Create a new media asset record.
 * OWNER: can create any type of media (shop or barber-specific)
 * BARBER: can only create BARBER_PHOTO or BARBER_PORTFOLIO for themselves
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const role = (session.user as any)?.role
    const businessId = (session.user as any)?.businessId
    const userId = (session.user as any)?.id
    const sessionBarberId = (session.user as any)?.barberId
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    const parseResult = createMediaSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid media data', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }
    const data = parseResult.data
    // BARBER role restrictions: can only upload portfolio/photos for themselves
    if (role === 'BARBER') {
      if (!sessionBarberId) return NextResponse.json({ error: 'No barber profile' }, { status: 400 })
      if (data.type !== MediaType.BARBER_PHOTO && data.type !== MediaType.BARBER_PORTFOLIO) {
        return NextResponse.json({ error: 'Barbers can only upload photos for themselves' }, { status: 403 })
      }
      data.barberId = sessionBarberId
    } else {
      // OWNER: if barberId specified, verify barber belongs to this business
      if (data.barberId) {
        const barber = await prisma.barber.findFirst({
          where: { id: data.barberId, businessId },
        })
        if (!barber) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
      }
    }
    // Service-linked portfolio: validate tenant + (barber) own-service rule
    const serviceError = await validateServiceLink(data.serviceId, businessId, role, role === 'BARBER' ? sessionBarberId : data.barberId)
    if (serviceError) {
      return NextResponse.json({ error: serviceError }, { status: 403 })
    }
    // If type is LOGO or HERO, unpublish previous assets of that type (only one active)
    if (data.type === MediaType.LOGO || data.type === MediaType.HERO || data.type === MediaType.FAVICON || data.type === MediaType.OG_IMAGE) {
      await prisma.mediaAsset.updateMany({
        where: { businessId, type: data.type },
        data: { isPublished: false },
      })
    }
    let media
    try {
      media = await prisma.mediaAsset.create({
        data: {
          businessId,
          barberId: data.barberId || null,
          serviceId: data.serviceId || null,
          type: data.type,
          url: data.url,
          altText: data.altText || null,
          caption: data.caption || null,
          sortOrder: data.sortOrder,
          isPublished: data.isPublished,
        },
      })
    } catch (error) {
      try {
        if (data.url.includes('.public.blob.vercel-storage.com/')) await del(data.url)
      } catch (cleanupError) {
        console.error('[media] orphan cleanup failed', cleanupError instanceof Error ? cleanupError.message : 'unknown error')
      }
      throw error
    }
    try {
      await logAudit({
        userId,
        businessId,
        action: AuditAction.SETTINGS_UPDATED,
        entityType: 'MediaAsset',
        entityId: media.id,
        newValues: data,
        ipAddress: getClientIP(req),
        userAgent: req.headers.get('user-agent') || undefined,
      })
    } catch (auditError) {
      console.error('[media] audit log failed after create', auditError instanceof Error ? auditError.message : 'unknown error')
    }
    return NextResponse.json({ media }, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/media')
  }
}

/**
 * PATCH /api/dashboard/media
 * Update a media asset (alt text, caption, sort order, published status)
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const role = (session.user as any)?.role
    const businessId = (session.user as any)?.businessId
    const userId = (session.user as any)?.id
    const sessionBarberId = (session.user as any)?.barberId
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    const parseResult = updateMediaSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid data', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }
    const { id, ...updateData } = parseResult.data
    const media = await prisma.mediaAsset.findUnique({ where: { id } })
    if (!media) return NextResponse.json({ error: 'Media not found' }, { status: 404 })
    if (media.businessId !== businessId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // Service-linked portfolio: validate tenant + (barber) own-service rule
    if (updateData.serviceId !== undefined) {
      const serviceError = await validateServiceLink(
        updateData.serviceId,
        businessId,
        role,
        role === 'BARBER' ? sessionBarberId : media.barberId
      )
      if (serviceError) {
        return NextResponse.json({ error: serviceError }, { status: 403 })
      }
    }
    // BARBER can only manage their own portfolio assets. Profile photos are
    // intentionally owner-managed through the existing profile flow.
    if (role === 'BARBER' && (media.barberId !== sessionBarberId || media.type !== MediaType.BARBER_PORTFOLIO)) {
      return NextResponse.json({ error: 'You can only update your own portfolio media' }, { status: 403 })
    }
    const updated = await prisma.mediaAsset.update({
      where: { id },
      data: updateData,
    })
    try {
      await logAudit({
        userId,
        businessId,
        action: AuditAction.SETTINGS_UPDATED,
        entityType: 'MediaAsset',
        entityId: id,
        oldValues: media,
        newValues: updateData,
        ipAddress: getClientIP(req),
        userAgent: req.headers.get('user-agent') || undefined,
      })
    } catch (auditError) {
      console.error('[media] audit log failed after update', auditError instanceof Error ? auditError.message : 'unknown error')
    }
    return NextResponse.json({ media: updated })
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/media')
  }
}

/**
 * DELETE /api/dashboard/media?id=xxx
 * Delete a media asset.
 * BARBER: can only delete their own media
 * OWNER: can delete any media in their business
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const role = (session.user as any)?.role
    const businessId = (session.user as any)?.businessId
    const userId = (session.user as any)?.id
    const sessionBarberId = (session.user as any)?.barberId
    const { searchParams } = new URL(req.url)
    const body = await req.json().catch(() => ({}))
    const id = searchParams.get('id') || (typeof body.id === 'string' ? body.id : null)
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const media = await prisma.mediaAsset.findUnique({ where: { id } })
    if (!media) return NextResponse.json({ error: 'Media not found' }, { status: 404 })
    if (media.businessId !== businessId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (role === 'BARBER' && (media.barberId !== sessionBarberId || media.type !== MediaType.BARBER_PORTFOLIO)) {
      return NextResponse.json({ error: 'You can only delete your own portfolio media' }, { status: 403 })
    }
    await prisma.mediaAsset.delete({ where: { id } })
    try {
      await logAudit({
        userId,
        businessId,
        action: AuditAction.SETTINGS_UPDATED,
        entityType: 'MediaAsset',
        entityId: id,
        oldValues: media,
        ipAddress: getClientIP(req),
        userAgent: req.headers.get('user-agent') || undefined,
      })
    } catch (auditError) {
      console.error('[media] audit log failed after delete', auditError instanceof Error ? auditError.message : 'unknown error')
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/media')
  }
}

export const dynamic = 'force-dynamic'

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logAudit } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'

/**
 * PATCH   /api/dashboard/before-after/[id] → update caption/attrution/publish/order
 * DELETE  /api/dashboard/before-after/[id] → remove a pair
 *
 * Tenant safety: the pair is looked up by id AND session businessId; a pair
 * from another shop is indistinguishable from a nonexistent one (404).
 */

const patchSchema = z.object({
  beforeAssetId: z.string().min(1).optional(),
  afterAssetId: z.string().min(1).optional(),
  barberId: z.string().optional().nullable(),
  serviceId: z.string().optional().nullable(),
  caption: z.string().max(120).optional().nullable(),
  details: z.string().max(1000).optional().nullable(),
  sortOrder: z.number().int().optional(),
  isPublished: z.boolean().optional(),
})

async function resolvePair(id: string, businessId: string, role?: string, sessionBarberId?: string | null) {
  const pair = await prisma.beforeAfterPair.findFirst({ where: { id, businessId } })
  if (!pair) return { error: 'not-found' as const }
  if (role === 'BARBER' && sessionBarberId && pair.barberId && pair.barberId !== sessionBarberId) {
    return { error: 'forbidden' as const }
  }
  return { pair }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user?.role === 'CUSTOMER') return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
    const businessId = session.user?.businessId
    const role = session.user?.role
    const sessionBarberId = session.user?.barberId
    if (!businessId) return NextResponse.json({ error: 'No business context' }, { status: 400 })

    const found = await resolvePair(id, businessId, role, sessionBarberId)
    if (found.error === 'not-found') return NextResponse.json({ error: 'Pair not found' }, { status: 404 })
    if (found.error === 'forbidden') return NextResponse.json({ error: 'You can only manage your own pairs' }, { status: 403 })
    const existing = found.pair

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid pair data', details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const data = parsed.data

    // If either image is being swapped, verify the new assets belong to this business.
    const nextBefore = data.beforeAssetId ?? existing.beforeAssetId
    const nextAfter = data.afterAssetId ?? existing.afterAssetId
    if (nextBefore === nextAfter) return NextResponse.json({ error: 'Before and after images must be different' }, { status: 400 })
    if (data.beforeAssetId || data.afterAssetId) {
      const assets = await prisma.mediaAsset.findMany({
        where: { id: { in: [nextBefore, nextAfter] }, businessId },
        select: { id: true },
      })
      if (assets.length !== 2) return NextResponse.json({ error: 'Both images must belong to your shop' }, { status: 403 })
    }
    if (data.barberId) {
      const barber = await prisma.barber.findFirst({ where: { id: data.barberId, businessId }, select: { id: true } })
      if (!barber) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
    }
    if (data.serviceId) {
      const service = await prisma.service.findFirst({ where: { id: data.serviceId, businessId }, select: { id: true } })
      if (!service) return NextResponse.json({ error: 'Service not found' }, { status: 404 })
    }

    const pair = await prisma.beforeAfterPair.update({
      where: { id: existing.id },
      data: {
        ...(data.beforeAssetId !== undefined ? { beforeAssetId: data.beforeAssetId } : {}),
        ...(data.afterAssetId !== undefined ? { afterAssetId: data.afterAssetId } : {}),
        ...(data.barberId !== undefined ? { barberId: data.barberId } : {}),
        ...(data.serviceId !== undefined ? { serviceId: data.serviceId } : {}),
        ...(data.caption !== undefined ? { caption: data.caption } : {}),
        ...(data.details !== undefined ? { details: data.details } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(data.isPublished !== undefined ? { isPublished: data.isPublished } : {}),
      },
    })

    await logAudit({
      userId: session.user.id,
      businessId,
      action: 'SETTINGS_UPDATED',
      entityType: 'BeforeAfterPair',
      entityId: pair.id,
      oldValues: { caption: existing.caption, isPublished: existing.isPublished, sortOrder: existing.sortOrder },
      newValues: { caption: pair.caption, isPublished: pair.isPublished, sortOrder: pair.sortOrder },
    })
    return NextResponse.json({ pair })
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/before-after/[id]')
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user?.role === 'CUSTOMER') return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
    const businessId = session.user?.businessId
    const role = session.user?.role
    const sessionBarberId = session.user?.barberId
    if (!businessId) return NextResponse.json({ error: 'No business context' }, { status: 400 })

    const found = await resolvePair(id, businessId, role, sessionBarberId)
    if (found.error === 'not-found') return NextResponse.json({ error: 'Pair not found' }, { status: 404 })
    if (found.error === 'forbidden') return NextResponse.json({ error: 'You can only manage your own pairs' }, { status: 403 })

    await prisma.beforeAfterPair.delete({ where: { id: found.pair.id } })
    await logAudit({
      userId: session.user.id,
      businessId,
      action: 'SETTINGS_UPDATED',
      entityType: 'BeforeAfterPair',
      entityId: found.pair.id,
      oldValues: { deleted: true, beforeAssetId: found.pair.beforeAssetId, afterAssetId: found.pair.afterAssetId },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/before-after/[id]')
  }
}

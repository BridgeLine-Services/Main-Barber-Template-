export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/auth-helpers'
import { createAvailabilityOverrideSchema } from '@/lib/validation'
import { getClientIP } from '@/lib/rate-limit'
import { AuditAction } from '@prisma/client'
import { handleApiError } from '@/lib/api-errors'

/**
 * GET /api/dashboard/availability-overrides?barberId=xxx
 * Returns all date-specific availability overrides for a barber.
 * - BARBER: can only view their own overrides
 * - OWNER: can view any barber's overrides
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const role = (session.user as any)?.role
    const sessionBarberId = (session.user as any)?.barberId
    const businessId = (session.user as any)?.businessId
    const { searchParams } = new URL(req.url)
    const urlBarberId = searchParams.get('barberId')
    const targetBarberId = role === 'BARBER' ? sessionBarberId : urlBarberId
    if (!targetBarberId) return NextResponse.json({ error: 'barberId required' }, { status: 400 })
    // Verify barber belongs to this business
    const barber = await prisma.barber.findFirst({
      where: { id: targetBarberId, businessId },
    })
    if (!barber) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
    const overrides = await prisma.availabilityOverride.findMany({
      where: { barberId: targetBarberId },
      orderBy: { date: 'asc' },
    })
    return NextResponse.json(overrides)
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/availability-overrides')
  }
}

/**
 * POST /api/dashboard/availability-overrides?barberId=xxx
 * Create or update a date-specific availability override.
 * If an override already exists for this barber+date, it's replaced (upsert).
 * - BARBER: can only create overrides for themselves
 * - OWNER: can create overrides for any barber
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const role = (session.user as any)?.role
    const sessionBarberId = (session.user as any)?.barberId
    const businessId = (session.user as any)?.businessId
    const userId = (session.user as any)?.id
    const { searchParams } = new URL(req.url)
    const urlBarberId = searchParams.get('barberId')
    const targetBarberId = role === 'BARBER' ? sessionBarberId : urlBarberId
    if (!targetBarberId) return NextResponse.json({ error: 'barberId required' }, { status: 400 })
    // Verify barber belongs to this business
    const barber = await prisma.barber.findFirst({
      where: { id: targetBarberId, businessId },
    })
    if (!barber) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
    // Validate input
    const body = await req.json()
    const parseResult = createAvailabilityOverrideSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid override data', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }
    // If isAvailable is true, startTime and endTime are required
    const data = parseResult.data
    if (data.isAvailable && (!data.startTime || !data.endTime)) {
      return NextResponse.json(
        { error: 'startTime and endTime are required when isAvailable is true' },
        { status: 400 }
      )
    }
    const dateObj = new Date(data.date + 'T00:00:00.000Z')
    // Upsert: unique constraint on [barberId, date]
    const override = await prisma.availabilityOverride.upsert({
      where: {
        barberId_date: {
          barberId: targetBarberId,
          date: dateObj,
        },
      },
      create: {
        businessId,
        barberId: targetBarberId,
        date: dateObj,
        isAvailable: data.isAvailable,
        startTime: data.startTime || null,
        endTime: data.endTime || null,
        breaks: data.breaks || undefined,
        reason: data.reason || null,
      },
      update: {
        isAvailable: data.isAvailable,
        startTime: data.startTime || null,
        endTime: data.endTime || null,
        breaks: data.breaks || undefined,
        reason: data.reason || null,
      },
    })
    await logAudit({
      userId,
      businessId,
      action: AuditAction.AVAILABILITY_OVERRIDE_ADDED,
      entityType: 'AvailabilityOverride',
      entityId: override.id,
      newValues: data,
      ipAddress: getClientIP(req),
      userAgent: req.headers.get('user-agent') || undefined,
    })
    return NextResponse.json(override, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/availability-overrides')
  }
}

/**
 * DELETE /api/dashboard/availability-overrides?id=xxx
 * Remove a date-specific availability override.
 * - BARBER: can only delete their own overrides
 * - OWNER: can delete any barber's overrides
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const role = (session.user as any)?.role
    const sessionBarberId = (session.user as any)?.barberId
    const businessId = (session.user as any)?.businessId
    const userId = (session.user as any)?.id
    const { searchParams } = new URL(req.url)
    const overrideId = searchParams.get('id')
    if (!overrideId) return NextResponse.json({ error: 'id required' }, { status: 400 })
    // Fetch the override and verify ownership
    const override = await prisma.availabilityOverride.findUnique({
      where: { id: overrideId },
    })
    if (!override) return NextResponse.json({ error: 'Override not found' }, { status: 404 })
    // Tenant isolation: verify the override belongs to this business
    if (override.businessId !== businessId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // BARBER can only delete their own overrides
    if (role === 'BARBER' && override.barberId !== sessionBarberId) {
      return NextResponse.json({ error: 'You can only delete your own overrides' }, { status: 403 })
    }
    await prisma.availabilityOverride.delete({ where: { id: overrideId } })
    await logAudit({
      userId,
      businessId,
      action: AuditAction.AVAILABILITY_OVERRIDE_REMOVED,
      entityType: 'AvailabilityOverride',
      entityId: overrideId,
      oldValues: override,
      ipAddress: getClientIP(req),
      userAgent: req.headers.get('user-agent') || undefined,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/availability-overrides')
  }
}

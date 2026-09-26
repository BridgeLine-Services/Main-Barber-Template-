export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { updateBarberSchema } from '@/lib/validation'
import { handleApiError, validationError } from '@/lib/api-errors'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const barber = await prisma.barber.findFirst({
      where: { id: params.id, businessId },
      include: {
        services: { include: { service: true } },
        schedules: { orderBy: { dayOfWeek: 'asc' } },
      },
    })
    if (!barber) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(barber)
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/barbers/[id]')
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ((session.user as any)?.role !== 'OWNER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const businessId = (session.user as any)?.businessId
    const existing = await prisma.barber.findFirst({ where: { id: params.id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const body = await req.json()
    const parseResult = updateBarberSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: validationError(parseResult.error).message, details: validationError(parseResult.error).fieldErrors },
        { status: 400 }
      )
    }
    const { name, specialty, bio, photo, isActive, order, serviceIds } = parseResult.data
    // Tenant isolation: linked services must belong to THIS business
    if (serviceIds?.length) {
      const owned = await prisma.service.count({
        where: { id: { in: serviceIds }, businessId },
      })
      if (owned !== serviceIds.length) {
        return NextResponse.json(
          { error: 'One or more selected services do not belong to this shop' },
          { status: 403 }
        )
      }
    }
    // Update services if provided
    if (serviceIds !== undefined) {
      await prisma.barberService.deleteMany({ where: { barberId: params.id } })
      if (serviceIds.length > 0) {
        await prisma.barberService.createMany({
          data: serviceIds.map((id: string) => ({ barberId: params.id, serviceId: id })),
        })
      }
    }
    const barber = await prisma.barber.update({
      where: { id: params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(specialty !== undefined && { specialty }),
        ...(bio !== undefined && { bio }),
        ...(photo !== undefined && { photo }),
        ...(isActive !== undefined && { isActive }),
        ...(order !== undefined && { order }),
      },
      include: { services: { include: { service: true } } },
    })
    return NextResponse.json(barber)
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/barbers/[id]')
  }
}

/**
 * DELETE /api/dashboard/barbers/[id]
 * Safely remove a barber (owner only, tenant-scoped).
 *
 * Safest behavior is chosen automatically:
 * - Barber has any appointment history (any status):
 *     the barber is DEACTIVATED instead of deleted — removed from public
 *     listings and new bookings, history and reporting preserved.
 * - Barber has no appointment history:
 *     permanently deleted along with their schedules, service links,
 *     barber-owned media, blocked times, overrides and inventory rows.
 *     A linked staff login account is unlinked (not deleted) so
 *     authentication infrastructure is never destroyed.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ((session.user as any)?.role !== 'OWNER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const businessId = (session.user as any)?.businessId

    const existing = await prisma.barber.findFirst({ where: { id: params.id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const appointmentCount = await prisma.appointment.count({ where: { barberId: params.id } })

    if (appointmentCount > 0) {
      // Safe deactivation — preserve history, remove from new bookings
      const barber = await prisma.barber.update({
        where: { id: params.id },
        data: { isActive: false },
      })
      try {
        await prisma.auditLog.create({
          data: {
            businessId,
            userId: (session.user as any).id,
            action: 'BARBER_DEACTIVATED',
            entityType: 'Barber',
            entityId: params.id,
            oldValues: { name: existing.name, isActive: existing.isActive },
            newValues: { isActive: false },
            ipAddress: req.headers.get('x-forwarded-for') || undefined,
            userAgent: req.headers.get('user-agent') || undefined,
          },
        })
      } catch (auditError) {
        console.error('[barbers] audit log failed after deactivate', auditError instanceof Error ? auditError.message : 'unknown')
      }
      return NextResponse.json({
        success: true,
        deactivated: true,
        message: `${existing.name} has appointment history, so they were deactivated instead of deleted. Existing appointments and reporting are preserved.`,
      })
    }

    // No history — permanent delete is safe.
    // Collect barber-owned media first so storage objects can be cleaned up after.
    const barberMedia = await prisma.mediaAsset.findMany({
      where: { barberId: params.id },
      select: { url: true },
    })

    // Unlink a staff login account rather than deleting authentication records
    await prisma.user.updateMany({ where: { barberId: params.id }, data: { barberId: null } })

    await prisma.barber.delete({ where: { id: params.id } })

    // Best-effort storage cleanup — never blocks the delete, failures reported
    let storageCleanupFailed = false
    if (barberMedia.length > 0) {
      try {
        const { del } = await import('@vercel/blob')
        const urls = barberMedia.map((m) => m.url).filter((u) => u.includes('blob.vercel-storage.com'))
        if (urls.length > 0) await del(urls)
      } catch (storageError) {
        storageCleanupFailed = true
        console.error('[barbers] storage cleanup failed after delete', storageError instanceof Error ? storageError.message : 'unknown')
      }
    }

    try {
      await prisma.auditLog.create({
        data: {
          businessId,
          userId: (session.user as any).id,
          action: 'BARBER_DELETED',
          entityType: 'Barber',
          entityId: params.id,
          oldValues: { name: existing.name },
          ipAddress: req.headers.get('x-forwarded-for') || undefined,
          userAgent: req.headers.get('user-agent') || undefined,
        },
      })
    } catch (auditError) {
      console.error('[barbers] audit log failed after delete', auditError instanceof Error ? auditError.message : 'unknown')
    }

    return NextResponse.json({
      success: true,
      deactivated: false,
      ...(storageCleanupFailed && {
        warning: 'Barber deleted, but some storage files could not be removed. Orphaned files may need manual cleanup.',
      }),
    })
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/barbers/[id]')
  }
}

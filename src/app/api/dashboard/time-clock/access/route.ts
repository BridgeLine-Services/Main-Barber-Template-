/**
 * Time Clock per-barber access API (owner-only).
 *
 * GET   — every barber's eligibility + team-view authorization.
 * PATCH — set `eligible` (who may clock in/out) and `canViewTeamRecords`
 *         (explicitly authorize a barber to view OTHER barbers' hours).
 *
 * Defaults when no row exists: eligible, no team view. The owner only
 * creates rows to change someone's defaults. A barber can never change
 * their own access: server-side owner check on every request.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireOwner, logAudit, toAuditJson } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getBarberAccess } from '@/lib/time-clock'

export async function GET() {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = auth.user.businessId!
    const barbers = await prisma.barber.findMany({
      where: { businessId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    const rows = await Promise.all(
      barbers.map(async (b) => ({ ...b, access: await getBarberAccess(businessId, b.id) }))
    )
    return NextResponse.json({ barbers: rows })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/time-clock/access')
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = auth.user.businessId!
    const body = (await request.json()) as {
      barberId?: string
      eligible?: boolean
      canViewTeamRecords?: boolean
    }
    if (!body.barberId) {
      return NextResponse.json({ error: 'barberId is required' }, { status: 400 })
    }
    // Tenant check: the barber must belong to THIS shop.
    const barber = await prisma.barber.findFirst({ where: { id: body.barberId, businessId } })
    if (!barber) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
    if (body.eligible === undefined && body.canViewTeamRecords === undefined) {
      return NextResponse.json({ error: 'eligible or canViewTeamRecords is required' }, { status: 400 })
    }

    const current = await getBarberAccess(businessId, barber.id)
    const data: Record<string, unknown> = {}
    if (body.eligible !== undefined) data.eligible = body.eligible
    if (body.canViewTeamRecords !== undefined) data.canViewTeamRecords = body.canViewTeamRecords

    const access = await prisma.barberTimeClockAccess.upsert({
      where: { barberId: barber.id },
      update: data,
      create: { businessId, barberId: barber.id, ...data },
    })

    await logAudit({
      userId: auth.user.id,
      businessId,
      action: 'TIME_CLOCK_ACCESS_UPDATED',
      entityType: 'BarberTimeClockAccess',
      entityId: access.id,
      oldValues: toAuditJson(current),
      newValues: toAuditJson(access),
    })

    return NextResponse.json({ access })
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/time-clock/access')
  }
}

/**
 * Barber participation preference.
 *
 * A barber may opt OUT of commissions (or back in) when the owner has
 * commissions enabled. This preference can only RESTRICT a barber — it
 * can never resurrect commissions the owner disabled, and it can never
 * affect another barber (barberId comes from the session, not the body).
 *
 * PATCH /api/dashboard/commissions/participation { participates: boolean }
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireAuth, logAudit } from '@/lib/auth-helpers'
import { getClientIP } from '@/lib/rate-limit'
import { prisma } from '@/lib/prisma'
import { getCommissionSettings } from '@/lib/commissions'

export async function PATCH(request: Request) {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    const user = auth.user
    if (user.role !== 'BARBER' || !user.barberId || !user.businessId) {
      return NextResponse.json({ error: 'Barber account required' }, { status: 403 })
    }

    const body = (await request.json()) as { participates?: boolean }
    if (typeof body.participates !== 'boolean') {
      return NextResponse.json({ error: 'participates (boolean) is required' }, { status: 400 })
    }

    // Owner's master switch decides whether the preference is even
    // meaningful; rejecting while OFF keeps the barber from implying
    // commission eligibility the owner never granted.
    const settings = await getCommissionSettings(user.businessId)
    if (!settings.enabled) {
      return NextResponse.json({ error: 'Commissions are disabled for this shop' }, { status: 400 })
    }

    const participation = await prisma.barberCommissionParticipation.upsert({
      where: { barberId: user.barberId },
      update: { participates: body.participates },
      create: { businessId: user.businessId, barberId: user.barberId, participates: body.participates },
    })

    await logAudit({
      userId: user.id,
      businessId: user.businessId,
      action: 'COMMISSION_PARTICIPATION_CHANGED',
      entityType: 'BarberCommissionParticipation',
      entityId: participation.id,
      newValues: {
        barberId: user.barberId,
        participates: body.participates,
        description: `Barber ${body.participates ? 'opted into' : 'opted out of'} commissions`,
      },
      ipAddress: getClientIP(request),
      userAgent: request.headers.get('user-agent') || undefined,
    })

    return NextResponse.json({ participation })
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/commissions/participation')
  }
}

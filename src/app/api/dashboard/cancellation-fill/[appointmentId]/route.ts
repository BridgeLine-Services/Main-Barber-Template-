export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getOpeningForAppointment,
  getEligibleCandidates,
  offerOpeningToCandidate,
  OFFER_HOLD_MINUTES,
} from '@/lib/cancellation-fill'

/**
 * GET /api/dashboard/cancellation-fill/[appointmentId]
 * For a cancelled appointment whose slot is still in the future, return the
 * released opening (service/barber/time) and the eligible waitlist entries in
 * priority order. Owner/barber only; business-scoped.
 */
export async function GET(req: NextRequest, { params }: { params: { appointmentId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const businessId = (session.user as any)?.businessId
  if (!businessId) return NextResponse.json({ error: 'No business' }, { status: 403 })

  try {
    const opening = await getOpeningForAppointment(businessId, params.appointmentId)
    if (!opening) {
      return NextResponse.json({ error: 'No fillable opening for this appointment' }, { status: 404 })
    }
    const candidates = await getEligibleCandidates(opening)
    return NextResponse.json({
      opening: {
        appointmentId: opening.appointmentId,
        barberId: opening.barberId,
        barberName: opening.barberName,
        serviceId: opening.serviceId,
        serviceName: opening.serviceName,
        startTime: opening.startTime.toISOString(),
        endTime: opening.endTime.toISOString(),
        timezone: opening.timezone,
      },
      holdMinutes: OFFER_HOLD_MINUTES,
      candidates,
    })
  } catch (error: any) {
    if (error.code === 'P1001' || error.message?.includes('No business found')) {
      return NextResponse.json({ error: 'Database not available' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Failed to load opening' }, { status: 500 })
  }
}

/**
 * POST /api/dashboard/cancellation-fill/[appointmentId]
 * Notify a chosen waitlist entry about the released slot. The owner picks who
 * receives the opening. Re-checks slot availability and transitions the entry
 * WAITING -> NOTIFIED atomically.
 */
export async function POST(req: NextRequest, { params }: { params: { appointmentId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const businessId = (session.user as any)?.businessId
  if (!businessId) return NextResponse.json({ error: 'No business' }, { status: 403 })

  try {
    const body = await req.json().catch(() => ({}))
    const entryId = typeof body?.entryId === 'string' ? body.entryId : ''
    if (!entryId) return NextResponse.json({ error: 'entryId is required' }, { status: 400 })

    const opening = await getOpeningForAppointment(businessId, params.appointmentId)
    if (!opening) {
      return NextResponse.json({ error: 'This opening is no longer available' }, { status: 409 })
    }

    const origin = new URL(req.url).origin
    const actor = (session.user as any)?.name || (session.user as any)?.email || 'staff'
    const result = await offerOpeningToCandidate({ opening, entryId, claimOrigin: origin, actorLabel: actor })

    switch (result.outcome) {
      case 'OFFERED':
        return NextResponse.json({
          success: true,
          expiresAt: result.expiresAt.toISOString(),
          holdMinutes: OFFER_HOLD_MINUTES,
        })
      case 'ALREADY_NOTIFIED':
        return NextResponse.json({ error: 'This waitlist entry has already been notified' }, { status: 409 })
      case 'SLOT_TAKEN':
        return NextResponse.json({ error: 'This opening is no longer available' }, { status: 409 })
      case 'NOT_FOUND':
        return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 })
    }
  } catch (error: any) {
    if (error.code === 'P1001' || error.message?.includes('No business found')) {
      return NextResponse.json({ error: 'Database not available' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Failed to notify candidate' }, { status: 500 })
  }
}

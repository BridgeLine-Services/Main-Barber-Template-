export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveBusiness } from '@/lib/tenant'
import { resolveSessionCustomer } from '@/lib/customer-link'
import { validateSlot } from '@/lib/availability'
import { isTerminalStatus } from '@/lib/validation'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

// ============================================================================
// AUTHENTICATED CUSTOMER PORTAL — cancel / reschedule an appointment.
//
// IDOR protection: the appointment is looked up by id AND the session's
// resolved customer AND the resolved business. A request referencing any
// other customer's appointment simply 404s — it is indistinguishable from
// a nonexistent record.
// ============================================================================

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = checkRateLimit(req, 'portal-appointment-action', RATE_LIMITS.CUSTOMER_ACTION)
  if (limited) return NextResponse.json({ error: 'Too many attempts. Please wait a moment.' }, { status: limited.status })

  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || role !== 'CUSTOMER') {
    return NextResponse.json({ error: 'Sign in to your customer account to use the portal.' }, { status: 401 })
  }

  const business = await resolveBusiness()
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 })

  const resolved = await resolveSessionCustomer(session, business.id)
  if (!resolved) {
    return NextResponse.json({ error: 'No customer record found for this business.' }, { status: 404 })
  }

  const { id } = await params
  const body = await req.json().catch(() => null)
  const action = body?.action

  // Ownership-scoped lookup: id + session customer + business. Any attempt
  // to act on another customer's appointment returns 404.
  const appointment = await prisma.appointment.findFirst({
    where: { id, customerId: resolved.customer.id, businessId: business.id },
    include: { business: true },
  })
  if (!appointment) {
    return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
  }
  if (isTerminalStatus(appointment.status)) {
    return NextResponse.json({ error: 'This appointment can no longer be changed.' }, { status: 409 })
  }

  if (action === 'cancel') {
    // Same business-configurable deadline the public token flow enforces
    // (Business.cancellationDeadlineHours; 0 = no deadline; default 2h).
    const deadlineHours = appointment.business.cancellationDeadlineHours ?? 2
    const hoursUntil = (appointment.startTime.getTime() - Date.now()) / 3600000
    if (hoursUntil <= 0) {
      return NextResponse.json({ error: 'This appointment can no longer be cancelled online.' }, { status: 409 })
    }
    if (deadlineHours > 0 && hoursUntil < deadlineHours) {
      return NextResponse.json(
        { error: `Appointments cannot be cancelled within ${deadlineHours} hour${deadlineHours === 1 ? '' : 's'} of the start time. Please call the shop directly.` },
        { status: 403 }
      )
    }

    // Atomic guard: only cancels if still active (no double-cancel races).
    const updated = await prisma.appointment.updateMany({
      where: {
        id: appointment.id,
        status: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] },
      },
      data: {
        status: 'CANCELLED',
        cancellationReason: 'Cancelled by customer (portal)',
      },
    })
    if (updated.count !== 1) {
      return NextResponse.json({ error: 'Appointment is no longer cancellable' }, { status: 409 })
    }

    try {
      await prisma.auditLog.create({
        data: {
          businessId: business.id,
          userId: session.user.id,
          action: 'APPOINTMENT_CANCELLED',
          entityType: 'Appointment',
          entityId: appointment.id,
          oldValues: { status: appointment.status },
          newValues: { status: 'CANCELLED' },
          description: `Customer cancelled appointment ${appointment.confirmationNumber} from the portal`,
          ipAddress: req.headers.get('x-forwarded-for'),
        },
      })
    } catch { /* non-critical */ }

    return NextResponse.json({ success: true, appointment: { id: appointment.id, status: 'CANCELLED' } })
  }

  if (action === 'reschedule') {
    const startTime = body?.startTime ? new Date(body.startTime) : null
    if (!startTime || Number.isNaN(startTime.getTime()) || startTime <= new Date()) {
      return NextResponse.json({ error: 'A valid future start time is required.' }, { status: 400 })
    }
    if (!appointment.business.customerRescheduleEnabled) {
      return NextResponse.json({ error: 'Online rescheduling is disabled. Please call the shop.' }, { status: 403 })
    }
    const hoursUntil = (appointment.startTime.getTime() - Date.now()) / 3600000
    if (hoursUntil < appointment.business.customerRescheduleMinNoticeHours) {
      return NextResponse.json({ error: 'Rescheduling is no longer available this close to your appointment.' }, { status: 403 })
    }
    if (appointment.business.customerRescheduleWindowDays && startTime.getTime() > Date.now() + appointment.business.customerRescheduleWindowDays * 86400000) {
      return NextResponse.json({ error: 'Choose a date within the rescheduling window.' }, { status: 400 })
    }

    const slot = await validateSlot({
      businessId: appointment.businessId,
      barberId: appointment.barberId,
      serviceId: appointment.serviceId,
      startTime,
      excludeAppointmentId: appointment.id,
    })
    if (!slot.valid) {
      return NextResponse.json(
        { error: slot.error === 'SLOT_TAKEN' ? 'That time is no longer available.' : "That time is outside the barber's availability." },
        { status: 409 }
      )
    }

    try {
      const updated = await prisma.$transaction(async tx => {
        const result = await tx.appointment.update({
          where: { id: appointment.id },
          data: { startTime, endTime: slot.endTime, status: 'CONFIRMED' },
        })
        await tx.rescheduleHistory.create({
          data: {
            businessId: appointment.businessId,
            appointmentId: appointment.id,
            previousStartTime: appointment.startTime,
            previousEndTime: appointment.endTime,
            newStartTime: startTime,
            newEndTime: slot.endTime!,
            actor: 'CUSTOMER',
          },
        })
        return result
      }, { isolationLevel: 'Serializable' })
      return NextResponse.json({ success: true, startTime: updated.startTime, endTime: updated.endTime })
    } catch (error) {
      if (error?.code === 'P2034' || error?.code === '23P01') {
        return NextResponse.json({ error: 'That time is no longer available. Please choose another time.' }, { status: 409 })
      }
      console.error('[portal reschedule] failed', error)
      return NextResponse.json({ error: 'Something went wrong while rescheduling. Please try again.' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rescheduleByTokenSchema } from '@/lib/validation'
import { validateSlot } from '@/lib/availability'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { isTerminalStatus } from '@/lib/validation'

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = checkRateLimit(req, 'public-reschedule', RATE_LIMITS.CUSTOMER_ACTION)
  if (limited) return NextResponse.json({ error: limited.body.error }, { status: limited.status })
  const { token } = await params
  if (!token || token.length < 32) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  const parsed = rescheduleByTokenSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'A valid start time is required' }, { status: 400 })
  const startTime = new Date(parsed.data.startTime)
  if (startTime <= new Date()) return NextResponse.json({ error: 'Choose a future time' }, { status: 400 })

  const appointment = await prisma.appointment.findUnique({ where: { customerAccessToken: token }, include: { business: true } })
  if (!appointment) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
  if (isTerminalStatus(appointment.status)) return NextResponse.json({ error: 'This appointment cannot be rescheduled' }, { status: 409 })
  if (!appointment.business.customerRescheduleEnabled) return NextResponse.json({ error: 'Online rescheduling is disabled. Please call the shop.' }, { status: 403 })
  const hoursUntil = (appointment.startTime.getTime() - Date.now()) / 3600000
  if (hoursUntil < appointment.business.customerRescheduleMinNoticeHours) return NextResponse.json({ error: 'Rescheduling is no longer available this close to your appointment.' }, { status: 403 })
  if (appointment.business.customerRescheduleWindowDays && startTime.getTime() > Date.now() + appointment.business.customerRescheduleWindowDays * 86400000) return NextResponse.json({ error: 'Choose a date within the rescheduling window.' }, { status: 400 })

  const slot = await validateSlot({ businessId: appointment.businessId, barberId: appointment.barberId, serviceId: appointment.serviceId, startTime, excludeAppointmentId: appointment.id })
  if (!slot.valid) return NextResponse.json({ error: slot.error === 'SLOT_TAKEN' ? 'That time is no longer available.' : 'That time is outside the barber\'s availability.' }, { status: 409 })

  try {
    const updated = await prisma.$transaction(async tx => {
      const result = await tx.appointment.update({ where: { id: appointment.id }, data: { startTime, endTime: slot.endTime, status: 'CONFIRMED' } })
      await tx.rescheduleHistory.create({ data: { businessId: appointment.businessId, appointmentId: appointment.id, previousStartTime: appointment.startTime, previousEndTime: appointment.endTime, newStartTime: startTime, newEndTime: slot.endTime!, actor: 'CUSTOMER' } })
      return result
    }, { isolationLevel: 'Serializable' })
    return NextResponse.json({ success: true, startTime: updated.startTime, endTime: updated.endTime })
  } catch (error) {
    if (error?.code === 'P2034' || error?.code === '23P01') {
      return NextResponse.json({ error: 'That time is no longer available. Please choose another time.' }, { status: 409 })
    }
    console.error('[reschedule] failed', error)
    return NextResponse.json({ error: 'Something went wrong while rescheduling. Please try again.' }, { status: 500 })
  }
}

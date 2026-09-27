import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createAppointmentSafely } from '@/lib/availability'
import { sendBookingConfirmation, scheduleAppointmentReminders } from '@/lib/notifications'
import { isPublicBusinessDeactivated } from '@/lib/tenant'

export async function POST(request: NextRequest) {
  try {
  // Soft-deactivated shops do not accept public activity
  if (await isPublicBusinessDeactivated()) {
    return NextResponse.json(
      { error: 'This shop is not accepting bookings right now.' },
      { status: 503 }
    )
  }
    const body = await request.json()
    const token = typeof body?.token === 'string' ? body.token : ''
    if (!token) return NextResponse.json({ success: false, error: 'A claim token is required' }, { status: 400 })

    const now = new Date()
    const offer = await prisma.waitlistEntry.findUnique({
      where: { claimToken: token },
      include: { customer: true, business: true },
    })
    if (!offer || !offer.offeredSlotStart || !offer.offeredSlotEnd || !offer.offeredBarberId) {
      return NextResponse.json({ success: false, error: 'This offer is invalid or no longer available' }, { status: 404 })
    }
    if (offer.expiresAt && offer.expiresAt <= now) {
      await prisma.waitlistEntry.updateMany({ where: { id: offer.id, status: 'NOTIFIED' }, data: { status: 'EXPIRED' } })
      return NextResponse.json({ success: false, error: 'This opening offer has expired' }, { status: 410 })
    }

    // Claim the offer before creating the appointment. The conditional update makes
    // simultaneous clicks first-wins, while the appointment helper guards the slot.
    const claimed = await prisma.waitlistEntry.updateMany({
      where: { id: offer.id, claimToken: token, status: 'NOTIFIED', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      data: { status: 'BOOKED' },
    })
    if (claimed.count !== 1) {
      return NextResponse.json({ success: false, error: 'This slot has already been claimed' }, { status: 409 })
    }

    const customer = offer.customer
    if (!customer) {
      await prisma.waitlistEntry.updateMany({ where: { id: offer.id, status: 'BOOKED' }, data: { status: 'NOTIFIED' } })
      return NextResponse.json({ success: false, error: 'Customer record is unavailable' }, { status: 422 })
    }

    const result = await createAppointmentSafely({
      businessId: offer.businessId,
      barberId: offer.offeredBarberId,
      serviceId: offer.serviceId,
      startTime: offer.offeredSlotStart,
      idempotencyKey: `waitlist-claim:${offer.id}`,
      customerData: {
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        email: customer.email,
        notes: customer.notes,
        smsConsent: customer.smsConsent,
      },
    })

    if (!result.success || !result.appointment) {
      await prisma.waitlistEntry.updateMany({ where: { id: offer.id, status: 'BOOKED' }, data: { status: 'NOTIFIED' } })
      const taken = result.error === 'SLOT_TAKEN' || result.error?.includes('taken')
      return NextResponse.json({ success: false, error: taken ? 'This slot has already been claimed' : 'This opening is no longer available' }, { status: 409 })
    }

    await prisma.waitlistEntry.updateMany({ where: { id: offer.id, status: 'BOOKED' }, data: { claimToken: null } })
    await prisma.waitlistEntry.updateMany({
      where: {
        businessId: offer.businessId,
        id: { not: offer.id },
        status: 'NOTIFIED',
        offeredSlotStart: offer.offeredSlotStart,
        offeredSlotEnd: offer.offeredSlotEnd,
      },
      data: { status: 'EXPIRED', claimToken: null },
    })

    const appointment = await prisma.appointment.findUnique({
      where: { id: result.appointment.id },
      include: { customer: true, barber: true, service: true, business: true },
    })
    if (appointment) {
      sendBookingConfirmation(appointment).catch((error) => console.error('Waitlist confirmation failed:', error))
      prisma.retentionSettings.findUnique({ where: { businessId: appointment.businessId } })
        .then((settings) => scheduleAppointmentReminders(appointment, settings || undefined))
        .catch((error) => console.error('Waitlist reminder scheduling failed:', error))
    }

    return NextResponse.json({ success: true, confirmationNumber: result.appointment.confirmationNumber, customerAccessToken: result.customerAccessToken })
  } catch (error) {
    console.error('Waitlist claim failed:', error)
    return NextResponse.json({ success: false, error: 'Unable to claim this opening' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token')
  if (!token) return NextResponse.json({ success: false, error: 'A claim token is required' }, { status: 400 })
  const offer = await prisma.waitlistEntry.findUnique({ where: { claimToken: token }, select: { id: true, status: true, expiresAt: true, offeredSlotStart: true, offeredSlotEnd: true } })
  if (!offer || offer.status !== 'NOTIFIED' || (offer.expiresAt && offer.expiresAt <= new Date())) {
    return NextResponse.json({ success: false, error: 'This offer is no longer available' }, { status: 410 })
  }
  return NextResponse.json({ success: true, offer })
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

void NextRequest

import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { sendWaitlistSlotNotification } from '@/lib/notifications'

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { customerId, barberId, serviceId, startTime, endTime } = body
  const slotStart = new Date(startTime)
  const slotEnd = new Date(endTime)
  if (!customerId || !barberId || !serviceId || Number.isNaN(slotStart.getTime()) || Number.isNaN(slotEnd.getTime()) || slotEnd <= slotStart) {
    return NextResponse.json({ error: 'Customer, barber, service, and valid slot times are required' }, { status: 400 })
  }

  const businessId = session.user.businessId
  const [customer, barber, service, conflictingAppointment] = await Promise.all([
    prisma.customer.findFirst({ where: { id: customerId, businessId } }),
    prisma.barber.findFirst({ where: { id: barberId, businessId } }),
    prisma.service.findFirst({ where: { id: serviceId, businessId } }),
    prisma.appointment.findFirst({
      where: { businessId, barberId, status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULED'] }, startTime: { lt: slotEnd }, endTime: { gt: slotStart } },
      select: { id: true },
    }),
  ])
  if (!customer || !barber || !service) return NextResponse.json({ error: 'Opening details are invalid' }, { status: 404 })
  if (conflictingAppointment) return NextResponse.json({ error: 'This opening is no longer available' }, { status: 409 })
  if (!customer.phone || !customer.smsConsent) return NextResponse.json({ error: 'Customer has not opted into SMS' }, { status: 422 })

  const claimToken = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
  const offer = await prisma.waitlistEntry.create({
    data: {
      businessId,
      customerId: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone,
      email: customer.email,
      barberId,
      serviceId,
      preferredDate: slotStart,
      status: 'NOTIFIED',
      notifiedAt: new Date(),
      expiresAt,
      claimToken,
      offeredSlotStart: slotStart,
      offeredSlotEnd: slotEnd,
      offeredBarberId: barberId,
    },
  })

  const claimUrl = `${new URL(request.url).origin}/waitlist/claim?token=${claimToken}`
  try {
    await sendWaitlistSlotNotification({
      businessId,
      entryId: offer.id,
      customer: { firstName: offer.firstName, lastName: offer.lastName, email: offer.email, phone: offer.phone },
      service: { name: service.name, duration: service.duration },
      barber: { name: barber.name },
      slotStart,
      slotEnd,
      claimToken,
      claimUrl,
      business: { name: session.user.businessName, phone: null, email: null },
    })
  } catch (error) {
    console.error('Opening offer notification failed:', error)
  }

  return NextResponse.json({ success: true, offerId: offer.id, expiresAt })
}

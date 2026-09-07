export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaff } from '@/lib/auth-helpers'
import { getBusinessIdForUser } from '@/lib/auth-helpers'
import { createAppointmentSafely } from '@/lib/availability'
import { createManualAppointmentSchema } from '@/lib/validation'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { localTimeToUTCFromYMD } from '@/lib/timezone'

export async function GET(req: NextRequest) {
  // Require authentication
  const auth = await requireStaff({ restrictToOwnBarber: true })
  if (!auth.success) return auth.response

  const user = auth.user
  const isBarber = user.role === 'BARBER'
  const sessionBarberId = user.barberId

  try {
    const businessId = await getBusinessIdForUser(user)

    const searchParams = req.nextUrl.searchParams
    const dateParam = searchParams.get('date')
    const fromParam = searchParams.get('from')
    const toParam = searchParams.get('to')
    const barberIdParam = searchParams.get('barberId')
    const statusParam = searchParams.get('status')
    const searchParam = searchParams.get('search')

    const where: any = { businessId }

    // ROLE ENFORCEMENT: Barbers can only see their own appointments
    if (isBarber && sessionBarberId) {
      where.barberId = sessionBarberId
    } else if (barberIdParam) {
      // Owner can filter by any barber
      where.barberId = barberIdParam
    }

    if (statusParam) {
      where.status = statusParam
    }

    if (dateParam) {
      const d = new Date(dateParam)
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)
      const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0)
      where.startTime = { gte: dayStart, lt: dayEnd }
    } else if (fromParam || toParam) {
      where.startTime = {}
      if (fromParam) where.startTime.gte = new Date(fromParam)
      if (toParam) where.startTime.lte = new Date(toParam)
    }

    if (searchParam) {
      where.OR = [
        { confirmationNumber: { contains: searchParam, mode: 'insensitive' } },
        { customer: { firstName: { contains: searchParam, mode: 'insensitive' } } },
        { customer: { lastName: { contains: searchParam, mode: 'insensitive' } } },
        { customer: { phone: { contains: searchParam, mode: 'insensitive' } } },
        { customer: { email: { contains: searchParam, mode: 'insensitive' } } },
      ]
    }

    const appointments = await prisma.appointment.findMany({
      where,
      include: {
        customer: true,
        barber: true,
        service: true,
        intakeResponses: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { startTime: 'asc' },
    })

    return NextResponse.json(appointments)
  } catch (error: any) {
    console.error('[appointments] request failed', error)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // Require authentication (OWNER or BARBER)
  const auth = await requireStaff({ restrictToOwnBarber: true })
  if (!auth.success) return auth.response

  const user = auth.user

  // Rate limit
  const rl = checkRateLimit(req, 'dashboard-appt-create', RATE_LIMITS.DASHBOARD)
  if (rl) return NextResponse.json({ error: rl.body.error }, { status: rl.status })

  try {
    const businessId = await getBusinessIdForUser(user)

    const body = await req.json()

    // Validate with Zod
    const parseResult = createManualAppointmentSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid appointment data', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { customerId, customerData, barberId, serviceId, date, time, notes } = parseResult.data

    // ROLE ENFORCEMENT: Barbers can only create appointments for themselves
    if (user.role === 'BARBER' && user.barberId && barberId !== user.barberId) {
      return NextResponse.json(
        { error: 'Barbers can only create appointments for themselves' },
        { status: 403 }
      )
    }

    // Verify barber belongs to this business
    const barber = await prisma.barber.findFirst({
      where: { id: barberId, businessId, isActive: true },
    })
    if (!barber) {
      return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
    }

    let targetCustomerData = customerData

    if (!targetCustomerData && customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, businessId },
      })
      if (!customer) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      }
      targetCustomerData = {
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        email: customer.email,
        notes: notes || customer.notes || undefined,
        smsConsent: customer.smsConsent,
      }
    }

    if (!targetCustomerData?.firstName || !targetCustomerData?.email || !targetCustomerData?.phone) {
      return NextResponse.json({ error: 'Customer details (name, email, phone) are required' }, { status: 400 })
    }

    // Interpret the entered date/time in the business timezone before storing UTC.
    const [year, month, day] = date.split('-').map(Number)
    const timezoneBusiness = await prisma.business.findUnique({ where: { id: businessId }, select: { timezone: true } })
    const timezone = timezoneBusiness?.timezone || 'America/New_York'
    const startTime = localTimeToUTCFromYMD(time, year, month, day, timezone)

    if (isNaN(startTime.getTime())) {
      return NextResponse.json({ error: 'Invalid date or time' }, { status: 400 })
    }

    const result = await createAppointmentSafely({
      businessId,
      barberId,
      serviceId,
      startTime,
      customerData: {
        firstName: targetCustomerData.firstName,
        lastName: targetCustomerData.lastName,
        phone: targetCustomerData.phone,
        email: targetCustomerData.email,
        notes: notes || targetCustomerData.notes || '',
        smsConsent: targetCustomerData.smsConsent ?? false,
      },
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // Update createdBy to MANUAL
    if (result.appointment?.id) {
      await prisma.appointment.update({
        where: { id: result.appointment.id },
        data: { createdBy: 'MANUAL' },
      })
    }

    return NextResponse.json(result.appointment, { status: 201 })
  } catch (error: any) {
    console.error('[appointments] request failed', error)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

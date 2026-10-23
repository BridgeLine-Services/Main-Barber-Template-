export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaff } from '@/lib/auth-helpers'
import { getBusinessIdForUser } from '@/lib/auth-helpers'
import { createAppointmentSafely } from '@/lib/availability'
import { createManualAppointmentSchema } from '@/lib/validation'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { localTimeToUTCFromYMD, resolveBusinessTimezone, dayBoundsFromYMD } from '@/lib/timezone'
import { handleApiError } from '@/lib/api-errors'
import type { Prisma } from '@prisma/client'
import { AppointmentStatus } from '@prisma/client'

export async function GET(req: NextRequest) {
  try {
    // Require authentication
    const auth = await requireStaff({ restrictToOwnBarber: true })
    if (!auth.success) return auth.response
    const user = auth.user
    const isBarber = user.role === 'BARBER'
    const sessionBarberId = user.barberId
    try {
      const businessId = await getBusinessIdForUser(user)
      // Timezone for calendar day/range queries (business calendar days)
      const tzBusiness = await prisma.business.findUnique({
        where: { id: businessId },
        select: { timezone: true },
      })
      const timezoneForQuery = resolveBusinessTimezone(tzBusiness)
      const searchParams = req.nextUrl.searchParams
      const dateParam = searchParams.get('date')
      const fromParam = searchParams.get('from')
      const toParam = searchParams.get('to')
      const barberIdParam = searchParams.get('barberId')
      const statusParam = searchParams.get('status')
      const searchParam = searchParams.get('search')
      const where: Prisma.AppointmentWhereInput = { businessId }
      // ROLE ENFORCEMENT: Barbers can only see their own appointments
      if (isBarber && sessionBarberId) {
        where.barberId = sessionBarberId
      } else if (barberIdParam) {
        // Owner can filter by any barber
        where.barberId = barberIdParam
      }
      if (statusParam) {
        const s = statusParam.toUpperCase() as AppointmentStatus
        if (Object.values(AppointmentStatus).includes(s)) where.status = s
      }
      // Day/range filters are interpreted in the BUSINESS timezone — the
      // same zone the shop's calendar days live in. Parsing YMD strings via
      // `new Date(str)` would anchor them to UTC midnight and silently shift
      // the day in every non-UTC timezone.
      const ymdPattern = /^\d{4}-\d{2}-\d{2}$/
      const ymdBounds = (ymd: string) => {
        const [y, m, d] = ymd.split('-').map(Number)
        return dayBoundsFromYMD(timezoneForQuery, y, m, d)
      }
      if (dateParam && ymdPattern.test(dateParam)) {
        const bounds = ymdBounds(dateParam)
        where.startTime = { gte: bounds.start, lte: bounds.end }
      } else if (fromParam || toParam) {
        where.startTime = {}
        if (fromParam && ymdPattern.test(fromParam)) {
          where.startTime.gte = ymdBounds(fromParam).start
        } else if (fromParam) {
          where.startTime.gte = new Date(fromParam)
        }
        if (toParam && ymdPattern.test(toParam)) {
          where.startTime.lte = ymdBounds(toParam).end
        } else if (toParam) {
          where.startTime.lte = new Date(toParam)
        }
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
        // Field-checked performance fix (Requirement 31): return only the
        // relation fields the dashboard actually renders (verified across
        // AppointmentsListView, AppointmentDetailsDialog, calendar and
        // barber-mode pages) instead of full customer/barber/service rows.
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
          barber: { select: { id: true, name: true, specialty: true } },
          service: { select: { id: true, name: true, price: true, duration: true } },
          intakeResponses: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, questionKey: true, questionLabel: true, answer: true },
          },
        },
        orderBy: { startTime: 'asc' },
      })
      // Include the business timezone so the dashboard calendar can bucket and
      // format appointments in the zone the shop actually operates in.
      return NextResponse.json({ appointments, timezone: timezoneForQuery })
    } catch (error) {
      console.error('[appointments] request failed', error)
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/appointments')
  }
}

export async function POST(req: NextRequest) {
  try {
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
      const timezone = resolveBusinessTimezone(timezoneBusiness)
      const startTime = localTimeToUTCFromYMD(time, year, month, day, timezone)
      if (isNaN(startTime.getTime())) {
        return NextResponse.json({ error: 'Invalid date or time' }, { status: 400 })
      }
      const result = await createAppointmentSafely({
        businessId,
        barberId,
        serviceId,
        startTime,
        // Staff-side manual entry: walk-ins start "now", so the customer
        // advance-notice rule is waived (double-booking still enforced).
        staffManual: true,
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
    } catch (error) {
      console.error('[appointments] request failed', error)
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/appointments')
  }
}

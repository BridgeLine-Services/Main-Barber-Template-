export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveBusinessId } from '@/lib/tenant'
import { createAppointmentSafely, getAvailableSlots } from '@/lib/availability'
import { sendBookingConfirmation, scheduleAppointmentReminders } from '@/lib/notifications'
import { createBookingSchema } from '@/lib/validation'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { localTimeToUTCFromYMD, dayOfWeekFromYMD } from '@/lib/timezone'

// Cache business timezone lookups within a request
async function getBusinessTimezone(businessId: string): Promise<string> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { timezone: true },
  })
  return business?.timezone || 'America/New_York'
}

/**
 * Parse a date string (YYYY-MM-DD) and time string (HH:mm or "h:mm AM/PM")
 * into a UTC Date using the BUSINESS TIMEZONE, not the server's local timezone.
 *
 * CRITICAL: On Vercel (UTC), new Date(year, month-1, day, hours, minutes) would
 * interpret the time in UTC, not in the business's timezone. For a California
 * barber shop, 9:00 AM would become 9:00 UTC (2:00 AM PDT) — off by 7 hours.
 *
 * This function uses Luxon to construct the instant directly in the business
 * timezone, then converts to UTC for database storage.
 */
async function parseStartTime(
  dateStr: string,
  timeStr: string,
  businessId: string
): Promise<Date> {
  const [year, month, day] = dateStr.split('-').map(Number)
  let hours = 0
  let minutes = 0

  const ampmMatch = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (ampmMatch) {
    hours = parseInt(ampmMatch[1], 10)
    minutes = parseInt(ampmMatch[2], 10)
    const period = ampmMatch[3].toUpperCase()
    if (period === 'PM' && hours < 12) hours += 12
    if (period === 'AM' && hours === 12) hours = 0
  } else {
    const parts = timeStr.split(':')
    hours = parseInt(parts[0], 10) || 0
    minutes = parseInt(parts[1], 10) || 0
  }

  // Use business timezone to construct the instant — NOT server-local time
  const timezone = await getBusinessTimezone(businessId)
  const timeStr24h = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
  return localTimeToUTCFromYMD(timeStr24h, year, month, day, timezone)
}

export async function POST(req: NextRequest) {
  // Rate limit booking creation
  const rateLimitResult = checkRateLimit(req, 'public-booking', RATE_LIMITS.BOOKING)
  if (rateLimitResult) {
    return NextResponse.json(
      { success: false, error: rateLimitResult.body.error },
      { status: rateLimitResult.status }
    )
  }

  try {
    const body = await req.json()

    // Idempotency: if the client sends the same request twice (double-click),
    // the second one is rejected. Use a hash of the booking data.
    // Validate request body with Zod
    const parseResult = createBookingSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid booking data',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { barberId: reqBarberId, serviceId, date, time, customer } = parseResult.data
    const idempotencyKey = parseResult.data.idempotencyKey ||
      `${reqBarberId || 'any'}-${serviceId}-${date}-${time}-${customer.email}`

    const businessId = await resolveBusinessId()
    const businessPolicies = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        updatedAt: true,
        bookingPolicy: true,
        cancellationPolicy: true,
        latePolicy: true,
        noShowPolicyText: true,
      },
    })
    const policiesRequired = Boolean(
      businessPolicies?.bookingPolicy || businessPolicies?.cancellationPolicy ||
      businessPolicies?.latePolicy || businessPolicies?.noShowPolicyText
    )
    if (policiesRequired && !parseResult.data.policiesAcceptedAt) {
      return NextResponse.json(
        { success: false, error: 'Please acknowledge the booking policies before confirming your appointment.' },
        { status: 400 }
      )
    }
    const startTime = await parseStartTime(date, time, businessId)

    // Cannot book in the past
    if (startTime < new Date()) {
      return NextResponse.json(
        { success: false, error: 'Cannot book an appointment in the past' },
        { status: 400 }
      )
    }

    let targetBarberId = reqBarberId

    // If barberId is 'any', find a barber who is available at startTime
    if (!targetBarberId || targetBarberId === 'any' || targetBarberId === 'first-available') {
      const activeBarbers = await prisma.barber.findMany({
        where: { businessId, isActive: true },
        include: { services: true },
        orderBy: { order: 'asc' },
      })

      // Use timezone-aware date object for availability check
      const [year, month, day] = date.split('-').map(Number)
      const timezone = await getBusinessTimezone(businessId)
      const dateObj = new Date(localTimeToUTCFromYMD('00:00', year, month, day, timezone))
      const dateStr = date // YYYY-MM-DD — passed for timezone accuracy

      for (const barber of activeBarbers) {
        // Check if barber offers service
        if (barber.services.length > 0 && !barber.services.some((s) => s.serviceId === serviceId)) {
          continue
        }
        const slots = await getAvailableSlots({
          businessId,
          barberId: barber.id,
          serviceId,
          date: dateObj,
          dateStr,
        })
        const matchingSlot = slots.find((s) => s.time === time && s.available)
        if (matchingSlot) {
          targetBarberId = barber.id
          break
        }
      }

      if (!targetBarberId || targetBarberId === 'any' || targetBarberId === 'first-available') {
        // Fallback to first active barber offering service
        const firstMatching = activeBarbers.find(
          (b) => b.services.length === 0 || b.services.some((s) => s.serviceId === serviceId)
        )
        if (firstMatching) {
          targetBarberId = firstMatching.id
        } else if (activeBarbers.length > 0) {
          targetBarberId = activeBarbers[0].id
        } else {
          return NextResponse.json(
            { success: false, error: 'No active barbers available for this service' },
            { status: 400 }
          )
        }
      }
    }

    const result = await createAppointmentSafely({
      businessId,
      barberId: targetBarberId!,
      serviceId,
      startTime,
      idempotencyKey,
      customerData: {
        ...customer,
        policiesAcceptedAt: parseResult.data.policiesAcceptedAt ? new Date(parseResult.data.policiesAcceptedAt) : null,
        policyVersion: policiesRequired ? (businessPolicies?.updatedAt.toISOString() ?? null) : null,
      },
    })

    if (!result.success || !result.appointment) {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to book appointment' },
        { status: 409 }
      )
    }

    // Fetch full appointment with relations for notification
    const fullAppointment = await prisma.appointment.findUnique({
      where: { id: result.appointment.id },
      include: {
        customer: true,
        barber: true,
        service: true,
        business: true,
      },
    })

    if (fullAppointment) {
      // Send confirmation email/SMS (non-blocking — booking already succeeded)
      sendBookingConfirmation(fullAppointment).catch((err) => {
        console.error('Failed to send booking confirmation:', err)
      })
      prisma.retentionSettings.findUnique({ where: { businessId: fullAppointment.businessId } })
        .then((settings) => scheduleAppointmentReminders(fullAppointment, settings || undefined))
        .catch((err) => console.error('Failed to schedule appointment reminders:', err))
    }

    return NextResponse.json({
      success: true,
      confirmationNumber: result.appointment?.confirmationNumber,
      customerAccessToken: result.customerAccessToken,
    })
  } catch (error: any) {
    console.error('Booking error:', error)

    // Database not available — reject booking
    if (error?.message?.includes('No business found') || error?.code === 'P1001') {
      return NextResponse.json(
        { success: false, error: 'Booking service is currently unavailable. Please try again later.' },
        { status: 503 }
      )
    }

    return NextResponse.json(
      { success: false, error: 'An error occurred while booking. Please try again.' },
      { status: 500 }
    )
  }
}

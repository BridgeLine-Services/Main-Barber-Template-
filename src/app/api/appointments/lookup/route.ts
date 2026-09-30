export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { lookupAppointmentSchema } from '@/lib/validation'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * GET /api/appointments/lookup?confirmationNumber=BRB-XXXXXX
 *
 * Returns a MINIMIZED response — just enough for the customer to identify
 * their appointment and get a management URL with their secure token.
 *
 * Does NOT return: full email, phone, customer notes, internal IDs, or
 * database metadata.
 */
export async function GET(req: NextRequest) {
  // Rate limit heavily — 5 per minute per IP to prevent brute-force
  const rateLimitResult = checkRateLimit(req, 'lookup', RATE_LIMITS.LOOKUP)
  if (rateLimitResult) {
    return NextResponse.json(
      { error: 'Too many lookup attempts. Please try again in a minute.' },
      { status: rateLimitResult.status }
    )
  }

  try {
    const { searchParams } = req.nextUrl
    const confirmationNumber = searchParams.get('confirmationNumber')

    const parseResult = lookupAppointmentSchema.safeParse({ confirmationNumber })
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid confirmation number format' },
        { status: 400 }
      )
    }

    const appointment = await prisma.appointment.findUnique({
      where: {
        confirmationNumber: parseResult.data.confirmationNumber.trim().toUpperCase(),
      },
      include: {
        barber: true,
        service: true,
        business: true,
      },
    })

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    // Return MINIMIZED data — no PII, no internal IDs
    // The management URL contains the customerAccessToken so the customer
    // can view/cancel/reschedule securely
    return NextResponse.json({
      appointment: {
        confirmationNumber: appointment.confirmationNumber,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        status: appointment.status,
        service: {
          name: appointment.service?.name,
          duration: appointment.service?.duration,
        },
        barber: {
          name: appointment.barber?.name,
        },
        business: {
          name: appointment.business?.name,
          phone: appointment.business?.phone,
        },
        // Secure management URL — contains the access token
        managementUrl: `/appointment/${appointment.confirmationNumber}?token=${appointment.customerAccessToken}`,
      },
    })
  } catch (error) {
    console.error('Error looking up appointment:', error)
    return NextResponse.json({ error: 'Failed to lookup appointment' }, { status: 500 })
  }
}

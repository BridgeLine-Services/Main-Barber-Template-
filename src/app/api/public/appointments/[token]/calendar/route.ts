export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import {
  generateIcsForToken,
  CalendarAppointment,
} from '@/lib/calendar-export'

/**
 * GET /api/public/appointments/[token]/calendar
 * Download a standards-compliant .ics file for the appointment authorized
 * by the customer's access token — the same mechanism as the public
 * appointment, reschedule, and cancel routes. Never addressable by
 * internal ID.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  // Rate limit to prevent brute-force, consistent with the other token routes
  const rateLimitResult = checkRateLimit(req, 'public-view', RATE_LIMITS.CUSTOMER_ACTION)
  if (rateLimitResult) {
    return NextResponse.json(
      { error: rateLimitResult.body.error },
      { status: rateLimitResult.status }
    )
  }

  const result = await generateIcsForToken(params.token, async (token) => {
    const appointment = await prisma.appointment.findUnique({
      where: { customerAccessToken: token },
      include: {
        barber: { select: { name: true } },
        service: { select: { name: true } },
        business: {
          select: {
            name: true,
            address: true,
            city: true,
            state: true,
            zipCode: true,
            phone: true,
            timezone: true,
          },
        },
      },
    })
    if (!appointment) return null

    const record: CalendarAppointment = {
      confirmationNumber: appointment.confirmationNumber,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      status: appointment.status,
      service: appointment.service,
      barber: appointment.barber,
      business: appointment.business,
    }
    return record
  })

  if (result.ok === false) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return new NextResponse(result.ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

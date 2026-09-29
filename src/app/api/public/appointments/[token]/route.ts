export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * GET /api/public/appointments/[token]
 * Fetch appointment details using the customer's secure access token.
 * This is the customer's "authentication" — no login required.
 *
 * Returns MINIMIZED data — no internal IDs, no full email/phone unless needed.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  // Rate limit to prevent brute-force
  const rateLimitResult = checkRateLimit(req, 'public-view', RATE_LIMITS.CUSTOMER_ACTION)
  if (rateLimitResult) {
    return NextResponse.json(
      { error: rateLimitResult.body.error },
      { status: rateLimitResult.status }
    )
  }

  try {
    const { token } = params

    if (!token || token.length < 32) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    }

    const appointment = await prisma.appointment.findUnique({
      where: { customerAccessToken: token },
      include: {
        barber: true,
        service: true,
        business: true,
      },
    })

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    // Return MINIMIZED response — no internal IDs, no customer notes,
    // no full PII. Just what the customer needs to see their appointment.
    return NextResponse.json({
      appointment: {
        confirmationNumber: appointment.confirmationNumber,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        status: appointment.status,
        service: {
          name: appointment.service?.name,
          duration: appointment.service?.duration,
          price: appointment.service?.price,
        },
        barber: {
          name: appointment.barber?.name,
        },
        business: {
          name: appointment.business?.name,
          phone: appointment.business?.phone,
          address: appointment.business?.address,
        },
      },
    })
  } catch (error: any) {
    console.error('Error fetching appointment by token:', error)
    return NextResponse.json({ error: 'Failed to fetch appointment' }, { status: 500 })
  }
}

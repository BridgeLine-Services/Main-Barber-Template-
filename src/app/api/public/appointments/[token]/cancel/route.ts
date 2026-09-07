export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cancelByTokenSchema } from '@/lib/validation'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { isTerminalStatus } from '@/lib/validation'

/**
 * POST /api/public/appointments/[token]/cancel
 * Cancel an appointment using the customer's secure access token.
 * No login required — the token IS the authorization.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  // Rate limit
  const rateLimitResult = checkRateLimit(req, 'public-cancel', RATE_LIMITS.CUSTOMER_ACTION)
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

    // Parse body (optional reason)
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      // Empty body is fine
    }

    const parseResult = cancelByTokenSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const appointment = await prisma.appointment.findUnique({
      where: { customerAccessToken: token },
    })

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    // Check if already cancelled or terminal
    if (isTerminalStatus(appointment.status)) {
      return NextResponse.json(
        { error: `Appointment is already ${appointment.status.toLowerCase()}` },
        { status: 409 }
      )
    }

    // Cancellation time rules
    const now = new Date()
    const apptTime = new Date(appointment.startTime)

    // Cannot cancel past appointments
    if (apptTime < now) {
      return NextResponse.json(
        { error: 'Cannot cancel past appointments. Please call the shop if you need assistance.' },
        { status: 403 }
      )
    }

    // Cannot cancel within 2 hours of start time
    const hoursUntilAppt = (apptTime.getTime() - now.getTime()) / (1000 * 60 * 60)
    if (hoursUntilAppt < 2) {
      return NextResponse.json(
        { error: 'Appointments cannot be cancelled within 2 hours of the start time. Please call the shop directly.' },
        { status: 403 }
      )
    }

    // Atomically cancel only if the appointment is still active. This prevents
    // concurrent cancellation requests from both reporting success.
    const updated = await prisma.appointment.updateMany({
      where: {
        id: appointment.id,
        status: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] },
      },
      data: {
        status: 'CANCELLED',
        cancellationReason: parseResult.data.reason || 'Cancelled by customer',
      },
    })

    if (updated.count !== 1) {
      return NextResponse.json({ error: 'Appointment is no longer cancellable' }, { status: 409 })
    }

    return NextResponse.json({
      success: true,
      status: 'CANCELLED',
      confirmationNumber: appointment.confirmationNumber,
    })
  } catch (error: any) {
    console.error('Error cancelling appointment by token:', error)

    // Database not connected
    if (error.message?.includes('No business found') || error.code === 'P1001' || error.message?.includes('prisma') || error.message?.includes('connect')) {
      return NextResponse.json({
        error: 'Database connection error. Please try again.',
      }, { status: 503 })
    }

    return NextResponse.json({ error: 'Failed to cancel appointment' }, { status: 500 })
  }
}

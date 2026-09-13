export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { resolveBusinessId } from '@/lib/tenant'
import { prisma } from '@/lib/prisma'
import { getEarliestAvailableSlot } from '@/lib/availability'
import { format } from 'date-fns'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * GET /api/availability/earliest?serviceId=<id>
 *
 * Searches the next 30 days for the earliest available slot across all
 * active barbers offering the given service. Returns:
 *   { date, time, barberId, barberName }  – earliest slot found
 *   { earliest: null }                     – nothing available in the window
 *
 * No demo fallback — requires a configured business and database.
 */
export async function GET(req: NextRequest) {
  const rateLimitResult = checkRateLimit(req, 'availability-earliest', RATE_LIMITS.AVAILABILITY)
  if (rateLimitResult) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again in a moment.' },
      { status: rateLimitResult.status }
    )
  }

  try {
    const { searchParams } = req.nextUrl
    const serviceId = searchParams.get('serviceId')

    if (!serviceId) {
      return NextResponse.json(
        { error: 'Missing required parameter: serviceId' },
        { status: 400 }
      )
    }

    const businessId = await resolveBusinessId()

    // Owner toggle: when "First available" is disabled for this business,
    // fail closed — never return earliest-slot suggestions, even if called
    // directly (the customer UI also hides the option).
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { firstAvailableBookingEnabled: true },
    })
    if (business && business.firstAvailableBookingEnabled === false) {
      return NextResponse.json({ earliest: null })
    }

    // Search the next 30 days starting from today
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    for (let i = 0; i < 30; i++) {
      const date = new Date(today)
      date.setDate(date.getDate() + i)
      const dateStr = format(date, 'yyyy-MM-dd')

      const { earliest } = await getEarliestAvailableSlot({
        businessId,
        serviceId,
        date,
        dateStr,
      })

      if (earliest) {
        return NextResponse.json({
          date: dateStr,
          time: earliest.time,
          barberId: earliest.barberId,
          barberName: earliest.barberName,
        })
      }
    }

    return NextResponse.json({ earliest: null })
  } catch (error: any) {
    console.error('Earliest availability error:', error)
    return NextResponse.json(
      { error: 'Availability is temporarily unavailable. Please try again.' },
      { status: 500 }
    )
  }
}

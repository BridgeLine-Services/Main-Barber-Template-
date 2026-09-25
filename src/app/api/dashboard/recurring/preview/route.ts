export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { previewRecurringAppointments, RecurringInterval } from '@/lib/recurring'
import { handleApiError } from '@/lib/api-errors'

// POST /api/dashboard/recurring/preview
// Previews a recurring appointment series with conflict detection
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const body = await req.json()
    const { barberId, serviceId, startDate, intervalWeeks, totalOccurrences, preferredTime } = body
    if (!barberId || !serviceId || !startDate) {
      return NextResponse.json({ error: 'Missing required fields: barberId, serviceId, startDate' }, { status: 400 })
    }
    const validIntervals = [2, 3, 4]
    if (!validIntervals.includes(intervalWeeks)) {
      return NextResponse.json({ error: 'Interval must be 2, 3, or 4 weeks' }, { status: 400 })
    }
    const maxOccurrences = 12
    const occurrences = Math.min(totalOccurrences || 6, maxOccurrences)
    const preview = await previewRecurringAppointments({
      businessId,
      barberId,
      serviceId,
      startDate: new Date(startDate),
      intervalWeeks: intervalWeeks as RecurringInterval,
      totalOccurrences: occurrences,
      preferredTime,
    })
    return NextResponse.json(preview)
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/recurring/preview')
  }
}

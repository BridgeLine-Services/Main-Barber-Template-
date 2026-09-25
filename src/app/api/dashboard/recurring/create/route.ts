export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createRecurringAppointments, RecurringInterval } from '@/lib/recurring'
import { handleApiError } from '@/lib/api-errors'

// POST /api/dashboard/recurring/create
// Creates a recurring appointment series (only for available occurrences)
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const userId = (session.user as any)?.id
    const body = await req.json()
    const {
      barberId,
      serviceId,
      startDate,
      intervalWeeks,
      totalOccurrences,
      preferredTime,
      customerData,
    } = body
    if (!barberId || !serviceId || !startDate || !preferredTime || !customerData) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (!customerData.firstName || !customerData.lastName || !customerData.phone || !customerData.email) {
      return NextResponse.json({ error: 'Missing customer information' }, { status: 400 })
    }
    const validIntervals = [2, 3, 4]
    if (!validIntervals.includes(intervalWeeks)) {
      return NextResponse.json({ error: 'Interval must be 2, 3, or 4 weeks' }, { status: 400 })
    }
    const maxOccurrences = 12
    const occurrences = Math.min(totalOccurrences || 6, maxOccurrences)
    const result = await createRecurringAppointments({
      businessId,
      barberId,
      serviceId,
      startDate: new Date(startDate),
      intervalWeeks: intervalWeeks as RecurringInterval,
      totalOccurrences: occurrences,
      preferredTime,
      customerData,
      createdBy: userId,
    })
    return NextResponse.json({
      success: true,
      createdCount: result.created.length,
      conflictCount: result.conflicts.length,
      created: result.created.map((a) => ({
        id: a.id,
        confirmationNumber: a.confirmationNumber,
        startTime: a.startTime,
      })),
      conflicts: result.conflicts,
    })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/recurring/create')
  }
}

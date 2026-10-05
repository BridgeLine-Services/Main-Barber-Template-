/**
 * Live status board (owner; read-only for explicitly authorized barbers).
 *
 * GET /api/dashboard/time-clock/status
 *
 * Owner/platform owner: full board — every barber's state (IN / BREAK /
 * OUT), since when, and today's hours. A BARBER gets this only when the
 * owner set canViewTeamRecords on their access row ("barbers cannot view
 * other barbers' hours unless explicitly authorized"); otherwise 403.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTimeClockSettings, getBarberAccess, buildStatusBoard } from '@/lib/time-clock'

export async function GET() {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    const user = auth.user
    if (!user.businessId) {
      return NextResponse.json({ error: 'Business required' }, { status: 403 })
    }
    const isOwner = user.role === 'OWNER' || user.role === 'PLATFORM_OWNER'
    if (!isOwner) {
      if (user.role !== 'BARBER' || !user.barberId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const access = await getBarberAccess(user.businessId, user.barberId)
      if (!access.canViewTeamRecords) {
        return NextResponse.json({ error: 'Not authorized to view team time records' }, { status: 403 })
      }
    }

    const settings = await getTimeClockSettings(user.businessId)
    if (!settings.enabled) {
      return NextResponse.json({ error: 'Time clock is off' }, { status: 400 })
    }
    const business = await prisma.business.findUnique({
      where: { id: user.businessId },
      select: { timezone: true },
    })
    const board = await buildStatusBoard(user.businessId, business?.timezone ?? 'UTC', new Date())
    return NextResponse.json({ board, settings })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/time-clock/status')
  }
}

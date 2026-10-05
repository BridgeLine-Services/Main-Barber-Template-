/**
 * Barber self-service break API.
 *
 * POST /api/dashboard/time-clock/break { action: 'start' | 'end' }
 *
 * One open break per shift: starting a second → 409 (app check plus a
 * database partial unique index, so a crashed client racing two starts
 * still cannot produce overlapping breaks). Ending with no running
 * break → 409. Break minutes fold into the shift's unpaid time and are
 * deducted from worked hours.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireAuth } from '@/lib/auth-helpers'
import { startBreak, endBreak, TimeClockError } from '@/lib/time-clock'

export async function POST(request: Request) {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    const user = auth.user
    if (user.role !== 'BARBER' || !user.barberId || !user.businessId) {
      return NextResponse.json({ error: 'Barber account required' }, { status: 403 })
    }
    const body = (await request.json()) as { action?: string }
    if (body.action !== 'start' && body.action !== 'end') {
      return NextResponse.json({ error: "action must be 'start' or 'end'" }, { status: 400 })
    }

    try {
      const entry =
        body.action === 'start'
          ? await startBreak(user.businessId, user.barberId, new Date())
          : await endBreak(user.businessId, user.barberId, new Date())
      return NextResponse.json({ entry })
    } catch (e) {
      if (e instanceof TimeClockError) {
        const status = e.code === 'TIME_CLOCK_DISABLED' ? 400 : 409
        return NextResponse.json({ error: e.message, code: e.code }, { status })
      }
      throw e
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/time-clock/break')
  }
}

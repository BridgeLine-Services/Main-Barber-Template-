/**
 * Barber self-service clock API.
 *
 * POST /api/dashboard/time-clock/clock { action: 'in' | 'out' }
 *
 * Session-only identity: barberId always comes from the session, never
 * the body. Every transition validates shop state server-side:
 *   - owner master switch OFF → 400 (barber cannot override the owner)
 *   - owner-excluded barber  → 403
 *   - duplicate clock-in     → 409 (one open shift per barber)
 *   - clock-out while out    → 409
 *
 * No AuditLog entry is written for punches — the TimeClockEntry row IS
 * the record; the audit trail covers owner decisions (settings, access,
 * corrections) instead.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireAuth } from '@/lib/auth-helpers'
import { clockIn, clockOut, TimeClockError } from '@/lib/time-clock'

export async function POST(request: Request) {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    const user = auth.user
    if (user.role !== 'BARBER' || !user.barberId || !user.businessId) {
      return NextResponse.json({ error: 'Barber account required' }, { status: 403 })
    }
    const body = (await request.json()) as { action?: string }
    if (body.action !== 'in' && body.action !== 'out') {
      return NextResponse.json({ error: "action must be 'in' or 'out'" }, { status: 400 })
    }

    try {
      const entry =
        body.action === 'in'
          ? await clockIn(user.businessId, user.barberId, new Date())
          : await clockOut(user.businessId, user.barberId, new Date())
      return NextResponse.json({ entry })
    } catch (e) {
      if (e instanceof TimeClockError) {
        const status =
          e.code === 'TIME_CLOCK_DISABLED' ? 400 : e.code === 'BARBER_NOT_ELIGIBLE' ? 403 : 409
        return NextResponse.json({ error: e.message, code: e.code }, { status })
      }
      throw e
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/time-clock/clock')
  }
}

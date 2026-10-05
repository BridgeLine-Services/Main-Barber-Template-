/**
 * Payroll-ready CSV export (owner-only).
 *
 * GET /api/dashboard/time-clock/export?preset=...&from=&to=&barberId=
 *
 * Columns: Barber, Date, Clock In, Break Start, Break End, Clock Out,
 * Regular Hours, Overtime Hours, Total Hours. One CLOSED shift per row —
 * open shifts (no clock-out yet) are excluded until closed or corrected.
 * Multi-break shifts export the first break start / last break end; all
 * closed break minutes are already deducted from the hour columns.
 * Per-row overtime uses the DAILY rule; weekly overtime appears in the
 * dashboard aggregates. This produces DATA ONLY — it never creates
 * payroll payments.
 */
import { handleApiError } from '@/lib/api-errors'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTimeClockSettings, timeClockRange, timeClockCsv, canManageTimeClock } from '@/lib/time-clock'

export async function GET(request: Request) {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    const user = auth.user
    if (!canManageTimeClock(user.role) || !user.businessId) {
      return new Response('Forbidden: Owner access required', { status: 403 })
    }

    const businessId = user.businessId
    const settings = await getTimeClockSettings(businessId)
    const url = new URL(request.url)
    const preset = url.searchParams.get('preset') ?? 'payperiod'
    const barberId = url.searchParams.get('barberId') ?? undefined
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true },
    })
    const tz = business?.timezone ?? 'UTC'

    let from: Date
    let to: Date
    if (preset === 'custom') {
      const f = url.searchParams.get('from')
      const t = url.searchParams.get('to')
      if (!f || !t || isNaN(new Date(f).getTime()) || isNaN(new Date(t).getTime())) {
        return new Response('custom preset requires valid from & to', { status: 400 })
      }
      from = new Date(f)
      to = new Date(t)
    } else {
      try {
        ;({ from, to } = timeClockRange(preset, settings, new Date(), tz))
      } catch {
        return new Response('preset must be today | week | payperiod | custom', { status: 400 })
      }
    }

    const entries = await prisma.timeClockEntry.findMany({
      where: {
        businessId,
        clockInAt: { gte: from, lt: to },
        ...(barberId ? { barberId } : {}),
      },
      include: { barber: { select: { name: true } }, breaks: { orderBy: { startedAt: 'asc' } } },
      orderBy: { clockInAt: 'asc' },
    })

    const csv = timeClockCsv(
      entries.map((e) => ({
        id: e.id,
        barberId: e.barberId,
        barberName: e.barber.name,
        clockInAt: e.clockInAt,
        clockOutAt: e.clockOutAt,
        breakMinutes: e.breakMinutes,
        breaks: e.breaks.map((b) => ({ startedAt: b.startedAt, endedAt: b.endedAt })),
      })),
      settings
    )

    const filename = `time-clock-${preset}-${new Date().toISOString().slice(0, 10)}.csv`
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/time-clock/export')
  }
}

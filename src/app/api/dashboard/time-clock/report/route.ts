/**
 * Hours report API (owner; read-only for explicitly authorized barbers).
 *
 * GET /api/dashboard/time-clock/report
 *   ?preset=today|week|payperiod|custom  (default payperiod)
 *   &from=&to=            (custom preset; ISO dates)
 *   &barberId=            (optional single-barber filter)
 *
 * Aggregates hours per barber over the selected window with daily and
 * weekly overtime (thresholds from shop settings, 0 = disabled). Grouping
 * happens in the shop timezone. All queries are businessId-scoped.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import {
  getTimeClockSettings,
  getBarberAccess,
  timeClockRange,
  buildHoursReport,
  canManageTimeClock,
} from '@/lib/time-clock'

export async function GET(request: Request) {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    const user = auth.user
    if (!user.businessId) {
      return NextResponse.json({ error: 'Business required' }, { status: 403 })
    }

    // Owner, or a barber EXPLICITLY authorized to view team records.
    if (!canManageTimeClock(user.role)) {
      if (user.role !== 'BARBER' || !user.barberId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const access = await getBarberAccess(user.businessId, user.barberId)
      if (!access.canViewTeamRecords) {
        return NextResponse.json({ error: 'Not authorized to view team time records' }, { status: 403 })
      }
    }

    const settings = await getTimeClockSettings(user.businessId)
    const url = new URL(request.url)
    const preset = url.searchParams.get('preset') ?? 'payperiod'
    const barberId = url.searchParams.get('barberId') ?? undefined
    const business = await prisma.business.findUnique({
      where: { id: user.businessId },
      select: { timezone: true },
    })
    const tz = business?.timezone ?? 'UTC'
    const now = new Date()

    let from: Date
    let to: Date
    if (preset === 'custom') {
      const f = url.searchParams.get('from')
      const t = url.searchParams.get('to')
      if (!f || !t || isNaN(new Date(f).getTime()) || isNaN(new Date(t).getTime())) {
        return NextResponse.json({ error: 'custom preset requires valid from & to' }, { status: 400 })
      }
      from = new Date(f)
      to = new Date(t)
      if (to <= from) return NextResponse.json({ error: 'to must be after from' }, { status: 400 })
    } else {
      try {
        ;({ from, to } = timeClockRange(preset, settings, now, tz))
      } catch {
        return NextResponse.json({ error: 'preset must be today | week | payperiod | custom' }, { status: 400 })
      }
    }

    const entries = await prisma.timeClockEntry.findMany({
      where: {
        businessId: user.businessId,
        clockInAt: { gte: from, lt: to },
        ...(barberId ? { barberId } : {}),
      },
      include: { barber: { select: { name: true } } },
      orderBy: { clockInAt: 'asc' },
    })

    const report = buildHoursReport(
      entries.map((e) => ({
        id: e.id,
        barberId: e.barberId,
        barberName: e.barber.name,
        clockInAt: e.clockInAt,
        clockOutAt: e.clockOutAt,
        breakMinutes: e.breakMinutes,
      })),
      settings,
      tz,
      from,
      to,
      now
    )

    const totals = report.reduce(
      (acc, r) => ({
        regularHours: Math.round((acc.regularHours + r.regularHours) * 100) / 100,
        dailyOvertimeHours: Math.round((acc.dailyOvertimeHours + r.dailyOvertimeHours) * 100) / 100,
        weeklyOvertimeHours: Math.round((acc.weeklyOvertimeHours + r.weeklyOvertimeHours) * 100) / 100,
        overtimeHours: Math.round((acc.overtimeHours + r.overtimeHours) * 100) / 100,
        totalHours: Math.round((acc.totalHours + r.totalHours) * 100) / 100,
      }),
      { regularHours: 0, dailyOvertimeHours: 0, weeklyOvertimeHours: 0, overtimeHours: 0, totalHours: 0 }
    )

    return NextResponse.json({
      preset,
      from: from.toISOString(),
      to: to.toISOString(),
      timezone: tz,
      settings,
      barbers: report,
      totals,
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/time-clock/report')
  }
}

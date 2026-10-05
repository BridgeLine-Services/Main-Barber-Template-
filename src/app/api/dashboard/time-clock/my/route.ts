/**
 * Barber self-view of time clock (their own records only).
 *
 * GET /api/dashboard/time-clock/my
 *
 * Requires the shop's time clock to be ON and the barber to be eligible.
 * Returns current state (in / break / out), today's hours, this week's
 * hours, and this pay period's hours. Server-side scoped to the
 * session's barberId — a barber can never see another barber's hours
 * through this endpoint.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import {
  getTimeClockSettings,
  getBarberAccess,
  timeClockRange,
  entryHours,
  overtimeTotals,
} from '@/lib/time-clock'

export async function GET() {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    const user = auth.user
    if (user.role !== 'BARBER' || !user.barberId || !user.businessId) {
      return NextResponse.json({ error: 'Barber account required' }, { status: 403 })
    }

    const settings = await getTimeClockSettings(user.businessId)
    if (!settings.enabled) {
      return NextResponse.json({ error: 'Time clock is off' }, { status: 400 })
    }
    const access = await getBarberAccess(user.businessId, user.barberId)
    if (!access.eligible) {
      return NextResponse.json({ error: 'Not authorized for the time clock' }, { status: 403 })
    }

    const business = await prisma.business.findUnique({
      where: { id: user.businessId },
      select: { timezone: true },
    })
    const tz = business?.timezone ?? 'UTC'
    const now = new Date()

    // today + week + pay period hours, each with daily/weekly OT split
    const presets = ['today', 'week', 'payperiod'] as const
    const ranges = presets.map((p) => timeClockRange(p, settings, now, tz))
    const entries = await prisma.timeClockEntry.findMany({
      where: {
        businessId: user.businessId,
        barberId: user.barberId,
        clockInAt: { gte: ranges[2].from, lt: ranges[2].to }, // pay period superset
      },
      orderBy: { clockInAt: 'asc' },
    })
    const inRange = (e: { clockInAt: Date }, r: { from: Date; to: Date }) =>
      e.clockInAt >= r.from && e.clockInAt < r.to

    const dayKey = (d: Date) => {
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      return fmt.format(d)
    }

    const summary = presets.map((preset, i) => {
      const rangeEntries = entries.filter((e) => inRange(e, ranges[i]))
      const dayHours: Record<string, number> = {}
      for (const e of rangeEntries) {
        const k = dayKey(e.clockInAt)
        dayHours[k] = (dayHours[k] ?? 0) + entryHours(e, now)
      }
      const totals = overtimeTotals(
        Object.values(dayHours),
        settings.dailyOvertimeThresholdHours,
        settings.weeklyOvertimeThresholdHours
      )
      return {
        preset,
        from: ranges[i].from.toISOString(),
        to: ranges[i].to.toISOString(),
        totalHours: Math.round(totals.total * 100) / 100,
        regularHours: Math.round(totals.regular * 100) / 100,
        overtimeHours: Math.round(totals.overtime * 100) / 100,
        openShift: rangeEntries.some((e) => !e.clockOutAt),
      }
    })

    // current state
    const open = entries.find((e) => !e.clockOutAt)
    const openBreak = open
      ? await prisma.timeClockBreak.findFirst({ where: { entryId: open.id, endedAt: null } })
      : null

    return NextResponse.json({
      available: true,
      state: open ? (openBreak ? 'BREAK' : 'IN') : 'OUT',
      since: open ? (openBreak ? openBreak.startedAt.toISOString() : open.clockInAt.toISOString()) : null,
      todayBreakMinutes: open?.breakMinutes ?? 0,
      summary,
      entries: entries.map((e) => ({
        id: e.id,
        clockInAt: e.clockInAt.toISOString(),
        clockOutAt: e.clockOutAt?.toISOString() ?? null,
        breakMinutes: e.breakMinutes,
      })),
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/time-clock/my')
  }
}

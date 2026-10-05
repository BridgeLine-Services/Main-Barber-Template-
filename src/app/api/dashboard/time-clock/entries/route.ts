/**
 * Time entries API.
 *
 * GET /api/dashboard/time-clock/entries?preset=...&from=&to=&barberId=&status=
 *   Owner/platform owner: all shop entries (with breaks).
 *   Barber WITHOUT team authorization: 403 — barbers use /my for their own
 *   records; entries browsing is an owner payroll workflow.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import {
  getTimeClockSettings,
  timeClockRange,
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
    if (!canManageTimeClock(user.role)) {
      // Barbers see their own records via /my — never other barbers' here.
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const settings = await getTimeClockSettings(user.businessId)
    const url = new URL(request.url)
    const preset = url.searchParams.get('preset') ?? 'payperiod'
    const barberId = url.searchParams.get('barberId') ?? undefined
    const status = url.searchParams.get('status') // 'open' | 'closed' | undefined
    const business = await prisma.business.findUnique({
      where: { id: user.businessId },
      select: { timezone: true },
    })
    const tz = business?.timezone ?? 'UTC'

    let from: Date
    let to: Date
    if (preset === 'custom') {
      const f = url.searchParams.get('from')
      const t = url.searchParams.get('to')
      if (!f || !t) {
        return NextResponse.json({ error: 'custom preset requires from & to' }, { status: 400 })
      }
      from = new Date(f)
      to = new Date(t)
    } else {
      try {
        ;({ from, to } = timeClockRange(preset, settings, new Date(), tz))
      } catch {
        return NextResponse.json({ error: 'invalid preset' }, { status: 400 })
      }
    }

    const entries = await prisma.timeClockEntry.findMany({
      where: {
        businessId: user.businessId,
        clockInAt: { gte: from, lt: to },
        ...(barberId ? { barberId } : {}),
        ...(status === 'open' ? { clockOutAt: null } : {}),
        ...(status === 'closed' ? { clockOutAt: { not: null } } : {}),
      },
      include: {
        barber: { select: { name: true } },
        breaks: { orderBy: { startedAt: 'asc' } },
        revisions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { clockInAt: 'desc' },
      take: 500,
    })

    return NextResponse.json({ entries, from: from.toISOString(), to: to.toISOString(), timezone: tz })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/time-clock/entries')
  }
}

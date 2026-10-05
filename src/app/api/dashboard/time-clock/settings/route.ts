/**
 * Time Clock settings API (owner-only).
 *
 * GET   — the shop's time clock configuration.
 * PATCH — update the master switch / overtime rules / pay period.
 *
 * The `enabled` master switch is the owner's FINAL AUTHORITY: OFF hides
 * all time clock UI (client checks settings server-side per page) and
 * every clock/break transition returns 400 server-side. Historical
 * entries are NEVER deleted or hidden by turning the feature off.
 * Server-side authorization on every request — hiding UI is never the
 * only defense. Barbers/admins get 403 regardless of payload.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireOwner, logAudit, toAuditJson } from '@/lib/auth-helpers'
import { getTimeClockSettings } from '@/lib/time-clock'
import { prisma } from '@/lib/prisma'
import type { AuditAction } from '@prisma/client'

export async function GET() {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const settings = await getTimeClockSettings(auth.user.businessId!)
    return NextResponse.json({ settings })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/time-clock/settings')
  }
}

const F = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined

export async function PATCH(request: Request) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = auth.user.businessId!
    const body = (await request.json()) as Record<string, unknown>
    const current = await getTimeClockSettings(businessId)

    const data: Record<string, unknown> = {}
    const enabled = typeof body.enabled === 'boolean' ? (body.enabled as boolean) : undefined
    if (enabled !== undefined) data.enabled = enabled

    // Overtime thresholds are shop DATA (hours; 0 disables that rule).
    const daily = F(body.dailyOvertimeThresholdHours, 0, 24)
    if (daily !== undefined) data.dailyOvertimeThresholdHours = daily
    const weekly = F(body.weeklyOvertimeThresholdHours, 0, 168)
    if (weekly !== undefined) data.weeklyOvertimeThresholdHours = weekly

    if (body.payPeriodType === 'WEEKLY' || body.payPeriodType === 'BIWEEKLY') {
      data.payPeriodType = body.payPeriodType
    }
    if (typeof body.payPeriodAnchorDate === 'string') {
      const d = new Date(body.payPeriodAnchorDate)
      if (!isNaN(d.getTime())) data.payPeriodAnchorDate = d
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const settings = await prismaUpdateSettings(businessId, data)

    // Audit trail: the owner flip is a payroll-relevant shop decision.
    const enabledChanged = enabled !== undefined && enabled !== current.enabled
    const rulesChanged = Object.keys(data).some((k) => k !== 'enabled')
    if (enabledChanged || rulesChanged) {
      const action: AuditAction = enabledChanged
        ? settings.enabled
          ? 'TIME_CLOCK_ENABLED'
          : 'TIME_CLOCK_DISABLED'
        : 'TIME_CLOCK_OVERTIME_RULES_UPDATED'
      await logAudit({
        userId: auth.user.id,
        businessId,
        action,
        entityType: 'TimeClockSettings',
        entityId: settings.id,
        oldValues: toAuditJson(current),
        newValues: toAuditJson(settings),
      })
    }

    return NextResponse.json({ settings })
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/time-clock/settings')
  }
}

async function prismaUpdateSettings(businessId: string, data: Record<string, unknown>) {
  return prisma.timeClockSettings.upsert({
    where: { businessId },
    update: data,
    create: { businessId, ...data },
  })
}

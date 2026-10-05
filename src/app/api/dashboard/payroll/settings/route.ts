/**
 * Payroll Reporting settings API (owner-only).
 *
 * GET   — the shop's payroll reporting configuration.
 * PATCH — update the master switch / pay period / barber self-view grant.
 *
 * The `enabled` master switch is the owner's FINAL AUTHORITY: OFF hides all
 * payroll reporting (list, generation, barber self-view) while historical
 * report rows remain untouched in the database. Appointments, payments,
 * commissions, and the time clock continue working independently.
 * Server-side authorization on every request — hiding UI is never the
 * only defense. Barbers/admins get 403 regardless of payload.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireOwner, logAudit, toAuditJson } from '@/lib/auth-helpers'
import { getPayrollSettings } from '@/lib/payroll'
import { prisma } from '@/lib/prisma'
import type { AuditAction } from '@prisma/client'

export async function GET() {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const settings = await getPayrollSettings(auth.user.businessId!)
    return NextResponse.json({ settings })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/payroll/settings')
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = auth.user.businessId!
    const body = (await request.json()) as Record<string, unknown>
    const current = await getPayrollSettings(businessId)

    const data: Record<string, unknown> = {}
    const enabled = typeof body.enabled === 'boolean' ? (body.enabled as boolean) : undefined
    if (enabled !== undefined) data.enabled = enabled

    // Barber self-view grant (owner-controlled; never exposes other barbers
    // or shop totals — the /my endpoint scopes to the session's barberId).
    if (typeof body.barberSelfView === 'boolean') data.barberSelfView = body.barberSelfView

    if (
      body.payPeriodType === 'WEEKLY' ||
      body.payPeriodType === 'BIWEEKLY' ||
      body.payPeriodType === 'MONTHLY' ||
      body.payPeriodType === 'CUSTOM'
    ) {
      data.payPeriodType = body.payPeriodType
    }
    if (typeof body.payPeriodAnchorDate === 'string') {
      const d = new Date(body.payPeriodAnchorDate)
      if (!isNaN(d.getTime())) data.payPeriodAnchorDate = d
    }
    if (typeof body.customPeriodDays === 'number' && Number.isFinite(body.customPeriodDays)) {
      const days = Math.round(body.customPeriodDays)
      if (days >= 1 && days <= 365) data.customPeriodDays = days
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const settings = await prisma.payrollSettings.upsert({
      where: { businessId },
      update: data,
      create: { businessId, ...data },
    })

    // Audit trail: the owner flip is a payroll-relevant shop decision.
    const enabledChanged = enabled !== undefined && enabled !== current.enabled
    if (enabledChanged || Object.keys(data).length > 0) {
      const action: AuditAction = enabledChanged
        ? settings.enabled
          ? 'PAYROLL_REPORTING_ENABLED'
          : 'PAYROLL_REPORTING_DISABLED'
        : 'PAYROLL_SETTINGS_UPDATED'
      await logAudit({
        userId: auth.user.id,
        businessId,
        action,
        entityType: 'PayrollSettings',
        entityId: settings.id,
        oldValues: toAuditJson(current),
        newValues: toAuditJson(settings),
      })
    }

    return NextResponse.json({ settings })
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/payroll/settings')
  }
}

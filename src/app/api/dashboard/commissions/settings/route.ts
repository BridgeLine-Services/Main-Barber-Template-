/**
 * Commission settings API (owner-only).
 *
 * GET  — the shop's commission configuration + rule list.
 * PATCH — update configuration. The `enabled` master switch is the
 *        owner's final authority: OFF stops all calculations and hides
 *        commission dashboards, but NEVER deletes historical entries.
 *
 * Server-side authorization on every request — hiding UI is never the
 * only defense. Barbers/admins get 403 regardless of payload.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireOwner, logAudit, toAuditJson } from '@/lib/auth-helpers'
import { getClientIP } from '@/lib/rate-limit'
import { getCommissionSettings } from '@/lib/commissions'
import { prisma } from '@/lib/prisma'
import type { AuditAction } from '@prisma/client'

export async function GET() {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const [settings, rules] = await Promise.all([
      getCommissionSettings(auth.user.businessId!),
      prisma.commissionRule.findMany({
        where: { businessId: auth.user.businessId },
        include: { barber: { select: { id: true, name: true } }, service: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    return NextResponse.json({ settings, rules })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/commissions/settings')
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
    const current = await getCommissionSettings(businessId)

    const data: Record<string, unknown> = {}
    const B = (k: string) => (typeof body[k] === 'boolean' ? (body[k] as boolean) : undefined)

    const enabled = B('enabled')
    if (enabled !== undefined) data.enabled = enabled
    for (const k of ['barberSelfViewEnabled', 'productCommissionEnabled', 'includeNoShowFees', 'calculateOnUnpaid']) {
      const v = B(k)
      if (v !== undefined) data[k] = v
    }
    if (body.defaultRateType === 'PERCENT' || body.defaultRateType === 'FIXED') data.defaultRateType = body.defaultRateType
    if (body.productRateType === 'PERCENT' || body.productRateType === 'FIXED') data.productRateType = body.productRateType
    if (body.tipsMode === 'EXCLUDED' || body.tipsMode === 'PASS_THROUGH' || body.tipsMode === 'PERCENT') {
      data.tipsMode = body.tipsMode
    }
    for (const [k, min, max] of [
      ['defaultRatePercent', 0, 100],
      ['defaultRateFixed', 0, 100000],
      ['productRatePercent', 0, 100],
      ['productRateFixed', 0, 100000],
      ['tipsCommissionPercent', 0, 100],
    ] as const) {
      const v = F(body[k], min, max)
      if (v !== undefined) data[k] = v
    }

    const settings = await prisma.commissionSettings.update({ where: { businessId }, data })

    // Audit: master switch flips and rate changes are sensitive financial events.
    const enabledChanged = enabled !== undefined && enabled !== current.enabled
    const rateChanged =
      (data.defaultRateType !== undefined && data.defaultRateType !== current.defaultRateType) ||
      (data.defaultRatePercent !== undefined && data.defaultRatePercent !== current.defaultRatePercent) ||
      (data.defaultRateFixed !== undefined && data.defaultRateFixed !== current.defaultRateFixed)
    if (enabledChanged || rateChanged) {
      const action: AuditAction = enabledChanged
        ? enabled
          ? 'COMMISSION_ENABLED'
          : 'COMMISSION_DISABLED'
        : 'COMMISSION_RATE_CHANGED'
      await logAudit({
        userId: auth.user.id,
        businessId,
        action,
        entityType: 'CommissionSettings',
        entityId: settings.id,
        oldValues: toAuditJson({
          enabled: current.enabled,
          defaultRateType: current.defaultRateType,
          defaultRatePercent: current.defaultRatePercent,
          defaultRateFixed: current.defaultRateFixed,
        }),
        newValues: toAuditJson({
          enabled: settings.enabled,
          defaultRateType: settings.defaultRateType,
          defaultRatePercent: settings.defaultRatePercent,
          defaultRateFixed: settings.defaultRateFixed,
        }),
        ipAddress: getClientIP(request),
        userAgent: request.headers.get('user-agent') || undefined,
      })
    }

    return NextResponse.json({ settings })
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/commissions/settings')
  }
}

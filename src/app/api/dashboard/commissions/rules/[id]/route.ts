/**
 * Commission rule mutations (owner-only): PATCH a rule's rate or DELETE
 * it. Both are sensitive financial changes — audited, and authorized
 * server-side on every request.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireOwner, logAudit, toAuditJson } from '@/lib/auth-helpers'
import { getClientIP } from '@/lib/rate-limit'
import { prisma } from '@/lib/prisma'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = auth.user.businessId!
    const { id } = await params
    const rule = await prisma.commissionRule.findFirst({ where: { id, businessId } }) // tenant-scoped
    if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

    const body = (await request.json()) as { rateType?: string; ratePercent?: number; rateFixed?: number }
    const rateType = body.rateType === 'FIXED' ? 'FIXED' : body.rateType === 'PERCENT' ? 'PERCENT' : rule.rateType
    let ratePercent = rule.ratePercent
    let rateFixed = rule.rateFixed
    if (rateType === 'PERCENT') {
      rateFixed = null
      if (typeof body.ratePercent === 'number' && Number.isFinite(body.ratePercent) && body.ratePercent >= 0 && body.ratePercent <= 100) {
        ratePercent = body.ratePercent
      } else if (rule.rateType !== 'PERCENT' || rule.ratePercent == null) {
        return NextResponse.json({ error: 'ratePercent (0-100) is required for PERCENT rules' }, { status: 400 })
      }
    } else {
      ratePercent = null
      if (typeof body.rateFixed === 'number' && Number.isFinite(body.rateFixed) && body.rateFixed >= 0 && body.rateFixed <= 100000) {
        rateFixed = body.rateFixed
      } else if (rule.rateType !== 'FIXED' || rule.rateFixed == null) {
        return NextResponse.json({ error: 'rateFixed (>= 0) is required for FIXED rules' }, { status: 400 })
      }
    }

    const updated = await prisma.commissionRule.update({ where: { id: rule.id }, data: { rateType, ratePercent, rateFixed } })
    await logAudit({
      userId: auth.user.id,
      businessId,
      action: 'COMMISSION_RATE_CHANGED',
      entityType: 'CommissionRule',
      entityId: rule.id,
      oldValues: toAuditJson({ rateType: rule.rateType, ratePercent: rule.ratePercent, rateFixed: rule.rateFixed }),
      newValues: toAuditJson({ rateType, ratePercent, rateFixed }),
      ipAddress: getClientIP(request),
      userAgent: request.headers.get('user-agent') || undefined,
    })
    return NextResponse.json({ rule: updated })
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/commissions/rules/[id]')
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = auth.user.businessId!
    const { id } = await params
    const rule = await prisma.commissionRule.findFirst({ where: { id, businessId } }) // tenant-scoped
    if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

    await prisma.commissionRule.delete({ where: { id: rule.id } })
    await logAudit({
      userId: auth.user.id,
      businessId,
      action: 'COMMISSION_RATE_CHANGED',
      entityType: 'CommissionRule',
      entityId: rule.id,
      oldValues: toAuditJson({ barberId: rule.barberId, serviceId: rule.serviceId, rateType: rule.rateType, ratePercent: rule.ratePercent, rateFixed: rule.rateFixed, description: 'Commission rule deleted' }),
      ipAddress: getClientIP(request),
      userAgent: request.headers.get('user-agent') || undefined,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/commissions/rules/[id]')
  }
}

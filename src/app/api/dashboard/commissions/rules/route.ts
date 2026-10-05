/**
 * Commission rules API (owner-only).
 *
 * Rules override the shop-default commission rate per barber and/or per
 * service. Resolution priority lives in src/lib/commissions.ts:
 *   (barber + service) > (barber + any) > (any + service) > defaults
 *
 * Barbers can NEVER create or edit rules — verified server-side on
 * every request, not just by hiding the UI.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireOwner, logAudit } from '@/lib/auth-helpers'
import { getClientIP } from '@/lib/rate-limit'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const rules = await prisma.commissionRule.findMany({
      where: { businessId: auth.user.businessId! },
      include: { barber: { select: { id: true, name: true } }, service: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ rules })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/commissions/rules')
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = auth.user.businessId!
    const body = (await request.json()) as {
      barberId?: string | null
      serviceId?: string | null
      rateType?: string
      ratePercent?: number
      rateFixed?: number
    }

    // Validate scope — both refs must belong to this tenant when set.
    let barberId: string | null = null
    let serviceId: string | null = null
    if (body.barberId) {
      const barber = await prisma.barber.findFirst({ where: { id: body.barberId, businessId }, select: { id: true } })
      if (!barber) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
      barberId = barber.id
    }
    if (body.serviceId) {
      const service = await prisma.service.findFirst({ where: { id: body.serviceId, businessId }, select: { id: true } })
      if (!service) return NextResponse.json({ error: 'Service not found' }, { status: 404 })
      serviceId = service.id
    }

    const rateType = body.rateType === 'FIXED' ? 'FIXED' : 'PERCENT'
    const ratePercent =
      rateType === 'PERCENT' && typeof body.ratePercent === 'number' && Number.isFinite(body.ratePercent) && body.ratePercent >= 0 && body.ratePercent <= 100
        ? body.ratePercent
        : undefined
    const rateFixed =
      rateType === 'FIXED' && typeof body.rateFixed === 'number' && Number.isFinite(body.rateFixed) && body.rateFixed >= 0 && body.rateFixed <= 100000
        ? body.rateFixed
        : undefined
    if (rateType === 'PERCENT' && ratePercent === undefined) {
      return NextResponse.json({ error: 'ratePercent (0-100) is required for PERCENT rules' }, { status: 400 })
    }
    if (rateType === 'FIXED' && rateFixed === undefined) {
      return NextResponse.json({ error: 'rateFixed (>= 0) is required for FIXED rules' }, { status: 400 })
    }

    const scopeKey = `${barberId ?? ''}|${serviceId ?? ''}`
    const rule = await prisma.commissionRule.upsert({
      where: { businessId_scopeKey: { businessId, scopeKey } },
      update: { rateType, ratePercent, rateFixed },
      create: { businessId, barberId, serviceId, scopeKey, rateType, ratePercent, rateFixed },
    })

    await logAudit({
      userId: auth.user.id,
      businessId,
      action: 'COMMISSION_RATE_CHANGED',
      entityType: 'CommissionRule',
      entityId: rule.id,
      newValues: {
        barberId,
        serviceId,
        rateType,
        ratePercent: ratePercent ?? null,
        rateFixed: rateFixed ?? null,
        description: `Commission rule ${barberId ? 'barber-scoped' : ''}${barberId && serviceId ? '+' : ''}${serviceId ? 'service-scoped' : ''} set to ${rateType === 'PERCENT' ? `${ratePercent}%` : `$${rateFixed} flat`}`,
      },
      ipAddress: getClientIP(request),
      userAgent: request.headers.get('user-agent') || undefined,
    })

    return NextResponse.json({ rule })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/commissions/rules')
  }
}

/**
 * Commission entry list (owner-only). Individual ledger rows with payout
 * status for the dashboard's detail table and payout actions.
 *
 * GET /api/dashboard/commissions/entries
 *   ?preset=today|week|month | ?from&to | ?barberId | ?status
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireOwner } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { commissionRange } from '@/lib/commissions'
import type { Prisma } from '@prisma/client'

const STATUSES = ['PENDING', 'APPROVED', 'PAID', 'ADJUSTED'] as const

export async function GET(request: Request) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = auth.user.businessId!

    const url = new URL(request.url)
    let from: Date
    let to: Date
    const fromParam = url.searchParams.get('from')
    const toParam = url.searchParams.get('to')
    if (fromParam && toParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
      from = new Date(`${fromParam}T00:00:00Z`)
      to = new Date(`${toParam}T00:00:00Z`)
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
        return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
      }
    } else {
      const preset = url.searchParams.get('preset') ?? 'month'
      try {
        ;({ from, to } = commissionRange(preset, new Date()))
      } catch {
        return NextResponse.json({ error: 'preset must be today | week | month' }, { status: 400 })
      }
    }

    const barberId = url.searchParams.get('barberId')
    const status = url.searchParams.get('status')
    const where: Prisma.CommissionEntryWhereInput = {
      businessId,
      createdAt: { gte: from, lt: to },
      ...(barberId ? { barberId } : {}),
      ...(status && (STATUSES as readonly string[]).includes(status) ? { status: status as (typeof STATUSES)[number] } : {}),
    }

    const entries = await prisma.commissionEntry.findMany({
      where,
      include: {
        barber: { select: { id: true, name: true } },
        appointment: { select: { id: true, confirmationNumber: true, service: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })

    return NextResponse.json({
      entries: entries.map((e) => ({
        id: e.id,
        barberId: e.barberId,
        barberName: e.barber?.name ?? 'Barber',
        appointmentId: e.appointmentId,
        appointmentRef: e.appointment?.confirmationNumber ?? null,
        serviceName: e.appointment?.service?.name ?? null,
        source: e.source,
        grossAmount: e.grossAmount,
        discountAmount: e.discountAmount,
        rateType: e.rateType,
        ratePercent: e.ratePercent,
        rateFixed: e.rateFixed,
        commissionAmount: e.commissionAmount,
        adjustment: e.adjustment,
        refundAdjustment: e.refundAdjustment,
        payout: Math.round((e.commissionAmount + e.adjustment + e.refundAdjustment) * 100) / 100,
        status: e.status,
        paidAt: e.paidAt?.toISOString() ?? null,
        paidAmount: e.paidAmount,
        notes: e.notes,
        createdAt: e.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/commissions/entries')
  }
}

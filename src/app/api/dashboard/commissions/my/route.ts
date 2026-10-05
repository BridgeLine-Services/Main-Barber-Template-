/**
 * Barber self-view of commissions (opt-in by the owner).
 *
 * GET /api/dashboard/commissions/my?preset=week|month|today
 *
 * The owner must have BOTH enabled commissions and turned on
 * barberSelfViewEnabled — otherwise the barber sees 403 and the UI
 * link is hidden. The barber sees ONLY their own ledger rows, enforced
 * server-side from the session's barberId (never from a query param).
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { commissionRange, entryPayout, getCommissionSettings, rateLabel } from '@/lib/commissions'

export async function GET(request: Request) {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    const user = auth.user
    if (user.role !== 'BARBER' || !user.barberId || !user.businessId) {
      return NextResponse.json({ error: 'Barber account required' }, { status: 403 })
    }

    const settings = await getCommissionSettings(user.businessId)
    const url = new URL(request.url)
    const preset = url.searchParams.get('preset') ?? 'week'
    let from: Date
    let to: Date
    try {
      ;({ from, to } = commissionRange(preset, new Date()))
    } catch {
      return NextResponse.json({ error: 'preset must be today | week | month' }, { status: 400 })
    }

    // Owner OFF hides the barber view entirely (owner is the final
    // authority); barberSelfViewEnabled gates the opt-in self-view.
    const enabled = settings.enabled && settings.barberSelfViewEnabled

    const [entries, participation] = await Promise.all([
      enabled
        ? prisma.commissionEntry.findMany({
            where: { businessId: user.businessId, barberId: user.barberId, createdAt: { gte: from, lt: to } },
            include: { appointment: { select: { confirmationNumber: true, service: { select: { name: true } } } } },
            orderBy: { createdAt: 'desc' },
            take: 200,
          })
        : Promise.resolve([]),
      prisma.barberCommissionParticipation.findUnique({ where: { barberId: user.barberId } }),
    ])

    const summary = entries.reduce(
      (acc, e) => {
        const payout = entryPayout(e)
        acc.commission = Math.round((acc.commission + e.commissionAmount) * 100) / 100
        acc.adjustments = Math.round((acc.adjustments + e.adjustment + e.refundAdjustment) * 100) / 100
        acc.payout = Math.round((acc.payout + payout) * 100) / 100
        if (e.status === 'PAID') acc.paidPayout = Math.round((acc.paidPayout + payout) * 100) / 100
        else acc.pendingPayout = Math.round((acc.pendingPayout + payout) * 100) / 100
        if (e.source === 'TIP') acc.tips = Math.round((acc.tips + e.grossAmount) * 100) / 100
        else acc.revenue = Math.round((acc.revenue + e.grossAmount) * 100) / 100
        return acc
      },
      { revenue: 0, tips: 0, commission: 0, adjustments: 0, payout: 0, pendingPayout: 0, paidPayout: 0 },
    )

    return NextResponse.json({
      enabled,
      participates: participation ? participation.participates : true,
      from: from.toISOString(),
      to: to.toISOString(),
      summary,
      entries: entries.map((e) => ({
        id: e.id,
        date: e.createdAt.toISOString(),
        serviceName: e.appointment?.service?.name ?? (e.source === 'TIP' ? 'Tip' : e.notes ?? 'Commission'),
        appointmentRef: e.appointment?.confirmationNumber ?? null,
        source: e.source,
        grossAmount: e.grossAmount,
        rateLabel: rateLabel(e.rateType, e.ratePercent, e.rateFixed),
        commissionAmount: e.commissionAmount,
        adjustment: Math.round((e.adjustment + e.refundAdjustment) * 100) / 100,
        payout: entryPayout(e),
        status: e.status,
        paidAt: e.paidAt?.toISOString() ?? null,
        notes: e.notes,
      })),
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/commissions/my')
  }
}

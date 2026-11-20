export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/dashboard/growth/analytics — one barber's own numbers.
 *
 * A barber sees only their own work. An owner may look at a barber who actually works in
 * their shop; the barber id is validated against the session's business, so a guessed id
 * returns nothing rather than another shop's figures.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getBusinessIdForUser } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { buildBarberAnalytics, type AppointmentFact, type PaymentFact, type ReferralFact, type ScheduleFact } from '@/lib/growth/barber-analytics'

const MAX_DAYS = 365

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    const businessId = await getBusinessIdForUser(auth.user)

    const requestedDays = Number(req.nextUrl.searchParams.get('days') ?? '90')
    const rangeDays = Number.isFinite(requestedDays) ? Math.min(MAX_DAYS, Math.max(1, Math.round(requestedDays))) : 90
    const end = new Date()
    const start = new Date(end.getTime() - rangeDays * 86_400_000)

    // A barber is pinned to their own profile. An owner may name one of their own barbers.
    const requestedBarberId = req.nextUrl.searchParams.get('barberId')
    let barberId: string | null = auth.user.barberId ?? null
    if (requestedBarberId) {
      if (auth.user.role !== 'OWNER' && auth.user.role !== 'BUSINESS_ADMIN' && requestedBarberId !== auth.user.barberId) {
        return NextResponse.json({ error: 'You can only see your own numbers.' }, { status: 403 })
      }
      const barber = await prisma.barber.findFirst({ where: { id: requestedBarberId, businessId }, select: { id: true } })
      if (!barber) return NextResponse.json({ error: 'That barber is not one of yours.' }, { status: 404 })
      barberId = barber.id
    }

    if (!barberId) {
      return NextResponse.json({ error: 'This account is not linked to a barber, so there are no numbers to show.' }, { status: 404 })
    }

    const appointmentRows = await prisma.appointment.findMany({
      where: { businessId, barberId, startTime: { gte: start, lte: end } },
      select: { id: true, startTime: true, status: true, customerId: true, service: { select: { name: true, price: true } } },
    })
    const appointments: AppointmentFact[] = appointmentRows.map((row) => ({
      id: row.id,
      startTime: row.startTime,
      status: row.status,
      serviceName: row.service?.name ?? null,
      servicePriceCents: row.service ? Math.round(row.service.price * 100) : null,
      source: null,
      customerId: row.customerId,
    }))

    const paymentRows = await prisma.payment.findMany({
      where: { businessId, barberId, createdAt: { gte: start, lte: end }, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
      select: { amount: true, refundedAmount: true },
    })
    const commissionRows = await prisma.commissionEntry.findMany({
      where: { businessId, barberId, createdAt: { gte: start, lte: end } },
      select: { source: true, grossAmount: true, commissionAmount: true, adjustment: true, refundAdjustment: true },
    })
    const commissionSettings = await prisma.commissionSettings.findUnique({ where: { businessId }, select: { tipsMode: true } })

    // Tips are only a number when this shop records them. EXCLUDED means tips are the
    // barber's own and are never written to the ledger, so the figure is unknown.
    const tipsRecorded = commissionSettings?.tipsMode !== 'EXCLUDED'
    const tipCents = tipsRecorded
      ? commissionRows.filter((row) => row.source === 'TIP').reduce((sum, row) => sum + Math.round(row.grossAmount * 100), 0)
      : null
    const commissionCents = commissionRows.reduce(
      (sum, row) => sum + Math.round((row.commissionAmount + row.adjustment + row.refundAdjustment) * 100),
      0,
    )

    const payments: PaymentFact[] = paymentRows.length > 0
      ? [{
          grossCents: paymentRows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0),
          refundCents: paymentRows.reduce((sum, row) => sum + Math.round((row.refundedAmount ?? 0) * 100), 0),
          tipCents,
          commissionCents,
        }]
      : []

    const referralRows = await prisma.referralAttribution.findMany({
      where: { businessId },
      select: { customerId: true, referrerCustomerId: true, source: true },
    })
    const referrals: ReferralFact[] = referralRows

    const scheduleRows = await prisma.schedule.findMany({
      where: { barberId },
      select: { dayOfWeek: true, startTime: true, endTime: true, isOff: true },
    })
    const schedules: ScheduleFact[] = scheduleRows

    const result = buildBarberAnalytics({ appointments, payments, referrals, schedules, rangeDays })

    return NextResponse.json({
      barberId,
      rangeDays,
      ...result,
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/growth/analytics')
  }
}

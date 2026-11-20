export const dynamic = 'force-dynamic'

/**
 * GET /api/dashboard/referrals — the shop's referral programme and this shop's numbers.
 * POST /api/dashboard/referrals — turn the programme on or off, or issue one customer's code.
 *
 * The tenant comes from the session. A business id in the body is ignored, so one shop can
 * never read or write another shop's referrals. Issuing a code first proves the customer
 * belongs to this shop, so a guessed customer id yields nothing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireOwner, getBusinessIdForUser, logAudit } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { buildReferralCode, normaliseReferralCode, referralLink, summariseReferrals, type ReferralRow } from '@/lib/growth/referrals'

export async function GET() {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    const businessId = await getBusinessIdForUser(auth.user)

    const program = await prisma.referralProgram.findUnique({ where: { businessId } })
    const attributions = await prisma.referralAttribution.findMany({
      where: { businessId },
      select: { customerId: true, referrerCustomerId: true, source: true },
    })

    const bookings = await prisma.appointment.groupBy({
      by: ['customerId'],
      where: { businessId, status: 'COMPLETED', customerId: { in: attributions.map((a) => a.customerId) } },
      _count: { _all: true },
    })
    const bookingCounts = new Map(bookings.map((row) => [row.customerId, row._count._all]))

    const paymentRows = await prisma.payment.findMany({
      where: { businessId, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
      select: { customerId: true, amount: true, refundedAmount: true },
    })
    const revenueByCustomer = new Map<string, number>()
    for (const row of paymentRows) {
      if (!row.customerId) continue
      const cents = Math.round((row.amount - (row.refundedAmount ?? 0)) * 100)
      revenueByCustomer.set(row.customerId, (revenueByCustomer.get(row.customerId) ?? 0) + cents)
    }

    const rows: ReferralRow[] = attributions.map((a) => ({
      customerId: a.customerId,
      referrerCustomerId: a.referrerCustomerId,
      source: a.source,
      revenueCents: revenueByCustomer.get(a.customerId) ?? 0,
      bookings: bookingCounts.get(a.customerId) ?? 0,
    }))

    const totalRevenueCents = Array.from(revenueByCustomer.values()).reduce((sum, value) => sum + value, 0)

    return NextResponse.json({
      enabled: program?.enabled ?? false,
      metrics: summariseReferrals(rows, totalRevenueCents),
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/referrals')
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = await getBusinessIdForUser(auth.user)

    let body: { enabled?: unknown; customerId?: unknown }
    try {
      body = (await req.json()) as { enabled?: unknown; customerId?: unknown }
    } catch {
      return NextResponse.json({ error: 'That request could not be read. Please try again.' }, { status: 400 })
    }

    // Issuing one customer's code: the customer is proven to belong to this shop first.
    if (typeof body.customerId === 'string' && body.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: body.customerId, businessId }, select: { id: true } })
      if (!customer) {
        return NextResponse.json({ error: 'That customer is not one of yours.' }, { status: 404 })
      }
      const program = await prisma.referralProgram.upsert({
        where: { businessId },
        update: {},
        create: { businessId, enabled: true },
      })
      const existing = await prisma.referralCode.findUnique({ where: { businessId_customerId: { businessId, customerId: customer.id } } })
      if (existing) {
        return NextResponse.json({ code: existing.code, link: referralLink(`${req.nextUrl.origin}/book`, existing.code) })
      }
      let code = buildReferralCode(program.codePrefix, customer.id)
      for (let attempt = 1; attempt < 6; attempt++) {
        const clash = await prisma.referralCode.findUnique({ where: { businessId_code: { businessId, code } } })
        if (!clash) break
        code = buildReferralCode(program.codePrefix, customer.id, attempt)
      }
      const saved = await prisma.referralCode.create({ data: { businessId, customerId: customer.id, code: normaliseReferralCode(code) } })
      return NextResponse.json({ code: saved.code, link: referralLink(`${req.nextUrl.origin}/book`, saved.code) })
    }

    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'Choose whether the referral programme is on or off.' }, { status: 400 })
    }

    const program = await prisma.referralProgram.upsert({
      where: { businessId },
      update: { enabled: body.enabled },
      create: { businessId, enabled: body.enabled },
    })

    await logAudit({
      userId: auth.user.id,
      businessId,
      action: 'SETTINGS_UPDATED',
      entityType: 'ReferralProgram',
      entityId: program.id,
      oldValues: { enabled: !body.enabled },
      newValues: { enabled: body.enabled },
    })

    return NextResponse.json({ ok: true, enabled: program.enabled })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/referrals')
  }
}

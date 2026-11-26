export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireOwner, getBusinessIdForUser, logAudit } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { withTenant } from '@/lib/tenant-context'
import { buildReferralCode, normaliseReferralCode, referralLink, summariseReferrals, type ReferralRow } from '@/lib/growth/referrals'

export async function GET() {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    if (!['OWNER', 'BUSINESS_ADMIN', 'BARBER'].includes(auth.user.role)) {
      return NextResponse.json({ error: 'Shop staff access is required.' }, { status: 403 })
    }
    const businessId = await getBusinessIdForUser(auth.user)
    // Tenant-bound: the entire referral read runs inside the shop's own context, so it
    // stays correct when RLS policies are switched on.
    return withTenant(businessId, async (tx) => {
    const program = await tx.referralProgram.findUnique({ where: { businessId } })
    const attributions = await tx.referralAttribution.findMany({
      where: { businessId },
      select: { customerId: true, referrerCustomerId: true, source: true, campaign: true },
    })
    const referredIds = attributions.map((row) => row.customerId)
    const allCompletedAppointments = await tx.appointment.findMany({
      where: { businessId, status: 'COMPLETED' },
      select: { id: true, customerId: true },
    })
    const referredIdSet = new Set(referredIds)
    const completedAppointments = allCompletedAppointments.filter((row) => referredIdSet.has(row.customerId))
    const completedIds = allCompletedAppointments.map((row) => row.id)

    // Only settled service charges/deposits tied to a completed appointment count.
    // Payment records for shop orders, tips, pending payments and unrelated visits do not.
    const paymentRows = completedIds.length ? await tx.payment.findMany({
      where: {
        businessId,
        appointmentId: { in: completedIds },
        status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
        kind: { in: ['CHARGE', 'DEPOSIT'] },
      },
      select: { id: true, appointmentId: true, customerId: true, provider: true, providerRefId: true, idempotencyKey: true, amount: true, refundedAmount: true, currency: true, status: true },
    }) : []

    const seenPayments = new Set<string>()
    const paymentByAppointment = new Map<string, number>()
    const appointmentPaymentCount = new Map<string, number>()
    const invalidPaymentAppointments = new Set<string>()
    const appointmentCustomerById = new Map(allCompletedAppointments.map((appointment) => [appointment.id, appointment.customerId]))
    for (const payment of paymentRows) {
      if (!payment.appointmentId) continue
      if (payment.customerId && payment.customerId !== appointmentCustomerById.get(payment.appointmentId)) {
        invalidPaymentAppointments.add(payment.appointmentId)
        continue
      }
      if (payment.currency !== 'USD' || payment.amount < 0 || payment.refundedAmount < 0 || payment.refundedAmount > payment.amount) {
        invalidPaymentAppointments.add(payment.appointmentId)
        continue
      }
      const uniquePaymentKey = payment.providerRefId
        ? `${payment.provider}:${payment.providerRefId}`
        : payment.idempotencyKey ? `idempotency:${payment.idempotencyKey}` : `payment:${payment.id}`
      if (seenPayments.has(uniquePaymentKey)) continue
      seenPayments.add(uniquePaymentKey)
      appointmentPaymentCount.set(payment.appointmentId, (appointmentPaymentCount.get(payment.appointmentId) ?? 0) + 1)
      const netCents = payment.status === 'REFUNDED' ? 0 : Math.max(0, Math.round((payment.amount - payment.refundedAmount) * 100))
      paymentByAppointment.set(payment.appointmentId, (paymentByAppointment.get(payment.appointmentId) ?? 0) + netCents)
    }
    const financialDataKnown = completedIds.every((id) =>
      (appointmentPaymentCount.get(id) ?? 0) > 0 && !invalidPaymentAppointments.has(id),
    )

    const bookingsByCustomer = new Map<string, number>()
    const knownRevenueByCustomer = new Map<string, number>()
    const customerRevenueKnown = new Map<string, boolean>()
    for (const booking of completedAppointments) {
      bookingsByCustomer.set(booking.customerId, (bookingsByCustomer.get(booking.customerId) ?? 0) + 1)
      knownRevenueByCustomer.set(booking.customerId, (knownRevenueByCustomer.get(booking.customerId) ?? 0) + (paymentByAppointment.get(booking.id) ?? 0))
      const bookingRevenueKnown = (appointmentPaymentCount.get(booking.id) ?? 0) > 0 && !invalidPaymentAppointments.has(booking.id)
      customerRevenueKnown.set(booking.customerId, (customerRevenueKnown.get(booking.customerId) ?? true) && bookingRevenueKnown)
    }
    const revenueByCustomer = new Map<string, number | null>()
    for (const customerId of referredIds) {
      const bookingCount = bookingsByCustomer.get(customerId) ?? 0
      const isKnown = bookingCount === 0 || customerRevenueKnown.get(customerId) === true
      revenueByCustomer.set(customerId, isKnown ? knownRevenueByCustomer.get(customerId) ?? 0 : null)
    }
    const rows: ReferralRow[] = attributions.map((attribution) => ({
      customerId: attribution.customerId,
      referrerCustomerId: attribution.referrerCustomerId,
      source: attribution.source,
      campaign: attribution.campaign,
      revenueCents: revenueByCustomer.get(attribution.customerId) ?? null,
      bookings: bookingsByCustomer.get(attribution.customerId) ?? 0,
    }))
    const totalRevenueCents = financialDataKnown
      ? Array.from(paymentByAppointment.values()).reduce((sum, amount) => sum + amount, 0)
      : null

    return NextResponse.json({ enabled: program?.enabled ?? false, metrics: summariseReferrals(rows, totalRevenueCents) })
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

    if (typeof body.customerId === 'string' && body.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: body.customerId, businessId }, select: { id: true } })
      if (!customer) return NextResponse.json({ error: 'That customer is not one of yours.' }, { status: 404 })
      const program = await prisma.referralProgram.findUnique({ where: { businessId } })
      if (!program?.enabled) return NextResponse.json({ error: 'Turn on the referral program before creating a share link.' }, { status: 409 })
      const existing = await prisma.referralCode.findUnique({ where: { businessId_customerId: { businessId, customerId: customer.id } } })
      if (existing) return NextResponse.json({ code: existing.code, link: referralLink(`${req.nextUrl.origin}/book`, existing.code) })
      let code = buildReferralCode(program.codePrefix, customer.id)
      for (let attempt = 0; attempt < 6; attempt++) {
        const clash = await prisma.referralCode.findUnique({ where: { businessId_code: { businessId, code: normaliseReferralCode(code) } } })
        if (!clash) break
        code = buildReferralCode(program.codePrefix, customer.id, attempt + 1)
      }
      try {
        const saved = await prisma.referralCode.create({ data: { businessId, customerId: customer.id, code: normaliseReferralCode(code) } })
        return NextResponse.json({ code: saved.code, link: referralLink(`${req.nextUrl.origin}/book`, saved.code) })
      } catch (error) {
        const raced = await prisma.referralCode.findUnique({ where: { businessId_customerId: { businessId, customerId: customer.id } } })
        if (!raced) throw error
        return NextResponse.json({ code: raced.code, link: referralLink(`${req.nextUrl.origin}/book`, raced.code) })
      }
    }

    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'Choose whether the referral programme is on or off.' }, { status: 400 })
    }
    const oldProgram = await prisma.referralProgram.findUnique({ where: { businessId }, select: { enabled: true } })
    const program = await prisma.referralProgram.upsert({
      where: { businessId }, update: { enabled: body.enabled }, create: { businessId, enabled: body.enabled },
    })
    await logAudit({
      userId: auth.user.id,
      businessId,
      action: 'SETTINGS_UPDATED',
      entityType: 'ReferralProgram',
      entityId: program.id,
      oldValues: { enabled: oldProgram?.enabled ?? false },
      newValues: { enabled: program.enabled },
    })
    return NextResponse.json({ ok: true, enabled: program.enabled })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/referrals')
  }
}

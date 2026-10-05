/**
 * Public customer gift card purchase (digital cards). Fails closed when
 * the shop has no online payment provider configured: a customer cannot
 * mint an active gift card for money the shop cannot collect online —
 * in pay-at-shop deployments gift cards are sold in the POS instead.
 *
 * Flow: validate → create PENDING payment via the shop's provider
 * (Stripe: returns a clientSecret) → create the PENDING gift card →
 * the Stripe webhook settles the payment and activates the card.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { resolvePublicBusiness } from '@/lib/tenant'
import { resolvePaymentProvider } from '@/lib/payments'
import { getGiftCardSettings, sellGiftCard } from '@/lib/gift-cards'
import { prisma } from '@/lib/prisma'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function POST(request: Request) {
  try {
    const business = await resolvePublicBusiness()
    if (!business) return NextResponse.json({ error: 'Shop not found' }, { status: 404 })

    const body = (await request.json()) as {
      amount?: number
      purchaserName?: string
      purchaserEmail?: string
      recipientName?: string
      recipientEmail?: string
      message?: string
    }
    if (!body.amount || !body.purchaserName?.trim()) {
      return NextResponse.json({ error: 'amount and purchaserName are required' }, { status: 400 })
    }
    if (body.purchaserEmail && !EMAIL_RE.test(body.purchaserEmail)) {
      return NextResponse.json({ error: 'Invalid purchaser email' }, { status: 400 })
    }
    if (body.recipientEmail && !EMAIL_RE.test(body.recipientEmail)) {
      return NextResponse.json({ error: 'Invalid recipient email' }, { status: 400 })
    }

    const settings = await getGiftCardSettings(business.id)
    if (!settings.enabled) {
      return NextResponse.json({ error: 'Gift cards are not available for this shop' }, { status: 403 })
    }

    // Fail closed: online purchase requires a configured online provider.
    let provider
    try {
      provider = resolvePaymentProvider({ paymentInPerson: business.paymentInPerson ?? true })
    } catch {
      provider = undefined
    }
    if (!provider?.online) {
      return NextResponse.json(
        { error: 'Online gift card purchase is unavailable — gift cards can be purchased in the shop' },
        { status: 400 },
      )
    }

    const amount = Math.round(body.amount * 100) / 100
    const result = await prisma.$transaction(async (tx) => {
      const charge = await provider.createCharge(
        { businessId: business.id, tx },
        {
          amount,
          kind: 'CHARGE',
          idempotencyKey: `giftcard-purchase:${Date.now()}`,
          metadata: { giftCardPurchase: true },
        },
      )
      if (!charge.ok) throw new Error(charge.error ?? 'Payment failed')

      const { giftCard } = await sellGiftCard({
        businessId: business.id,
        amount,
        type: 'DIGITAL',
        purchaserName: body.purchaserName!.trim(),
        purchaserEmail: body.purchaserEmail?.trim() ?? null,
        recipientName: body.recipientName?.trim() ?? null,
        recipientEmail: body.recipientEmail?.trim() ?? null,
        message: body.message?.trim() ?? null,
        purchasePaymentId: charge.payment.id,
        tx,
      })
      const clientSecret = (charge.payment.metadata as Record<string, unknown> | null)?.clientSecret as string | undefined
      return { giftCardId: giftCard.id, code: giftCard.code, amount, clientSecret }
    })

    return NextResponse.json(result)
  } catch (error) {
    return handleApiError(error, 'POST /api/gift-cards/purchase')
  }
}

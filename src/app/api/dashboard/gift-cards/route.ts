/**
 * Gift cards: owner list + summary (GET), staff POS sale (POST).
 * Selling follows the shop's POS checkout permissions (owner/admin
 * always; barbers only when the owner enabled barber checkout).
 * Reports (summary) are owner/admin only.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { getPosSettings, canViewShopFinancials } from '@/lib/payments/pos'
import {
  GiftCardError,
  canSellGiftCards,
  giftCardSummary,
  getGiftCardSettings,
  listGiftCards,
  sellGiftCard,
} from '@/lib/gift-cards'

export async function GET(request: Request) {
  try {
    const session = (await getServerSession(authOptions)) as { user?: { role: string; businessId?: string | null } } | null
    const user = session?.user
    if (!user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const search = url.searchParams.get('search') ?? undefined

    const [settings, cards] = await Promise.all([
      getGiftCardSettings(user.businessId),
      listGiftCards(user.businessId, {
        status: status === 'PENDING' || status === 'ACTIVE' || status === 'DEPLETED' ? status : undefined,
        search,
      }),
    ])
    const summary = canViewShopFinancials(user.role) ? await giftCardSummary(user.businessId) : null

    return NextResponse.json({
      enabled: settings.enabled,
      cards: cards.map((c) => ({
        id: c.id,
        code: c.code,
        type: c.type,
        initialValue: c.initialValue,
        remainingBalance: c.remainingBalance,
        status: c.status,
        purchaserName: c.purchaserName,
        recipientName: c.recipientName,
        expiresAt: c.expiresAt,
        createdAt: c.createdAt,
        transactionCount: c.transactionCount,
      })),
      summary,
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/gift-cards')
  }
}

export async function POST(request: Request) {
  try {
    const session = (await getServerSession(authOptions)) as {
      user?: { id: string; role: string; businessId?: string | null }
    } | null
    const user = session?.user
    if (!user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const posSettings = await getPosSettings(user.businessId)
    if (!canSellGiftCards({ role: user.role }, posSettings)) {
      return NextResponse.json({ error: 'Forbidden — not permitted to sell gift cards' }, { status: 403 })
    }

    const body = (await request.json()) as {
      amount?: number
      type?: 'DIGITAL' | 'PHYSICAL'
      purchaserName?: string
      purchaserEmail?: string
      purchaserCustomerId?: string
      recipientName?: string
      recipientEmail?: string
      message?: string
      method?: 'CASH' | 'IN_PERSON' | 'CARD'
    }
    if (!body.amount || !body.purchaserName) {
      return NextResponse.json({ error: 'amount and purchaserName are required' }, { status: 400 })
    }
    const method = body.method ?? 'IN_PERSON'
    if (method !== 'CASH' && method !== 'IN_PERSON' && method !== 'CARD') {
      return NextResponse.json({ error: 'method must be CASH, IN_PERSON or CARD' }, { status: 400 })
    }

    const { giftCard, purchaseTransaction, paymentId } = await sellGiftCard({
      businessId: user.businessId,
      amount: body.amount,
      type: body.type === 'PHYSICAL' ? 'PHYSICAL' : 'DIGITAL',
      purchaserName: body.purchaserName,
      purchaserEmail: body.purchaserEmail,
      purchaserCustomerId: body.purchaserCustomerId,
      recipientName: body.recipientName,
      recipientEmail: body.recipientEmail,
      message: body.message,
      soldByUserId: user.id,
      purchaseMethod: method,
    })

    return NextResponse.json({
      giftCard: {
        id: giftCard.id,
        code: giftCard.code,
        type: giftCard.type,
        initialValue: giftCard.initialValue,
        remainingBalance: giftCard.remainingBalance,
        status: giftCard.status,
        expiresAt: giftCard.expiresAt,
      },
      purchaseTransactionId: purchaseTransaction.id,
      paymentId,
    })
  } catch (error) {
    if (error instanceof GiftCardError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === 'GIFT_CARDS_DISABLED' ? 403 : 400 })
    }
    return handleApiError(error, 'POST /api/dashboard/gift-cards')
  }
}

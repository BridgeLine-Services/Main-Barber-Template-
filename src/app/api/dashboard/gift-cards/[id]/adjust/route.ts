/** Owner manual balance adjustment (physical-card corrections). The
 * balance change is append-only audited via a GiftCardTransaction row. */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { GiftCardError, adjustGiftCardBalance, canManageGiftCards } from '@/lib/gift-cards'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = (await getServerSession(authOptions)) as {
      user?: { id: string; role: string; businessId?: string | null }
    } | null
    const user = session?.user
    if (!user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canManageGiftCards(user.role)) {
      return NextResponse.json({ error: 'Forbidden — owner access required' }, { status: 403 })
    }

    const { id } = await params
    const body = (await request.json()) as { amount?: number; note?: string }
    if (body.amount == null || !Number.isFinite(Number(body.amount)) || Number(body.amount) === 0) {
      return NextResponse.json({ error: 'amount must be a nonzero number (positive adds, negative removes)' }, { status: 400 })
    }

    const giftCard = await adjustGiftCardBalance(user.businessId, id, Number(body.amount), body.note ?? '', user.id)
    return NextResponse.json({ giftCard })
  } catch (error) {
    if (error instanceof GiftCardError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 })
    }
    return handleApiError(error, 'POST /api/dashboard/gift-cards/[id]/adjust')
  }
}

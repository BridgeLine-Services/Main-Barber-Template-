/** Gift card detail + transaction history. Owner/admin only — includes
 * purchaser identity and full balance ledger. */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { canManageGiftCards, getGiftCardDetail } from '@/lib/gift-cards'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = (await getServerSession(authOptions)) as { user?: { role: string; businessId?: string | null } } | null
    const user = session?.user
    if (!user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canManageGiftCards(user.role) && user.role !== 'BUSINESS_ADMIN') {
      return NextResponse.json({ error: 'Forbidden — owner access required' }, { status: 403 })
    }
    const { id } = await params
    const detail = await getGiftCardDetail(user.businessId, id)
    if (!detail) return NextResponse.json({ error: 'Gift card not found' }, { status: 404 })
    return NextResponse.json(detail)
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/gift-cards/[id]')
  }
}

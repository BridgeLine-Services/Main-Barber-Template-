/**
 * Gift card shop settings — OWNER authority (Requirement: owner can enable
 * or disable gift cards). GET exposes only the enabled flag and
 * denominations to any signed-in staff member (the POS needs to know
 * whether to show the gift card field); PATCH is owner-only.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import {
  canManageGiftCards,
  getGiftCardSettings,
  giftCardDenominations,
  DEFAULT_DENOMINATIONS,
  MIN_CUSTOM_AMOUNT,
  MAX_CUSTOM_AMOUNT,
} from '@/lib/gift-cards'

export async function GET() {
  try {
    const session = (await getServerSession(authOptions)) as { user?: { businessId?: string | null } } | null
    if (!session?.user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const settings = await getGiftCardSettings(session.user.businessId)
    return NextResponse.json({
      enabled: settings.enabled,
      denominations: giftCardDenominations(settings),
      defaultValidityMonths: settings.defaultValidityMonths,
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/gift-cards/settings')
  }
}

export async function PATCH(request: Request) {
  try {
    const session = (await getServerSession(authOptions)) as { user?: { role: string; businessId?: string | null } } | null
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canManageGiftCards(user.role)) {
      return NextResponse.json({ error: 'Forbidden — owner access required' }, { status: 403 })
    }

    const body = (await request.json()) as {
      enabled?: boolean
      denominations?: number[]
      defaultValidityMonths?: number
    }

    const data: Record<string, unknown> = {}
    if (typeof body.enabled === 'boolean') data.enabled = body.enabled
    if (Array.isArray(body.denominations)) {
      const parsed = body.denominations
        .map((v) => (typeof v === 'number' ? v : Number(v)))
        .filter((v) => Number.isFinite(v) && v >= MIN_CUSTOM_AMOUNT && v <= MAX_CUSTOM_AMOUNT)
      data.denominations = Array.from(new Set(parsed)).sort((a, b) => a - b).slice(0, 8)
      if (!Array.isArray(data.denominations) || !(data.denominations as number[]).length) {
        data.denominations = DEFAULT_DENOMINATIONS
      }
    }
    if (body.defaultValidityMonths != null) {
      const months = Number(body.defaultValidityMonths)
      if (!Number.isInteger(months) || months < 0 || months > 120) {
        return NextResponse.json({ error: 'defaultValidityMonths must be an integer 0-120 (0 = no expiration)' }, { status: 400 })
      }
      data.defaultValidityMonths = months
    }

    await getGiftCardSettings(user.businessId!) // lazy-create the row
    const settings = await prisma.giftCardSettings.update({
      where: { businessId: user.businessId! },
      data,
    })
    return NextResponse.json({
      enabled: settings.enabled,
      denominations: giftCardDenominations(settings),
      defaultValidityMonths: settings.defaultValidityMonths,
    })
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/gift-cards/settings')
  }
}

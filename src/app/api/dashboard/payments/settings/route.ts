import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { canManageSettings, getPosSettings, tipPresets } from '@/lib/payments/pos'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role === 'CUSTOMER') return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
    const settings = await getPosSettings(session.user.businessId!)
    return NextResponse.json({
      settings: { ...settings, tipPresets: tipPresets(settings) },
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/payments/settings')
  }
}

const NUM = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max

export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // Owner has final authority over the Payments & POS master switch.
    if (!canManageSettings(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden — owner access required' }, { status: 403 })
    }
    const body = (await request.json()) as Record<string, unknown>
    const current = await getPosSettings(session.user.businessId!)

    const data: Record<string, unknown> = {}
    const B = (k: string) => (typeof body[k] === 'boolean' ? (body[k] as boolean) : undefined)
    const F = (k: string, min: number, max: number) => (NUM(body[k], min, max) ? (body[k] as number) : undefined)

    const enabled = B('enabled')
    if (enabled !== undefined) {
      // Fail closed: the switch cannot be ON without a configured provider.
      if (enabled && !process.env.STRIPE_SECRET_KEY) {
        return NextResponse.json(
          { error: 'STRIPE_SECRET_KEY is not configured on this server — Payments & POS cannot be enabled' },
          { status: 400 },
        )
      }
      data.enabled = enabled
    }
    for (const k of [
      'allowBarberCheckout', 'tipsEnabled', 'taxEnabled', 'receiptsEmailEnabled',
      'depositsEnabled', 'cancellationFeeEnabled', 'noShowFeeEnabled',
      'cardOnFileEnabled', 'commissionEnabled',
    ]) {
      const v = B(k)
      if (v !== undefined) data[k] = v
    }
    for (const [k, min, max] of [
      ['taxRatePercent', 0, 50], ['depositValue', 0, 100000], ['cancellationFeeAmount', 0, 10000],
      ['noShowFeeAmount', 0, 10000], ['commissionRatePercent', 0, 100],
    ] as const) {
      const v = F(k, min, max)
      if (v !== undefined) data[k] = v
    }
    if (body.depositType === 'PERCENT' || body.depositType === 'FLAT') data.depositType = body.depositType
    if (Array.isArray(body.tipPresets)) {
      const presets = body.tipPresets
        .map((v) => (typeof v === 'number' ? v : Number(v)))
        .filter((v) => Number.isFinite(v) && v >= 0 && v <= 100)
        .slice(0, 6)
      data.tipPresets = presets
    }

    const settings = await prisma.paymentSettings.update({
      where: { businessId: session.user.businessId! },
      data,
    })
    void current
    return NextResponse.json({ settings: { ...settings, tipPresets: tipPresets(settings) } })
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/payments/settings')
  }
}

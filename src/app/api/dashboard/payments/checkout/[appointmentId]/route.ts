import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import {
  buildCheckoutSummary, canRunCheckout, completeCheckout,
  getPosSettings, type CheckoutLineItem,
} from '@/lib/payments/pos'

type DashUser = { id?: string | null; role: string; businessId?: string | null; barberId?: string | null }

interface Guard {
  ok: boolean
  error?: NextResponse
  businessId?: string
  appointment?: { businessId: string; barberId: string }
}

/** Shared role + ownership guard: barbers only see their own appointments. */
async function guard(appointmentId: string): Promise<Guard> {
  const session = (await getServerSession(authOptions)) as { user?: DashUser } | null
  const user = session?.user
  if (!user) return { ok: false, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (user.role === 'CUSTOMER') return { ok: false, error: NextResponse.json({ error: 'Staff access required' }, { status: 403 }) }
  const businessId = user.businessId!
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, businessId },
    select: { businessId: true, barberId: true },
  })
  if (!appointment) return { ok: false, error: NextResponse.json({ error: 'Appointment not found' }, { status: 404 }) }
  const settings = await getPosSettings(businessId)
  const perm = canRunCheckout(user, settings, appointment)
  if (!perm.ok) return { ok: false, error: NextResponse.json({ error: perm.reason }, { status: 403 }) }
  return { ok: true, businessId, appointment }
}

// GET: checkout summary for one appointment (tenant + role scoped)
export async function GET(_request: Request, { params }: { params: Promise<{ appointmentId: string }> }) {
  try {
    const { appointmentId } = await params
    const g = await guard(appointmentId)
    if (!g.ok) return g.error
    const summary = await buildCheckoutSummary(g.businessId, appointmentId)
    if (!summary) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    return NextResponse.json({ summary })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/payments/checkout/[appointmentId]')
  }
}

// POST: complete checkout at the shop (cash / in-person / manual card)
export async function POST(request: Request, { params }: { params: Promise<{ appointmentId: string }> }) {
  try {
    const session = (await getServerSession(authOptions)) as { user?: DashUser } | null
    const { appointmentId } = await params
    const g = await guard(appointmentId)
    if (!g.ok) return g.error

    const body = (await request.json()) as {
      method?: string
      lineItems?: CheckoutLineItem[]
      discountAmount?: number
      tipAmount?: number
      tipPercent?: number
      giftCardCode?: string
    }
    const method = body.method
    if (method !== 'CASH' && method !== 'IN_PERSON' && method !== 'CARD') {
      return NextResponse.json({ error: 'method must be CASH, IN_PERSON or CARD (terminal)' }, { status: 400 })
    }

    const result = await completeCheckout({
      businessId: g.businessId,
      appointmentId,
      actorId: session!.user!.id!,
      actorRole: session!.user!.role!,
      method,
      lineItems: body.lineItems,
      discountAmount: body.discountAmount,
      tipAmount: body.tipAmount,
      tipPercent: body.tipPercent,
      giftCardCode: typeof body.giftCardCode === 'string' && body.giftCardCode.trim() ? body.giftCardCode : undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/payments/checkout/[appointmentId]')
  }
}

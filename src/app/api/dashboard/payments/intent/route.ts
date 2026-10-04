import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { resolvePaymentProvider, stripeConfigured } from '@/lib/payments'
import { canRunCheckout, getPosSettings } from '@/lib/payments/pos'

/**
 * Create an ONLINE charge (Stripe PaymentIntent) for an appointment:
 * deposit, full payment, tip, cancellation or no-show fee. Staff calls
 * this; the customer confirms the card client-side (Elements) via the
 * clientSecret returned here. Server-side only; the secret key never
 * leaves the server.
 */
export async function POST(request: Request) {
  try {
    const session = (await getServerSession(authOptions)) as { user?: { id?: string | null; role: string; businessId?: string | null; barberId?: string | null } } | null
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role === 'CUSTOMER') return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
    const businessId = user.businessId!
    const settings = await getPosSettings(businessId)
    if (!settings.enabled) return NextResponse.json({ error: 'Payments & POS is disabled' }, { status: 400 })
    if (!stripeConfigured()) {
      return NextResponse.json({ error: 'Stripe is not configured on this server (STRIPE_SECRET_KEY)' }, { status: 400 })
    }

    const body = (await request.json()) as {
      kind?: string
      amount?: number
      appointmentId?: string
      customerId?: string
    }
    const kind = body.kind
    if (kind !== 'DEPOSIT' && kind !== 'CHARGE' && kind !== 'TIP' && kind !== 'CANCELLATION_FEE' && kind !== 'NO_SHOW_FEE') {
      return NextResponse.json({ error: 'kind must be DEPOSIT, CHARGE, TIP, CANCELLATION_FEE or NO_SHOW_FEE' }, { status: 400 })
    }
    if (!body.amount || body.amount <= 0) return NextResponse.json({ error: 'amount must be positive' }, { status: 400 })

    // Role/ownership: appointments are barber-scoped for BARBER role.
    if (body.appointmentId) {
      const appointment = await prisma.appointment.findFirst({
        where: { id: body.appointmentId, businessId },
        select: { businessId: true, barberId: true },
      })
      if (!appointment) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
      const perm = canRunCheckout(user, settings, appointment)
      if (!perm.ok) return NextResponse.json({ error: perm.reason }, { status: 403 })
    }

    const provider = resolvePaymentProvider({ paymentInPerson: false }) // online path
    const result = await prisma.$transaction((tx) =>
      provider.createCharge(
        { businessId, tx },
        {
          amount: Math.round(body.amount! * 100) / 100,
          kind,
          appointmentId: body.appointmentId,
          customerId: body.customerId,
          idempotencyKey: `intent:${kind}:${body.appointmentId ?? 'shop'}:${user.id}:${Date.now()}`,
          metadata: { createdBy: user.id, kind },
        },
      ),
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    const clientSecret = ((result.payment.metadata ?? {}) as Record<string, unknown>).clientSecret as string | undefined
    return NextResponse.json({
      paymentId: result.payment.id,
      clientSecret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null,
    })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/payments/intent')
  }
}

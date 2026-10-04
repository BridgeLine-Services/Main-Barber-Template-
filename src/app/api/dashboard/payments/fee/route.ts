import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { chargeFee, getPosSettings } from '@/lib/payments/pos'

/**
 * Charge a policy fee (cancellation / no-show) for an appointment.
 * Owner/admin always; barbers only for their own appointments when the
 * owner allows barber checkout. `method: CASH|IN_PERSON|CARD` records a
 * fee collected at the shop; `online: true` creates a Stripe intent
 * the customer pays remotely (clientSecret returned).
 */
export async function POST(request: Request) {
  try {
    const session = (await getServerSession(authOptions)) as { user?: { role: string; businessId?: string | null; barberId?: string | null } } | null
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role === 'CUSTOMER') return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
    const businessId = user.businessId!
    const settings = await getPosSettings(businessId)
    if (!settings.enabled) return NextResponse.json({ error: 'Payments & POS is disabled' }, { status: 400 })

    const body = (await request.json()) as {
      kind?: 'CANCELLATION_FEE' | 'NO_SHOW_FEE'
      amount?: number
      appointmentId?: string
      method?: 'CASH' | 'IN_PERSON' | 'CARD'
      online?: boolean
    }
    if (body.kind !== 'CANCELLATION_FEE' && body.kind !== 'NO_SHOW_FEE') {
      return NextResponse.json({ error: 'kind must be CANCELLATION_FEE or NO_SHOW_FEE' }, { status: 400 })
    }
    if (!body.appointmentId) return NextResponse.json({ error: 'appointmentId is required' }, { status: 400 })

    const appointment = await prisma.appointment.findFirst({
      where: { id: body.appointmentId, businessId },
      select: { id: true, customerId: true, barberId: true },
    })
    if (!appointment) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })

    // Barbers can only charge fees on their own appointments.
    if (user.role === 'BARBER' && (appointment.barberId !== user.barberId || !settings.allowBarberCheckout)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Amount defaults come from the owner's policy configuration.
    const amount =
      body.amount != null && body.amount > 0
        ? body.amount
        : body.kind === 'CANCELLATION_FEE'
          ? (settings.cancellationFeeEnabled ? settings.cancellationFeeAmount : 0)
          : (settings.noShowFeeEnabled ? settings.noShowFeeAmount : 0)
    if (!amount) {
      return NextResponse.json({ error: `No ${body.kind === 'CANCELLATION_FEE' ? 'cancellation fee' : 'no-show fee'} configured or amount missing` }, { status: 400 })
    }

    const result = await chargeFee({
      businessId,
      kind: body.kind,
      amount,
      appointmentId: appointment.id,
      customerId: appointment.customerId,
      method: body.online ? undefined : (body.method ?? 'IN_PERSON'),
      online: body.online,
    })
    return NextResponse.json(result)
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/payments/fee')
  }
}

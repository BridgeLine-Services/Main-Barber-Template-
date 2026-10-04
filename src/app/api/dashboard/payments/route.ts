import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { getPosSettings } from '@/lib/payments/pos'

/** Payment history — always tenant-isolated; barbers see only their own rows. */
export async function GET(request: Request) {
  try {
    const session = (await getServerSession(authOptions)) as { user?: { role: string; businessId?: string | null; barberId?: string | null } } | null
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role === 'CUSTOMER') return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
    const businessId = user.businessId!

    const settings = await getPosSettings(businessId)
    if (!settings.enabled) return NextResponse.json({ payments: [], posEnabled: false })

    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const where: Record<string, unknown> = { businessId }
    if (user.role === 'BARBER') where.barberId = user.barberId ?? '__none__' // own rows only
    if (searchParams.get('barberId')) {
      if (user.role === 'BARBER' && searchParams.get('barberId') !== user.barberId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      where.barberId = searchParams.get('barberId')
    }
    if (searchParams.get('method')) where.method = searchParams.get('method')
    if (searchParams.get('status')) where.status = searchParams.get('status')
    if (searchParams.get('kind')) where.kind = searchParams.get('kind')
    if (searchParams.get('appointmentId')) where.appointmentId = searchParams.get('appointmentId')
    if (searchParams.get('customerId')) where.customerId = searchParams.get('customerId')
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(`${to.slice(0, 10)}T23:59:59.999Z`) } : {}),
      }
    }

    const payments = await prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(searchParams.get('limit') ?? '200', 10) || 200, 500),
      include: {
        barber: { select: { id: true, name: true } },
        customer: { select: { id: true, firstName: true, lastName: true, email: true } },
        appointment: { select: { id: true, confirmationNumber: true, startTime: true } },
        originalPayment: { select: { id: true, kind: true, amount: true } },
      },
    })
    return NextResponse.json({ payments, posEnabled: true })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/payments')
  }
}

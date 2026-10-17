/**
 * Dashboard ecommerce: order list + stats (session-scoped).
 * GET /api/dashboard/ecommerce/orders
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import { listOrders, orderStats } from '@/lib/ecommerce'

type SessionUser = { role: string; businessId?: string | null }

export async function GET(request: Request) {
  try {
    const session = (await getServerSession(authOptions)) as { user?: SessionUser } | null
    const user = session?.user
    if (!user?.businessId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const status = new URL(request.url).searchParams.get('status') ?? undefined
    const valid = ['PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELED', 'PAYMENT_FAILED', 'REFUNDED'] as const
    const orders = await listOrders(user.businessId, {
      status: (valid as readonly string[]).includes(status as string) ? (status as (typeof valid)[number]) : undefined,
    })
    return NextResponse.json({ orders, stats: await orderStats(user.businessId) })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/ecommerce/orders')
  }
}

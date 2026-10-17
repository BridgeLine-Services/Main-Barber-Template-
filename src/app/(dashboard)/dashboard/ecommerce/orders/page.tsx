import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { OrdersClient } from './OrdersClient'

/**
 * Shop order management: list orders with items and stats, filter by status,
 * advance fulfillment (PAID → PROCESSING → SHIPPED → DELIVERED with optional
 * tracking), cancel with restock, and refund through the shop's payment
 * provider. All mutations go through /api/dashboard/ecommerce/orders/[id]
 * (session-scoped, tenant-checked, state-machine enforced).
 */
export default async function ShopOrdersPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const user = session.user
  if (!user.businessId || (user.role !== 'OWNER' && user.role !== 'PLATFORM_OWNER' && user.role !== 'BUSINESS_ADMIN')) {
    redirect('/dashboard')
  }

  return <OrdersClient />
}

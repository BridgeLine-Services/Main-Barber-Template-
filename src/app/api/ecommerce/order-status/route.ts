/**
 * Public order status lookup for the checkout confirmation screen.
 * GET /api/ecommerce/order-status?slug=&orderId=&email=
 *
 * Guest checkout has no session, so this endpoint gates on BOTH the order id
 * and the order's email (case-insensitive). It returns only the minimal
 * status payload — no customer record, no address, no line items — so a
 * leaked order id alone reveals nothing.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams
    const slug = params.get('slug')
    const orderId = params.get('orderId')
    const email = params.get('email')?.trim().toLowerCase()
    if (!slug || !orderId || !email) {
      return NextResponse.json({ error: 'Missing order reference' }, { status: 400 })
    }
    const business = await prisma.business.findUnique({ where: { slug }, select: { id: true } })
    if (!business) return NextResponse.json({ error: 'Shop not found' }, { status: 404 })

    const order = await prisma.shopOrder.findFirst({
      where: { id: orderId, businessId: business.id },
      select: { status: true, orderNumber: true, email: true },
    })
    if (!order || order.email.trim().toLowerCase() !== email) {
      // Same response for "not found" and "wrong email": no enumeration.
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    return NextResponse.json({ status: order.status, orderNumber: order.orderNumber })
  } catch (error) {
    return handleApiError(error, 'GET /api/ecommerce/order-status')
  }
}

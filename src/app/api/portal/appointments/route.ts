export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveBusiness } from '@/lib/tenant'
import { resolveSessionCustomer } from '@/lib/customer-link'

// ============================================================================
// AUTHENTICATED CUSTOMER PORTAL — appointments (upcoming + history).
//
// IDOR protection: the customer is resolved from the session, and the query
// is scoped to that customer id + the resolved business. Query parameters
// like ?customerId= are ignored entirely.
// ============================================================================

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || role !== 'CUSTOMER') {
    return NextResponse.json({ error: 'Sign in to your customer account to use the portal.' }, { status: 401 })
  }

  const business = await resolveBusiness()
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 })

  const resolved = await resolveSessionCustomer(session, business.id)
  if (!resolved) {
    // Not an error: a customer who has never booked here yet.
    return NextResponse.json({ upcoming: [], history: [], preferences: null })
  }

  const { prisma } = await import('@/lib/prisma')
  const appointments = await prisma.appointment.findMany({
    where: { customerId: resolved.customer.id, businessId: business.id },
    select: {
      id: true,
      confirmationNumber: true,
      status: true,
      startTime: true,
      endTime: true,
      barber: { select: { id: true, name: true } },
      service: { select: { id: true, name: true, duration: true, price: true } },
    },
    orderBy: { startTime: 'desc' },
  })

  const now = new Date()
  const upcoming = appointments.filter(a => a.startTime >= now && !['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(a.status))
  const history = appointments.filter(a => a.startTime < now || ['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(a.status))

  return NextResponse.json({
    upcoming,
    history,
    preferences: resolved.customer.preferences ?? null,
  })
}

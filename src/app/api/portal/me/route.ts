export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveBusiness } from '@/lib/tenant'
import { resolveSessionCustomer } from '@/lib/customer-link'

// ============================================================================
// AUTHENTICATED CUSTOMER PORTAL — profile endpoint.
//
// The customer is resolved from the authenticated session → account email →
// customer record of the resolved business. NO identifier from the browser
// (customerId, userId, businessId) is ever trusted.
// ============================================================================

export async function GET() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || role !== 'CUSTOMER') {
    return NextResponse.json({ error: 'Sign in to your customer account to use the portal.' }, { status: 401 })
  }

  const business = await resolveBusiness()
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 })

  const resolved = await resolveSessionCustomer(session, business.id)

  return NextResponse.json({
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
    },
    business: { id: business.id, name: business.name },
    customer: resolved
      ? {
          id: resolved.customer.id,
          firstName: resolved.customer.firstName,
          lastName: resolved.customer.lastName,
          email: resolved.customer.email,
          phone: resolved.customer.phone,
          smsConsent: resolved.customer.smsConsent,
          preferences: resolved.customer.preferences,
        }
      : null,
  })
}

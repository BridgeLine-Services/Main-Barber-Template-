import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveBusiness } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

export async function GET() {
  const business = await resolveBusiness().catch(() => null)
  if (!business) return NextResponse.json({ policies: [], version: null })

  const policies = {
    booking: business.bookingPolicy,
    cancellation: business.cancellationPolicy,
    late: business.latePolicy,
    noShow: business.noShowPolicyText,
    payment: business.paymentPolicy,
    privacy: business.privacyPolicy,
    terms: business.termsPolicy,
  }
  const hasPolicies = Object.values(policies).some(Boolean)

  return NextResponse.json({
    policies: hasPolicies ? policies : {},
    version: hasPolicies ? business.updatedAt.toISOString() : null,
    booking: {
      // Public booking-flow config — used by the wizard to show/hide the
      // "First available" option. Defaults to enabled for legacy rows.
      firstAvailableEnabled: business.firstAvailableBookingEnabled !== false,
    },
  })
}

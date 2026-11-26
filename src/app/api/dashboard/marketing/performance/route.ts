export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { withTenant } from '@/lib/tenant-context'
import { handleApiError } from '@/lib/api-errors'
import { marketingPerformance } from '@/lib/marketing/performance'

/**
 * GET /api/dashboard/marketing/performance
 *
 * Campaign reach, booking-source attribution and repeat visits for one shop. Owners and
 * business admins only, tenant-bound, and honest about what the schema does not record:
 * the response carries `notMeasurable` rather than a revenue figure it cannot support.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const role = session.user?.role
    if (!['OWNER', 'BUSINESS_ADMIN'].includes(role as string)) {
      return NextResponse.json({ error: 'Owner or business admin access required' }, { status: 403 })
    }
    const businessId = session.user?.businessId
    if (!businessId) return NextResponse.json({ error: 'No shop is attached to this session.' }, { status: 401 })

    const data = await withTenant(businessId, async (tx) => {
      const [campaigns, attributions, visits] = await Promise.all([
        tx.marketingCampaign.findMany({
          where: { businessId },
          select: { id: true, name: true, audience: true, status: true, sentAt: true, recipientCount: true },
        }),
        tx.referralAttribution.findMany({
          where: { businessId },
          select: { customerId: true, source: true, referrerCustomerId: true },
        }),
        tx.appointment.findMany({
          where: { businessId, status: 'COMPLETED' },
          select: { customerId: true, startTime: true, status: true },
        }),
      ])
      return { campaigns, attributions, visits }
    })

    return NextResponse.json(
      marketingPerformance({
        campaigns: data.campaigns.map((row) => ({ ...row, audience: String(row.audience), status: String(row.status) })),
        attributions: data.attributions,
        visits: data.visits.filter((visit): visit is typeof visit & { customerId: string } => Boolean(visit.customerId)),
      }),
    )
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/marketing/performance')
  }
}

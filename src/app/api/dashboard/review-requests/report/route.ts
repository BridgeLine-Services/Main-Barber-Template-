import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusinessIdForUser, requireBusinessAdmin } from '@/lib/auth-helpers'

export const dynamic = 'force-dynamic'

function periodStart(value: string | null) {
  const days = Math.min(365, Math.max(1, Number(value) || 30))
  return new Date(Date.now() - days * 86400000)
}

export async function GET(request: NextRequest) {
  const auth = await requireBusinessAdmin()
  if (!auth.success) return auth.response
  const businessId = await getBusinessIdForUser(auth.user)
  const since = periodStart(request.nextUrl.searchParams.get('days'))

  const [eligible, requests, skippedReasons] = await Promise.all([
    prisma.appointment.count({ where: { businessId, status: 'COMPLETED', updatedAt: { gte: since } } }),
    prisma.reviewRequest.groupBy({
      by: ['status'],
      where: { businessId, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.reviewRequest.groupBy({
      by: ['skipReason'],
      where: { businessId, status: 'SKIPPED', createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ])

  const counts = Object.fromEntries(requests.map((row) => [row.status.toLowerCase(), row._count._all]))
  const scheduled = Object.values(counts).reduce((sum, count) => sum + count, 0)
  return NextResponse.json({
    since: since.toISOString(),
    eligible,
    scheduled,
    pending: counts.pending ?? 0,
    sent: counts.sent ?? 0,
    failed: counts.failed ?? 0,
    skipped: counts.skipped ?? 0,
    canceled: counts.canceled ?? 0,
    sendRate: scheduled ? Math.round(((counts.sent ?? 0) / scheduled) * 100) : 0,
    skippedReasons: skippedReasons.map((row) => ({ reason: row.skipReason || 'Unspecified', count: row._count._all })),
    deliveryTracking: false,
    clickTracking: false,
  })
}

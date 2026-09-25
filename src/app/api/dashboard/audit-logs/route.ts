export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { getBusinessIdForUser } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'

/**
 * GET /api/dashboard/audit-logs
 * Returns audit logs (OWNER only), paginated
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    try {
      const businessId = await getBusinessIdForUser(auth.user)
      const searchParams = req.nextUrl.searchParams
      const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
      const offset = parseInt(searchParams.get('offset') || '0')
      const action = searchParams.get('action')
      const where: any = { businessId }
      if (action) {
        where.action = action
      }
      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          include: {
            user: {
              select: { name: true, email: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.auditLog.count({ where }),
      ])
      return NextResponse.json({ logs, total, hasMore: offset + logs.length < total })
    } catch (error: any) {
      console.error('[audit-logs] request failed', error)
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/audit-logs')
  }
}

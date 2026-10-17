/**
 * Review Requests (Prompt 9) — dashboard list + summary.
 *
 * GET /api/dashboard/review-requests?status=PENDING&cursor=...&take=25
 *   Returns the shop-scoped delivery table + summary counts.
 *   Only sanitized data is exposed (destination host, never full URLs,
 *   customer emails, or raw provider payloads).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireBusinessAdmin, getBusinessIdForUser } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'
import { ReviewRequestStatus } from '@prisma/client'
import { getReviewRequestSummary, listReviewRequests } from '@/lib/review-requests'

const VALID_STATUSES = ['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SUPPRESSED', 'CANCELLED'] as const

export async function GET(req: NextRequest) {
  try {
    const auth = await requireBusinessAdmin()
    if (!auth.success) return auth.response
    const businessId = await getBusinessIdForUser(auth.user)

    const statusParam = req.nextUrl.searchParams.get('status')
    const status =
      statusParam && (VALID_STATUSES as readonly string[]).includes(statusParam)
        ? (statusParam as ReviewRequestStatus)
        : undefined
    const skip = Math.max(0, Math.min(1000, Number(req.nextUrl.searchParams.get('skip')) || 0))
    const take = Math.max(1, Math.min(100, Number(req.nextUrl.searchParams.get('take')) || 25))

    const [rows, summary] = await Promise.all([
      listReviewRequests(businessId, { status, skip, take }),
      getReviewRequestSummary(businessId),
    ])
    return NextResponse.json({ rows, summary })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/review-requests')
  }
}

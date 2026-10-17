export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { enqueueDueReviewRequests, processDueReviewRequests } from '@/lib/review-requests'

/**
 * Enqueue and deliver due review requests. The worker is idempotent and safe
 * under concurrent invocations; CRON_SECRET protects this endpoint.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const enqueue = await enqueueDueReviewRequests()
    const delivery = await processDueReviewRequests()
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      enqueue,
      delivery,
    })
  } catch (error) {
    console.error('[cron] review request processing failed', error)
    return NextResponse.json({ error: 'Failed to process review requests' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { enqueueDueReviewRequests, processDueReviewRequests } from '@/lib/review-requests'

/**
 * GET /api/cron/review-requests
 * Two-phase worker (Prompt 9):
 *   1. enqueue — scan recently COMPLETED appointments and create the due
 *      queue (idempotent; one row per appointment ever)
 *   2. process — atomically claim + send due requests with bounded retries
 *
 * Protected by CRON_SECRET — must match Authorization header.
 * Safe to run at any cadence and safe under concurrent invocation (the claim
 * is a compare-and-set; concurrent workers cannot double-send).
 *
 * Vercel cron config (vercel.json):
 *   { "crons": [{ "path": "/api/cron/review-requests", "schedule": "0 * * * *" }] }
 */

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
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

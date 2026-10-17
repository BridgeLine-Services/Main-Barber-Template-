export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { processReviewRequests } from '@/lib/review-requests'
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try { return NextResponse.json({ success: true, summary: await processReviewRequests() }) }
  catch (error) { console.error('[cron] review requests failed', error); return NextResponse.json({ error: 'Failed to process review requests' }, { status: 500 }) }
}

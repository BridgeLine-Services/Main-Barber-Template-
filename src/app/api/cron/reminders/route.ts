export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { processDueNotifications } from '@/lib/notification-worker'
import { isRemindersEnabled } from '@/lib/env-check'

/**
 * GET /api/cron/reminders
 * Called by Vercel Cron once daily (9 AM).
 * Sends booking reminders for all confirmed appointments happening
 * in the next 24 hours that haven't received a reminder yet.
 *
 * Protected by CRON_SECRET — must match Authorization header.
 *
 * Vercel cron config (vercel.json):
 *   { "crons": [{ "path": "/api/cron/reminders", "schedule": "0 9 * * *" }] }
 *
 * Note: Hobby plans are limited to once-per-day cron jobs with ±59 min precision.
 * For sub-daily reminders (3h, 1h, 30min), upgrade to Vercel Pro and restore
 * the multi-window schedule.
 */

export async function GET(req: NextRequest) {
  if (!isRemindersEnabled()) return NextResponse.json({ error: 'Reminders are disabled' }, { status: 404 })
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await processDueNotifications()
    return NextResponse.json({ success: true, timestamp: new Date().toISOString(), summary })
  } catch (error) {
    console.error('[cron] notification processing failed', error)
    return NextResponse.json({ error: 'Failed to process notifications' }, { status: 500 })
  }
}

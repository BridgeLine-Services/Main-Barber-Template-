export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/memberships
 * Durable membership period processing (prompt 6D) — runs via Vercel Cron
 * (vercel.json), protected by CRON_SECRET like the reminders job.
 *
 * For EVERY business with memberships enabled (the per-business feature
 * flag is the tenant scope — data never crosses tenants):
 *   - ACTIVE + period ended + autoRenew      -> PAST_DUE  (a verified
 *     renewal only happens via a provider invoice.paid webhook; this job
 *     NEVER invents a charge)
 *   - ACTIVE + period ended + !autoRenew     -> CANCELED
 *   - PAST_DUE + grace elapsed              -> EXPIRED
 *
 * Idempotency: every transition is guarded by the membership status +
 * period timestamps, so a re-run (or a missed day followed by a catch-up
 * run) converges on the same state without duplicate effects.
 *
 * Schedule: hourly is enough (grace is measured in days). Vercel Hobby
 * plans are limited to daily crons — the job is safe to run once daily.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { processMembershipPeriodEnds } from '@/lib/memberships'

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Only businesses whose featureOverrides enable memberships. Each
    // business's rows are processed independently (tenant-scoped by
    // processMembershipPeriodEnds's businessId filter).
    const businesses = await prisma.business.findMany({
      select: { id: true },
      where: { featureOverrides: { path: ['memberships'], equals: true } },
    })
    const report: Record<string, unknown>[] = []
    let processed = 0
    let errors = 0
    for (const business of businesses) {
      try {
        const outcome = await processMembershipPeriodEnds(business.id)
        processed += outcome.processed
        if (outcome.processed > 0) report.push({ businessId: business.id, ...outcome })
      } catch (err) {
        errors++
        console.error(`membership period processing failed for ${business.id}`, err)
      }
    }
    return NextResponse.json({
      ok: errors === 0,
      businesses: businesses.length,
      processed,
      errors,
      detail: report,
    })
  } catch (error) {
    console.error('membership cron failed', error)
    return NextResponse.json({ error: 'Membership processing failed' }, { status: 500 })
  }
}

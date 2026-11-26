import { NextRequest, NextResponse } from 'next/server'
import { processDueNotifications } from '@/lib/notification-worker'
import { enqueueDueOrganizationReports } from '@/lib/organization/scheduled-report'
import { ORGANIZATION_REPORT_CRON_FLAG, organizationReportCronEnabled } from '@/lib/cron-flags'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  // Switched off means switched off: no enqueueing, no delivery, no secret needed, and a
  // successful answer so the platform does not treat the skip as a failure.
  if (!organizationReportCronEnabled()) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: `${ORGANIZATION_REPORT_CRON_FLAG} is not set to true, so no report was processed.`,
    })
  }

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const scheduling = await enqueueDueOrganizationReports()
    const delivery = await processDueNotifications(50, { notificationType: 'ORGANIZATION_REPORT' })
    return NextResponse.json({ success: true, timestamp: new Date().toISOString(), scheduling, delivery })
  } catch {
    console.error('[cron] organization report processing failed')
    return NextResponse.json({ error: 'Failed to process scheduled reports' }, { status: 500 })
  }
}

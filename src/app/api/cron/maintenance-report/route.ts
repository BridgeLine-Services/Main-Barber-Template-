export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The scheduled maintenance report.
 *
 * CRON_SECRET protects this endpoint, like the other scheduled jobs. It gathers what the
 * platform can actually see right now and returns the report plus its Markdown form. Where a
 * source cannot answer, the section says so: a report that cannot check security advisories
 * offline says it could not check them, rather than implying the shop is clear.
 *
 * Nothing is written and nothing is repaired. Generation is a read-only operation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildReadinessReport } from '@/lib/health'
import { TEMPLATE_VERSION } from '@/lib/template-version'
import { manifestVersions, postgresMajor, withLiveVersions } from '@/lib/platform-reliability/installed-versions'
import { compatibilityReport } from '@/lib/platform-reliability/compatibility'
import { evaluateRecovery, type BackupEvidence, type RestoreEvidence } from '@/lib/platform-reliability/recovery-verification'
import { buildScheduledReport, renderReportMarkdown, type ReportState } from '@/lib/platform-reliability/scheduled-report'

const CHECK_TO_STATE: Record<string, ReportState> = {
  ok: 'healthy',
  degraded: 'needs-attention',
  unavailable: 'action-required',
  not_configured: 'needs-attention',
  unknown: 'unable-to-verify',
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  try {
    const readiness = await buildReadinessReport(now)
    const failedChecks = readiness.checks.filter((check) => check.status !== 'ok').map((check) => check.name)
    const worst = readiness.checks.reduce<ReportState>((acc, check) => {
      const state = CHECK_TO_STATE[check.status] ?? 'unable-to-verify'
      const rank: Record<ReportState, number> = { healthy: 0, 'needs-attention': 1, 'unable-to-verify': 2, 'action-required': 3 }
      return rank[state] > rank[acc] ? state : acc
    }, 'healthy')

    const health = {
      state: worst,
      headline: worst === 'healthy' ? 'Every check passed.' : `${failedChecks.length} check${failedChecks.length === 1 ? '' : 's'} need attention.`,
      detail: failedChecks.length === 0
        ? 'The readiness checks ran and every one passed.'
        : `These checks need attention: ${failedChecks.join(', ')}.`,
      failedChecks,
    }

    const backupRows = await prisma.backupRun.findMany({
      where: { kind: 'database', status: 'succeeded' },
      orderBy: { startedAt: 'desc' },
      take: 20,
      select: { id: true, startedAt: true, sizeBytes: true, verifiedAt: true },
    })
    const backups: BackupEvidence[] = backupRows.map((row) => ({
      id: row.id,
      createdAt: row.startedAt.toISOString(),
      sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
      checksumVerifiedAt: row.verifiedAt?.toISOString() ?? null,
    }))

    const drillRows = await prisma.restoreDrill.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
      select: { id: true, backupId: true, startedAt: true, completedAt: true, tablesRestored: true, rowsCompared: true, rowCountsMatched: true, status: true, detail: true },
    })
    const restores: RestoreEvidence[] = drillRows.map((row) => ({
      id: row.id,
      backupId: row.backupId ?? '',
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      tablesRestored: row.tablesRestored,
      rowsCompared: row.rowsCompared,
      rowCountsMatched: row.rowCountsMatched,
      errors: row.status === 'succeeded' ? [] : [row.detail ?? 'The drill did not succeed.'],
    }))

    const [pendingApprovals, failedRepairs] = await Promise.all([
      prisma.maintenanceAction.count({ where: { approvalState: 'proposed' } }),
      prisma.maintenanceAction.count({ where: { executionState: 'failed' } }),
    ])

    let postgresVersion: string | null = null
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ server_version: string }>>(`SELECT current_setting('server_version') AS server_version`)
      postgresVersion = postgresMajor(rows[0]?.server_version)
    } catch {
      postgresVersion = null
    }

    const compatibility = compatibilityReport(withLiveVersions(manifestVersions(), { postgres: postgresVersion }))

    const report = buildScheduledReport({
      generatedAt: now.toISOString(),
      templateVersion: TEMPLATE_VERSION.version,
      health,
      // Advisories and update checks need the network; this job does not reach for it, so
      // it reports honestly that those sections were not checked.
      advisories: null,
      compatibility,
      updates: null,
      recovery: evaluateRecovery(backups, restores, now),
      pendingApprovals,
      failedRepairs,
    })

    return NextResponse.json({ report, markdown: renderReportMarkdown(report) })
  } catch (error) {
    console.error('[cron] maintenance report failed', error)
    return NextResponse.json({ error: 'The maintenance report could not be built.' }, { status: 500 })
  }
}

/**
 * Payroll report status transitions API (owner-only).
 *
 * POST /api/dashboard/payroll/reports/[id]/status   { status: 'REVIEWED' | 'EXPORTED' | 'FINALIZED' }
 *
 * Forward-only lifecycle: DRAFT → REVIEWED → EXPORTED → FINALIZED, with
 * direct finalization allowed from any non-finalized state. Backwards or
 * repeated transitions are rejected (400). Finalizing locks the frozen
 * snapshot: from then on, ONLY manual adjustments (audit trail) change
 * the effective numbers — finalized data is never silently modified.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireOwner, logAudit, toAuditJson } from '@/lib/auth-helpers'
import { setPayrollReportStatus, getPayrollReport, PayrollError } from '@/lib/payroll'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const { id } = await params
    const businessId = auth.user.businessId!

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const target = body.status
    if (target !== 'REVIEWED' && target !== 'EXPORTED' && target !== 'FINALIZED') {
      return NextResponse.json(
        { error: 'status must be REVIEWED | EXPORTED | FINALIZED' },
        { status: 400 }
      )
    }

    try {
      const before = await getPayrollReport(businessId, id) // tenant check
      const { report } = await setPayrollReportStatus(businessId, id, target)
      await logAudit({
        userId: auth.user.id,
        businessId,
        action: 'PAYROLL_REPORT_STATUS_CHANGED',
        entityType: 'PayrollReport',
        entityId: report.id,
        oldValues: toAuditJson({ status: before.report.status }),
        newValues: toAuditJson({
          status: report.status,
          description: `Payroll report ${report.periodLabel} moved to ${target}` +
            (target === 'FINALIZED' ? ' (snapshot locked; adjustments only)' : ''),
        }),
      })
      return NextResponse.json({ report })
    } catch (e) {
      if (e instanceof PayrollError) {
        const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'INVALID_TRANSITION' ? 400 : 400
        return NextResponse.json({ error: e.message, code: e.code }, { status })
      }
      throw e
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/payroll/reports/[id]/status')
  }
}

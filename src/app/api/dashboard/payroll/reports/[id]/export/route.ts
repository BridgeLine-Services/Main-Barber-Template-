/**
 * Payroll report CSV export API (owner-only).
 *
 * GET /api/dashboard/payroll/reports/[id]/export
 *
 * Clean per-barber CSV — Barber, Pay Period, Regular Hours, Overtime
 * Hours, Service Revenue, Tips, Commission, Adjustments, Estimated
 * Payout — plus a TOTAL row. Effective values (manual adjustments applied
 * on top of the frozen snapshot). Marks the report EXPORTED (from DRAFT or
 * REVIEWED; already-EXPORTED/FINALIZED reports re-export freely) and
 * audits every export. Payroll-ready DATA only: this app is not a payroll
 * processor and never issues payments.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireOwner, logAudit } from '@/lib/auth-helpers'
import { getPayrollReport, setPayrollReportStatus, payrollReportCsv, PayrollError } from '@/lib/payroll'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const { id } = await params
    const businessId = auth.user.businessId!

    const { report, lines } = await getPayrollReport(businessId, id)

    // Moving to EXPORTED is a state transition, not a mutation of numbers.
    if (report.status === 'DRAFT' || report.status === 'REVIEWED') {
      await setPayrollReportStatus(businessId, id, 'EXPORTED')
    }

    const csv = payrollReportCsv({ periodLabel: report.periodLabel, lines })
    const filename = `payroll-${report.periodStart.toISOString().slice(0, 10)}.csv`

    await logAudit({
      userId: auth.user.id,
      businessId,
      action: 'PAYROLL_REPORT_EXPORTED',
      entityType: 'PayrollReport',
      entityId: report.id,
      newValues: { description: `Exported payroll report CSV for ${report.periodLabel}` },
    })

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof PayrollError) {
      const status = error.code === 'NOT_FOUND' ? 404 : 400
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    return handleApiError(error, 'GET /api/dashboard/payroll/reports/[id]/export')
  }
}

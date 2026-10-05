/**
 * Payroll report detail API (owner-only).
 *
 * GET /api/dashboard/payroll/reports/[id]
 *   Full report: frozen per-barber lines with manual adjustments applied
 *   (effective values), plus the append-only adjustment trail.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireOwner } from '@/lib/auth-helpers'
import { getPayrollReport, getPayrollSettings, PayrollError } from '@/lib/payroll'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const { id } = await params
    const settings = await getPayrollSettings(auth.user.businessId!)
    // Master switch OFF: reports are hidden (rows stay untouched).
    if (!settings.enabled) {
      return NextResponse.json({ error: 'Payroll reporting is turned off' }, { status: 404 })
    }
    const { report, lines } = await getPayrollReport(auth.user.businessId!, id)
    return NextResponse.json({
      report: {
        id: report.id,
        status: report.status,
        periodType: report.periodType,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        periodLabel: report.periodLabel,
        reviewedAt: report.reviewedAt,
        exportedAt: report.exportedAt,
        finalizedAt: report.finalizedAt,
        createdAt: report.createdAt,
      },
      lines,
      adjustments: report.adjustments,
    })
  } catch (error) {
    if (error instanceof PayrollError && error.code === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Payroll report not found' }, { status: 404 })
    }
    return handleApiError(error, 'GET /api/dashboard/payroll/reports/[id]')
  }
}

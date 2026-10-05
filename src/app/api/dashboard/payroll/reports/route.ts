/**
 * Payroll reports API (owner-only).
 *
 * GET  /api/dashboard/payroll/reports
 *   Lists the shop's payroll-ready reports (hidden when the owner's
 *   master switch is OFF — historical rows stay untouched either way).
 *
 * POST /api/dashboard/payroll/reports
 *   Generates a new report:
 *     { anchor: 'YYYY-MM-DD' }            — period containing that date,
 *                                           resolved under the shop's
 *                                           configured pay period
 *     { from, to }                        — explicit custom range
 *                                           (1–400 days)
 *   The per-barber numbers are frozen at generation time (DRAFT status).
 *
 * Shop-wide payroll reporting is OWNER ONLY — barbers and business admins
 * get 403, verified server-side on every request. This is NOT a payroll
 * processor: reports organize payroll-ready data for the owner to hand
 * to their actual payroll provider.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireOwner, logAudit, toAuditJson } from '@/lib/auth-helpers'
import { getPayrollSettings, createPayrollReport, PayrollError } from '@/lib/payroll'

export async function GET() {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = auth.user.businessId!
    const settings = await getPayrollSettings(businessId)

    // Master switch OFF: reports are hidden. Historical rows are never
    // deleted — they reappear when the owner turns reporting back on.
    if (!settings.enabled) {
      return NextResponse.json({ enabled: false, reports: [] })
    }

    const reports = await prismaPayrollReports(businessId)
    return NextResponse.json({ enabled: true, reports })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/payroll/reports')
  }
}

async function prismaPayrollReports(businessId: string) {
  const { prisma } = await import('@/lib/prisma')
  return prisma.payrollReport.findMany({
    where: { businessId },
    include: { lines: { select: { barberName: true } }, _count: { select: { adjustments: true } } },
    orderBy: { periodStart: 'desc' },
    take: 100,
  })
}

export async function POST(request: Request) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = auth.user.businessId!

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    let anchor: Date | undefined
    let from: Date | undefined
    let to: Date | undefined

    if (typeof body.anchor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.anchor)) {
      anchor = new Date(`${body.anchor}T12:00:00Z`) // midday avoids tz edge flips
      if (isNaN(anchor.getTime())) {
        return NextResponse.json({ error: 'anchor must be YYYY-MM-DD' }, { status: 400 })
      }
    } else if (typeof body.from === 'string' && typeof body.to === 'string') {
      from = new Date(`${body.from}T00:00:00Z`)
      to = new Date(`${body.to}T00:00:00Z`)
      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return NextResponse.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 })
      }
    }

    try {
      const { report } = await createPayrollReport(businessId, {
        anchor,
        from,
        to,
        createdByUserId: auth.user.id,
      })
      await logAudit({
        userId: auth.user.id,
        businessId,
        action: 'PAYROLL_REPORT_CREATED',
        entityType: 'PayrollReport',
        entityId: report.id,
        newValues: toAuditJson({ ...report, description: `Generated payroll report for ${report.periodLabel}` }),
      })
      return NextResponse.json({ report }, { status: 201 })
    } catch (e) {
      if (e instanceof PayrollError) {
        const status = e.code === 'PAYROLL_DISABLED' ? 400 : e.code === 'NOT_FOUND' ? 404 : 400
        return NextResponse.json({ error: e.message, code: e.code }, { status })
      }
      throw e
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/payroll/reports')
  }
}

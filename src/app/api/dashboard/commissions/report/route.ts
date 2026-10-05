/**
 * Commission report API (owner-only).
 *
 * Aggregates the commission ledger for a date range with optional
 * barber filter, and can export the documented CSV report. Shop-wide
 * financial reporting is OWNER ONLY by default — barbers and business
 * admins get 403, verified server-side on every request.
 *
 * GET /api/dashboard/commissions/report
 *   ?preset=today|week|month  (default: month)
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD  (custom range; overrides preset)
 *   ?barberId=<id>  (optional filter)
 *   ?format=csv  (CSV export instead of JSON)
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireOwner } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { buildCommissionReport, commissionReportCsv, commissionRange } from '@/lib/commissions'

export async function GET(request: Request) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = auth.user.businessId!

    const url = new URL(request.url)
    let from: Date
    let to: Date
    const fromParam = url.searchParams.get('from')
    const toParam = url.searchParams.get('to')
    if (fromParam && toParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
      from = new Date(`${fromParam}T00:00:00Z`)
      to = new Date(`${toParam}T00:00:00Z`)
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
        return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
      }
    } else {
      const preset = url.searchParams.get('preset') ?? 'month'
      try {
        ;({ from, to } = commissionRange(preset, new Date()))
      } catch {
        return NextResponse.json({ error: 'preset must be today | week | month' }, { status: 400 })
      }
    }

    const barberId = url.searchParams.get('barberId')
    if (barberId) {
      const barber = await prisma.barber.findFirst({ where: { id: barberId, businessId }, select: { id: true } })
      if (!barber) return NextResponse.json({ error: 'Barber not found' }, { status: 404 })
    }

    const report = await buildCommissionReport(businessId, { from, to, barberId: barberId || null })

    if (url.searchParams.get('format') === 'csv') {
      const csv = commissionReportCsv(report)
      const filename = `commissions-${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.csv`
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    // `enabled` lets the dashboard render the disabled state while still
    // exposing preserved historical records to the owner.
    const { getCommissionSettings } = await import('@/lib/commissions')
    const settings = await getCommissionSettings(businessId)
    return NextResponse.json({ report, enabled: settings.enabled })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/commissions/report')
  }
}

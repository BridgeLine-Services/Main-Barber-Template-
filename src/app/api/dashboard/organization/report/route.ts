import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { can } from '@/lib/organization/capabilities'
import { resolveOrganizationContext } from '@/lib/organization/resolve'
import { aggregateOnlyGuard } from '@/lib/organization/privacy'
import { buildOrganizationReport, describeOrganizationReport } from '@/lib/organization/reporting'
import { loadLocationRefs, loadLocationRollup } from '@/lib/organization/report-query'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_DAYS = 365

function rangeFrom(searchParams: URLSearchParams): { start: Date; end: Date; label: string; days: number } {
  const requested = Number(searchParams.get('days') ?? '30')
  const days = Number.isFinite(requested) ? Math.min(MAX_DAYS, Math.max(1, Math.round(requested))) : 30
  const end = new Date()
  const start = new Date(end.getTime() - days * 86_400_000)
  return { start, end, label: `the last ${days} day${days === 1 ? '' : 's'}`, days }
}

/**
 * Consolidated, aggregate-only reporting for the caller's organization.
 *
 * The organization and its locations come from the session. The response carries totals
 * and per-location counts, never a customer identity; `aggregateOnlyGuard` refuses to send
 * a payload that contains one, so a future change cannot quietly leak a name.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: resolved.message ?? 'No organization access.' , reason: resolved.reason }, { status: 404 })
  }

  const context = resolved.context
  if (!can(context.role, 'reporting.aggregate.read')) {
    return NextResponse.json({ error: 'Your role cannot see organization reports.' }, { status: 403 })
  }

  const range = rangeFrom(req.nextUrl.searchParams)
  const refs = await loadLocationRefs(context.locationBusinessIds)
  const rollups = await Promise.all(refs.map((ref) => loadLocationRollup(ref, range)))

  const report = buildOrganizationReport(context.organizationId, rollups, {
    generatedAt: new Date().toISOString(),
    rangeLabel: range.label,
  })

  const guard = aggregateOnlyGuard(report)
  if (!guard.safe) {
    // Fail closed: never send a corporate report that contains a customer identity.
    return NextResponse.json({ error: 'The report contained customer details and was withheld.' }, { status: 500 })
  }

  return NextResponse.json({
    report,
    headline: describeOrganizationReport(report),
  })
}

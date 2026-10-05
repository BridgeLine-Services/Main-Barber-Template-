/**
 * Barber self-view of payroll summaries (their OWN only).
 *
 * GET /api/dashboard/payroll/my
 *
 * Owner-gated: available only when payroll reporting is ON AND the owner
 * granted barberSelfView. Returns the caller's own per-period summaries —
 * never other barbers' wages/hours, never shop payroll totals, never
 * commission/payout info for anyone else. Server-side scoped to the
 * session's barberId, so the grant can never be widened by the client.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireAuth } from '@/lib/auth-helpers'
import { barberSelfSummaries, PayrollError } from '@/lib/payroll'

export async function GET() {
  try {
    const auth = await requireAuth()
    if (!auth.success) return auth.response
    const user = auth.user
    if (user.role !== 'BARBER' || !user.barberId || !user.businessId) {
      return NextResponse.json({ error: 'Barber account required' }, { status: 403 })
    }

    try {
      const summaries = await barberSelfSummaries(user.businessId, user.barberId)
      return NextResponse.json({ summaries })
    } catch (e) {
      if (e instanceof PayrollError && e.code === 'PAYROLL_DISABLED') {
        // Self-view off or feature off: indistinguishable, least-privilege 403.
        return NextResponse.json({ error: 'Payroll self-view is not enabled' }, { status: 403 })
      }
      throw e
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/payroll/my')
  }
}

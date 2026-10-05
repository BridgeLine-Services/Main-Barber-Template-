/**
 * Payroll report manual adjustment API (owner-only).
 *
 * POST /api/dashboard/payroll/reports/[id]/adjustments
 *   { barberId, amount (nonzero), reason (required) }
 *
 * The audit mechanism for changing a report's effective numbers —
 * including AFTER finalization. Rows append to an immutable trail
 * (who, when, amount, reason); the frozen line values are never
 * rewritten, so a finalized report's history stays provable.
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireOwner, logAudit, toAuditJson } from '@/lib/auth-helpers'
import { addPayrollAdjustment, PayrollError } from '@/lib/payroll'

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
    const barberId = typeof body.barberId === 'string' ? body.barberId : null
    const amount = typeof body.amount === 'number' ? body.amount : NaN
    const reason = typeof body.reason === 'string' ? body.reason : ''

    if (!barberId) {
      return NextResponse.json({ error: 'barberId is required' }, { status: 400 })
    }

    try {
      const { adjustment } = await addPayrollAdjustment(businessId, id, {
        barberId,
        amount,
        reason,
        createdByUserId: auth.user.id,
      })
      await logAudit({
        userId: auth.user.id,
        businessId,
        action: 'PAYROLL_REPORT_ADJUSTMENT',
        entityType: 'PayrollReport',
        entityId: id,
        newValues: toAuditJson({
          ...adjustment,
          description: `Manual payroll adjustment: ${adjustment.amount > 0 ? '+' : ''}${adjustment.amount} — ${adjustment.reason}`,
        }),
      })
      return NextResponse.json({ adjustment }, { status: 201 })
    } catch (e) {
      if (e instanceof PayrollError) {
        const status = e.code === 'NOT_FOUND' ? 404 : 400
        return NextResponse.json({ error: e.message, code: e.code }, { status })
      }
      throw e
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/payroll/reports/[id]/adjustments')
  }
}

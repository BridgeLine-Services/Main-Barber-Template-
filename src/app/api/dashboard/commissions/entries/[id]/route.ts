/**
 * Commission entry actions (owner-only): approve, adjust, mark paid,
 * note, delete/correct. Every mutation is audited; a barber can NEVER
 * touch payout status or another barber's commission — enforced
 * server-side, not by hiding UI.
 *
 * PATCH /api/dashboard/commissions/entries/[id] { action, amount?, notes? }
 *   action: 'approve' | 'adjust' | 'mark-paid' | 'note'
 * DELETE /api/dashboard/commissions/entries/[id]
 */
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/api-errors'
import { requireOwner, logAudit, toAuditJson } from '@/lib/auth-helpers'
import { getClientIP } from '@/lib/rate-limit'
import { prisma } from '@/lib/prisma'
import { entryPayout } from '@/lib/commissions'

const ACTIONS = ['approve', 'adjust', 'mark-paid', 'note'] as const
type Action = (typeof ACTIONS)[number]

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = auth.user.businessId!
    const { id } = await params
    const entry = await prisma.commissionEntry.findFirst({ where: { id, businessId } }) // tenant-scoped
    if (!entry) return NextResponse.json({ error: 'Commission entry not found' }, { status: 404 })

    const body = (await request.json()) as { action?: string; amount?: number; notes?: string }
    const action = body.action as Action | undefined
    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: `action must be one of ${ACTIONS.join(', ')}` }, { status: 400 })
    }
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : undefined

    const data: Record<string, unknown> = {}
    if (action === 'approve') {
      if (entry.status !== 'PENDING' && entry.status !== 'ADJUSTED') {
        return NextResponse.json({ error: 'Only pending/adjusted entries can be approved' }, { status: 400 })
      }
      data.status = 'APPROVED'
      if (notes !== undefined) data.notes = notes
    } else if (action === 'adjust') {
      if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || Math.abs(body.amount) > 100000) {
        return NextResponse.json({ error: 'amount (±, dollars) is required for adjustments' }, { status: 400 })
      }
      const rounded = Math.round(body.amount * 100) / 100
      data.adjustment = Math.round((entry.adjustment + rounded) * 100) / 100 // cumulative manual correction
      data.status = 'ADJUSTED'
      if (notes !== undefined) data.notes = notes
    } else if (action === 'mark-paid') {
      // Amount defaults to the entry's current effective payout; the
      // owner may record a different actually-paid amount.
      let paidAmount = entryPayout(entry)
      if (body.amount != null) {
        if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount < 0 || body.amount > 100000) {
          return NextResponse.json({ error: 'amount must be between 0 and 100000' }, { status: 400 })
        }
        paidAmount = Math.round(body.amount * 100) / 100
      }
      data.status = 'PAID'
      data.paidAt = new Date()
      data.paidByUserId = auth.user.id
      data.paidAmount = paidAmount
      if (notes !== undefined) data.notes = notes
    } else {
      // note
      if (notes === undefined) return NextResponse.json({ error: 'notes required' }, { status: 400 })
      data.notes = notes
    }

    const updated = await prisma.commissionEntry.update({ where: { id: entry.id }, data })

    const auditAction =
      action === 'mark-paid' ? 'COMMISSION_PAYOUT_UPDATED' : action === 'adjust' ? 'COMMISSION_MANUAL_ADJUSTMENT' : 'COMMISSION_PAYOUT_UPDATED'
    await logAudit({
      userId: auth.user.id,
      businessId,
      action: auditAction,
      entityType: 'CommissionEntry',
      entityId: entry.id,
      oldValues: toAuditJson({ status: entry.status, adjustment: entry.adjustment, paidAmount: entry.paidAmount, notes: entry.notes }),
      newValues: toAuditJson({
        action,
        status: updated.status,
        adjustment: updated.adjustment,
        paidAmount: updated.paidAmount,
        paidBy: updated.paidByUserId,
        ...(notes !== undefined ? { notes } : {}),
        description: `Commission entry ${action}${action === 'mark-paid' ? ` ($${updated.paidAmount.toFixed(2)} by ${auth.user.email})` : ''}`,
      }),
      ipAddress: getClientIP(request),
      userAgent: request.headers.get('user-agent') || undefined,
    })

    return NextResponse.json({ entry: updated })
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/commissions/entries/[id]')
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = auth.user.businessId!
    const { id } = await params
    const entry = await prisma.commissionEntry.findFirst({ where: { id, businessId } }) // tenant-scoped
    if (!entry) return NextResponse.json({ error: 'Commission entry not found' }, { status: 404 })

    await prisma.commissionEntry.delete({ where: { id: entry.id } })
    await logAudit({
      userId: auth.user.id,
      businessId,
      action: 'COMMISSION_ENTRY_DELETED',
      entityType: 'CommissionEntry',
      entityId: entry.id,
      oldValues: toAuditJson({ ...entry, description: `Commission entry deleted (was ${entry.source} $${entry.commissionAmount.toFixed(2)} for barber ${entry.barberId})` }),
      ipAddress: getClientIP(request),
      userAgent: request.headers.get('user-agent') || undefined,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/commissions/entries/[id]')
  }
}

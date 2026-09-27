export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const { id } = await params
    const customer = await prisma.customer.findFirst({
      where: { id, businessId },
      include: {
        appointments: {
          include: { service: true, barber: true },
          orderBy: { startTime: 'desc' },
        },
      },
    })
    if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(customer)
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/customers/[id]')
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const { id } = await params
    const existing = await prisma.customer.findFirst({ where: { id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    try {
      const body = await req.json()
      const data: { notes?: string; tags?: string[]; preferences?: object } = {}
      if (typeof body.notes === 'string') data.notes = body.notes.trim().slice(0, 5000)
      if (Array.isArray(body.tags)) {
        const tags = body.tags.filter((tag: unknown): tag is string => typeof tag === 'string').map((tag: string) => tag.trim()).filter(Boolean)
        data.tags = [...new Set(tags)] as string[]
      }
      if (body.preferences && typeof body.preferences === 'object' && !Array.isArray(body.preferences)) data.preferences = body.preferences
      if (!Object.keys(data).length) return NextResponse.json({ error: 'No valid fields supplied' }, { status: 400 })
      const updated = await prisma.customer.update({ where: { id: existing.id }, data })
      await logAudit({
        userId: (session.user as any)?.id,
        businessId,
        action: 'CUSTOMER_UPDATED',
        entityType: 'Customer',
        entityId: existing.id,
        oldValues: { notes: existing.notes, tags: existing.tags, preferences: existing.preferences },
        newValues: data,
      })
      return NextResponse.json(updated)
    } catch {
      return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/customers/[id]')
  }
}

/**
 * DELETE /api/dashboard/customers/[id]
 * Customer data lifecycle (§21). Two modes:
 *
 *  - mode "archive" (default): reversible soft-archive. Sets archivedAt;
 *    the customer disappears from lists/analytics/booking but all data is
 *    preserved for reporting and can be restored by the business.
 *
 *  - mode "anonymize" (irreversible): archives AND scrubs all personally
 *    identifiable information from the customer record. Appointments are
 *    PRESERVED (historical business reporting stays intact) but their
 *    free-text customerNotes are also scrubbed. The customer's portal
 *    sessions are revoked. Requires body { confirm: "ANONYMIZE" }.
 *
 * The appointment rows themselves are never deleted — appointment history
 * belongs to the business record and stays valid for reporting.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    if (!businessId) return NextResponse.json({ error: 'No business on session' }, { status: 400 })
    const su = session.user as { id?: string }

    // Ownership check — must be OWNER (staff/barbers cannot delete customers).
    const caller = await prisma.user.findUnique({ where: su.id ? { id: su.id } : undefined, select: { role: true } })
    if (caller?.role !== 'OWNER') return NextResponse.json({ error: 'Forbidden: deletion is an owner-only action' }, { status: 403 })

    const { id } = await params
    const existing = await prisma.customer.findFirst({ where: { id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    let mode: 'archive' | 'anonymize' = 'archive'
    let confirmText = ''
    try {
      const body = await req.json()
      if (body?.mode === 'anonymize') mode = 'anonymize'
      confirmText = typeof body?.confirm === 'string' ? body.confirm : ''
    } catch {
      // no body / invalid JSON — default archive mode
    }

    if (mode === 'anonymize' && confirmText !== 'ANONYMIZE') {
      return NextResponse.json(
        { error: 'Anonymization is irreversible. Retry with { "mode": "anonymize", "confirm": "ANONYMIZE" }.' },
        { status: 400 }
      )
    }

    if (mode === 'archive') {
      if (existing.archivedAt) {
        return NextResponse.json({ customer: existing, mode: 'archive', message: 'Already archived' })
      }
      const updated = await prisma.customer.update({
        where: { id: existing.id },
        data: { archivedAt: new Date() },
      })
      await logAudit({
        userId: su.id,
        businessId,
        action: 'CUSTOMER_ARCHIVED',
        entityType: 'Customer',
        entityId: existing.id,
        oldValues: { archivedAt: null },
        newValues: { archivedAt: updated.archivedAt },
      })
      return NextResponse.json({ customer: updated, mode: 'archive', reversible: true })
    }

    // mode === 'anonymize'
    const anonValues = {
      firstName: 'Removed',
      lastName: 'Customer',
      phone: 'deleted',
      email: `anonymized-${existing.id}@deleted.invalid`,
      notes: null,
      preferences: null,
      tags: [] as string[],
      smsConsent: false,
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      archivedAt: new Date(),
    }
    const updated = await prisma.customer.update({ where: { id: existing.id }, data: anonValues })
    // Scrub free-text PII from the customer's appointments; keep the
    // appointments themselves (status, times, service, barber) intact.
    await prisma.appointment.updateMany({
      where: { customerId: existing.id },
      data: { customerNotes: null },
    })
    // Revoke any active portal sessions for this customer.
    await prisma.portalSession.updateMany({
      where: { customerId: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    await logAudit({
      userId: su.id,
      businessId,
      action: 'CUSTOMER_ARCHIVED',
      entityType: 'Customer',
      entityId: existing.id,
      oldValues: {
        firstName: existing.firstName, lastName: existing.lastName,
        phone: existing.phone, email: existing.email,
        hadNotes: !!existing.notes, hadPreferences: !!existing.preferences,
      },
      newValues: { anonymized: true, appointmentNotesScrubbed: true, portalSessionsRevoked: true },
    })
    return NextResponse.json({ customer: updated, mode: 'anonymize', reversible: false })
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/customers/[id]')
  }
}

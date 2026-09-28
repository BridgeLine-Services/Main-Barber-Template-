export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { resolveBusiness } from '@/lib/tenant'
import { hashValue, PORTAL_SESSION_COOKIE } from '@/lib/portal-security'
import { logAudit } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'

/**
 * POST /api/public/portal/delete-account
 * Customer self-service account deletion (§21 lifecycle completion).
 *
 * Authorizes ONLY with the customer's own portal session — a customer can
 * never trigger deletion for anyone else. Requires an explicit confirmation
 * token so the destructive action cannot be triggered accidentally or by a
 * CSRF-style single-click attack.
 *
 * Deletion follows the template's retention policy: the customer record is
 * anonymized (PII scrubbed, appointment history preserved for business
 * reporting — same policy as owner-initiated anonymization), all portal
 * sessions (including the current one) are revoked, and the action is
 * audited. Data the customer wants to keep must be exported FIRST via
 * /api/public/portal/data-export.
 */
export async function POST(req: NextRequest) {
  try {
    const limited = checkRateLimit(req, 'portal-lookup', RATE_LIMITS.PORTAL_LOOKUP)
    if (limited) return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })

    const business = await resolveBusiness()
    if (!business) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const sessionToken = req.cookies.get(PORTAL_SESSION_COOKIE)?.value
    const session = sessionToken
      ? await prisma.portalSession.findFirst({
          where: {
            businessId: business.id,
            tokenHash: hashValue(sessionToken),
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        })
      : null
    if (!session) return NextResponse.json({ error: 'Please verify your email or phone first.' }, { status: 401 })

    const customer = await prisma.customer.findFirst({
      where: { id: session.customerId, businessId: business.id, archivedAt: null },
    })
    if (!customer) return NextResponse.json({ error: 'Session no longer valid. Please verify again.' }, { status: 401 })

    // Explicit confirmation required — this is irreversible
    let confirmText = ''
    try {
      const body = await req.json()
      confirmText = typeof body?.confirm === 'string' ? body.confirm : ''
    } catch {
      // no body
    }
    if (confirmText !== 'DELETE') {
      return NextResponse.json(
        {
          error:
            'Account deletion is irreversible. Export your data first via "Download my data", then retry with { "confirm": "DELETE" }.',
        },
        { status: 400 },
      )
    }

    // Block deletion when the customer has an upcoming appointment: they
    // must cancel it first so slots are released, not silently abandoned.
    const upcoming = await prisma.appointment.findFirst({
      where: {
        customerId: customer.id,
        businessId: business.id,
        status: { in: ['PENDING', 'CONFIRMED'] },
        startTime: { gte: new Date() },
      },
      select: { confirmationNumber: true },
    })
    if (upcoming) {
      return NextResponse.json(
        { error: 'You have an upcoming appointment. Cancel or complete it before deleting your account.' },
        { status: 409 },
      )
    }

    // Anonymize (same retention policy as owner-initiated anonymization in
    // /api/dashboard/customers/[id]): PII scrubbed, appointments kept for
    // business reporting with free-text notes removed.
    const anonValues = {
      firstName: 'Removed',
      lastName: 'Customer',
      phone: 'deleted',
      email: `anonymized-${customer.id}@deleted.invalid`,
      notes: null,
      preferences: null,
      tags: [] as string[],
      smsConsent: false,
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      archivedAt: new Date(),
    }
    const updated = await prisma.customer.update({ where: { id: customer.id }, data: anonValues })
    await prisma.appointment.updateMany({
      where: { customerId: customer.id },
      data: { customerNotes: null },
    })
    // Revoke every portal session for this customer, including this one.
    await prisma.portalSession.updateMany({
      where: { customerId: customer.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    await logAudit({
      businessId: business.id,
      action: 'CUSTOMER_ACCOUNT_DELETED',
      entityType: 'Customer',
      entityId: customer.id,
      oldValues: {
        firstName: customer.firstName,
        lastName: customer.lastName,
        phone: customer.phone,
        email: customer.email,
        hadNotes: !!customer.notes,
        hadPreferences: !!customer.preferences,
      },
      newValues: {
        selfService: true,
        anonymized: true,
        appointmentNotesScrubbed: true,
        portalSessionsRevoked: true,
      },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
    })

    const response = NextResponse.json({ deleted: true, reversible: false })
    response.cookies.delete(PORTAL_SESSION_COOKIE)
    return response
  } catch (error) {
    return handleApiError(error, 'POST /api/public/portal/delete-account')
  }
}

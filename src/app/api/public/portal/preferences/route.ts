export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { resolveBusiness } from '@/lib/tenant'
import { hashValue, normalizeContact, PORTAL_SESSION_COOKIE } from '@/lib/portal-security'
import { sanitizePreferences, formatPreferencesForDisplay } from '@/lib/customer-history'

/**
 * GET/PUT /api/public/portal/preferences
 * Customers can view and save their own service preferences (haircut style,
 * guard length, beard preference, side preference, etc.) in the existing
 * Customer.preferences JSON field. Authenticated by the customer's portal
 * session; staff-only fields are never touched by this endpoint.
 */

async function authorize(req: NextRequest) {
  const limited = checkRateLimit(req, 'portal-lookup', RATE_LIMITS.PORTAL_LOOKUP)
  if (limited) return { status: 429 as const }

  const business = await resolveBusiness()
  if (!business) return { status: 404 as const }

  const sessionToken = req.cookies.get(PORTAL_SESSION_COOKIE)?.value
  const session = sessionToken
    ? await prisma.portalSession.findFirst({
        where: { businessId: business.id, tokenHash: hashValue(sessionToken), revokedAt: null, expiresAt: { gt: new Date() } },
      })
    : null
  if (!session) return { status: 401 as const }

  // Optional contact check (same rule as the lookup endpoint): when a contact
  // is provided it must match the session's customer record.
  let contact: { channel: 'EMAIL' | 'SMS'; value: string } | null = null
  if (req.headers.get('content-type')?.includes('application/json')) {
    const body = await req.json().catch(() => null)
    if (body) contact = normalizeContact(body.email, body.phone)
  }

  const customer = await prisma.customer.findFirst({
    where: { id: session.customerId, businessId: business.id, archivedAt: null },
  })
  if (!customer) return { status: 401 as const }

  if (contact) {
    const contactMatches =
      contact.channel === 'EMAIL'
        ? customer.email.toLowerCase() === contact.value
        : customer.phone.replace(/\D/g, '') === contact.value
    if (!contactMatches) return { status: 401 as const }
  }

  return { customer, business }
}

export async function GET(req: NextRequest) {
  const auth = await authorize(req)
  if (!('customer' in auth)) return NextResponse.json({ error: 'Please verify your email or phone first.' }, { status: auth.status })

  return NextResponse.json({
    preferences: formatPreferencesForDisplay(auth.customer.preferences),
  })
}

export async function PUT(req: NextRequest) {
  const auth = await authorize(req)
  if (!('customer' in auth)) return NextResponse.json({ error: 'Please verify your email or phone first.' }, { status: auth.status })

  const body = await req.json().catch(() => null)
  const cleaned = sanitizePreferences(body?.preferences ?? body)
  if (!cleaned) {
    return NextResponse.json(
      { error: 'Preferences must be an object with up to 20 simple text values (200 characters each).' },
      { status: 400 }
    )
  }

  const updated = await prisma.customer.update({
    where: { id: auth.customer.id },
    data: { preferences: cleaned },
  })

  return NextResponse.json({
    preferences: formatPreferencesForDisplay(updated.preferences),
  })
}

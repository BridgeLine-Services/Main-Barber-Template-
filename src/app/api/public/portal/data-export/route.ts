export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveBusiness } from '@/lib/tenant'
import { hashValue, PORTAL_SESSION_COOKIE } from '@/lib/portal-security'

/**
 * GET /api/public/portal/data-export
 * Customer self-service data export (§21 data portability).
 *
 * Returns the customer's own record (profile, preferences, tags) and their
 * full appointment history with this business as a JSON download. Authorized
 * ONLY by the customer's portal session — no staff data, no other customers,
 * no internal ids beyond what the customer already sees in their portal.
 */
export async function GET(req: NextRequest) {
  try {
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
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const customer = await prisma.customer.findFirst({
      where: { id: session.customerId, businessId: business.id, archivedAt: null },
      select: {
        firstName: true, lastName: true, phone: true, email: true,
        notes: true, tags: true, preferences: true, smsConsent: true,
        createdAt: true, updatedAt: true,
      },
    })
    if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const appointments = await prisma.appointment.findMany({
      where: { customerId: session.customerId, businessId: business.id },
      orderBy: { startTime: 'asc' },
      select: {
        confirmationNumber: true,
        startTime: true, endTime: true, status: true,
        customerNotes: true, cancellationReason: true,
        createdAt: true,
        service: { select: { name: true, duration: true, price: true } },
        barber: { select: { name: true } },
      },
    })

    const payload = {
      exportedAt: new Date().toISOString(),
      business: { name: business.name },
      customer,
      appointments: appointments.map((a) => ({
        confirmationNumber: a.confirmationNumber,
        service: a.service?.name ?? null,
        barber: a.barber?.name ?? null,
        price: a.service?.price ?? null,
        startTime: a.startTime, endTime: a.endTime, status: a.status,
        notes: a.customerNotes, cancellationReason: a.cancellationReason,
        bookedAt: a.createdAt,
      })),
      appointmentCount: appointments.length,
    }

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="my-data.json"`,
        'Cache-Control': 'no-store', // private customer data — never cached
      },
    })
  } catch (error) {
    console.error('portal data-export error', { message: (error as Error).message })
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentBusinessId } from '@/lib/business'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { logAudit } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'

/**
 * GET /api/dashboard/business/export
 * Full business data export (§45 data portability) — OWNER-only.
 *
 * Exports the complete business record (info, settings, branding, hours),
 * services, barbers with schedules, blocked times, closures, appointment
 * history (windowed), customer directory, website content draft/published
 * snapshot, and media asset metadata — everything a business owner needs
 * to migrate away from the platform or keep an independent backup.
 *
 * Query parameters:
 *  - from / to   (ISO dates): restrict the appointment window (default: all)
 *  - customers=0: omit the customer directory (when legal/contractual
 *                 policy says customer PII may not be exported)
 *
 * Authorization: OWNER via the centralized `business.export-data`
 * capability (BUSINESS_ADMIN and BARBER are excluded by design).
 * The export is audited (DATA_EXPORTED) with the requester recorded.
 */
const MAX_APPOINTMENTS = 10000

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.user?.role === 'CUSTOMER') return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
    if (!can((session.user as { role?: string }).role, 'business.export-data')) {
      // OWNER-only: bulk export of the business's data is an ownership
      // action, not a delegated administration task.
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
    }
    const businessId = await getCurrentBusinessId()
    if (!businessId) {
      return NextResponse.json({ error: 'No business on session' }, { status: 400 })
    }

    const url = new URL(req.url)
    const includeCustomers = url.searchParams.get('customers') !== '0'
    const fromRaw = url.searchParams.get('from')
    const toRaw = url.searchParams.get('to')
    const parseDate = (raw: string | null) => {
      if (!raw) return undefined
      const d = new Date(raw)
      return Number.isNaN(d.getTime()) ? undefined : d
    }
    const from = parseDate(fromRaw)
    const to = parseDate(toRaw)

    const appointmentWindow: Record<string, Date> = {}
    if (from) appointmentWindow.gte = from
    if (to) appointmentWindow.lte = to

    // Read-only export: plain Promise.all (no transaction needed — no writes).
    const [business, services, barbers, blockedTimes, closures, appointments, customers, websiteContent, mediaAssets] =
      await Promise.all([
        prisma.business.findUnique({ where: { id: businessId } }),
        prisma.service.findMany({ where: { businessId }, orderBy: { order: 'asc' } }),
        prisma.barber.findMany({
          where: { businessId },
          orderBy: { order: 'asc' },
          include: { schedules: true },
        }),
        prisma.blockedTime.findMany({ where: { businessId } }),
        prisma.businessClosure.findMany({ where: { businessId } }),
        prisma.appointment.findMany({
          where: {
            businessId,
            ...(Object.keys(appointmentWindow).length > 0 ? { startTime: appointmentWindow } : {}),
          },
          include: {
            barber: { select: { id: true, name: true } },
            service: { select: { id: true, name: true, price: true, duration: true } },
            customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
          },
          orderBy: { startTime: 'asc' },
          take: MAX_APPOINTMENTS,
        }),
        includeCustomers
          ? prisma.customer.findMany({
              where: { businessId, archivedAt: null },
              include: { tagAssignments: true },
            })
          : Promise.resolve([]),
        prisma.websiteContent.findUnique({ where: { businessId } }),
        prisma.mediaAsset.findMany({ where: { businessId }, select: { id: true, type: true, url: true, createdAt: true } }),
      ])

    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 })
    }

    const exportPayload = {
      format: 'main-barber-template.business-export.v1',
      exportedAt: new Date().toISOString(),
      business: {
        // Operational settings, branding and hours — no secrets exist on this
        // record, but exclude any internal flags not owned by the business.
        ...business,
      },
      services,
      barbers,
      blockedTimes,
      closures,
      appointments: {
        window: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
        count: appointments.length,
        truncated: appointments.length >= MAX_APPOINTMENTS,
        records: appointments,
      },
      customers: includeCustomers
        ? { included: true, count: customers.length, records: customers }
        : { included: false, reason: 'Omitted by request (customers=0). Customer PII not exported.' },
      websiteContent,
      mediaAssets: {
        note: 'Metadata only. Files live in blob storage; URLs are included and can be fetched independently.',
        records: mediaAssets,
      },
      legal: {
        note:
          'This export contains personal data of staff and customers where included. Handling, retention, and any transfer are subject to applicable privacy law and the business services agreement. Review before sharing with third parties.',
      },
    }

    await logAudit({
      userId: (session.user as { id?: string }).id,
      businessId,
      action: 'DATA_EXPORTED',
      entityType: 'Business',
      entityId: businessId,
      newValues: {
        scope: 'full-business-export',
        includeCustomers,
        appointmentWindow: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
        appointmentCount: appointments.length,
        customerCount: includeCustomers ? customers.length : 0,
      },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
    })

    const slug = business.slug || businessId
    return new NextResponse(JSON.stringify(exportPayload, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/business/export')
  }
}

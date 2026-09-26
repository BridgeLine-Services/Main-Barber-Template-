export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { handleApiError } from '@/lib/api-errors'
import { resetShopConfiguration } from '@/lib/shop-reset'
import { AuditAction } from '@prisma/client'
import { z } from 'zod'

const resetSchema = z.object({
  confirm: z.literal('RESET', { message: 'Type RESET exactly to confirm' }),
})

/**
 * POST /api/dashboard/settings/reset-shop
 *
 * Owner-only. Resets the configurable content of the CURRENT business only
 * (derived from the authenticated session, never from the request body):
 * services, barber profiles, gallery, reviews, FAQs, marketing, loyalty,
 * inventory, closures and other setup data. Historical records (appointments,
 * customers, financial data, audit logs) and authentication are preserved.
 * Records referenced by history are deactivated rather than deleted.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ((session.user as any)?.role !== 'OWNER') {
      return NextResponse.json({ error: 'Only owners can reset a shop' }, { status: 403 })
    }
    // Tenant isolation: businessId comes from the session, never the request
    const businessId = (session.user as any)?.businessId
    if (!businessId) {
      return NextResponse.json({ error: 'No business associated with this account' }, { status: 400 })
    }

    const body = await req.json().catch(() => ({}))
    const parsed = resetSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Type RESET exactly to confirm the shop reset' },
        { status: 400 }
      )
    }

    // Snapshot what is being reset for the audit trail (counts only, no secrets)
    const before = {
      barbers: await prisma.barber.count({ where: { businessId } }),
      services: await prisma.service.count({ where: { businessId } }),
      media: await prisma.mediaAsset.count({ where: { businessId } }),
      reviews: await prisma.review.count({ where: { businessId } }),
      faqs: await prisma.faq.count({ where: { businessId } }),
    }

    const summary = await resetShopConfiguration(businessId)

    // Audit the reset — configuration counts only, never customer/financial data
    try {
      await prisma.auditLog.create({
        data: {
          businessId,
          userId: (session.user as any).id,
          action: AuditAction.SHOP_CONFIGURATION_RESET,
          entityType: 'Business',
          entityId: businessId,
          oldValues: before,
          newValues: {
            barbersDeleted: summary.barbersDeleted,
            barbersDeactivated: summary.barbersDeactivated,
            servicesDeleted: summary.servicesDeleted,
            servicesDeactivated: summary.servicesDeactivated,
            mediaDeleted: summary.mediaDeleted,
          },
          ipAddress: req.headers.get('x-forwarded-for') || undefined,
          userAgent: req.headers.get('user-agent') || undefined,
        },
      })
    } catch (auditError) {
      console.error(
        '[reset-shop] audit log failed after reset:',
        auditError instanceof Error ? auditError.message : 'unknown error'
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Shop reset successfully. You can now configure this business again.',
      summary,
      ...(summary.storageWarning && { warning: summary.storageWarning }),
    })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/settings/reset-shop')
  }
}

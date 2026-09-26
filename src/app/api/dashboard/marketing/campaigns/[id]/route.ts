export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CampaignAudience, CampaignStatus } from '@prisma/client'
import { handleApiError } from '@/lib/api-errors'
import { logAudit } from '@/lib/auth-helpers'
import { getClientIP } from '@/lib/rate-limit'
import { AuditAction } from '@prisma/client'

const updateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().min(1).optional(),
  audience: z.nativeEnum(CampaignAudience).optional(),
  audienceConfig: z.any().optional(),
  status: z.nativeEnum(CampaignStatus).optional(),
})

// PATCH /api/dashboard/marketing/campaigns/[id] — edit a campaign or change its
// status (DRAFT ↔ ARCHIVED acts as enable/disable). Tenant-scoped: the
// campaign is looked up under the authenticated user's businessId only.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const user = session.user as any
    if (user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Only owners can manage marketing campaigns' }, { status: 403 })
    }
    const businessId = user.businessId
    // Scope lookup to the authenticated business — never trust a client-supplied id alone.
    const existing = await prisma.marketingCampaign.findFirst({
      where: { id: params.id, businessId },
    })
    if (!existing) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

    const body = await req.json().catch(() => ({}))
    const parseResult = updateCampaignSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid campaign data', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }
    const { audienceConfig, ...data } = parseResult.data

    const updated = await prisma.marketingCampaign.update({
      where: { id: params.id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.subject !== undefined && { subject: data.subject }),
        ...(data.body !== undefined && { body: data.body }),
        ...(data.audience !== undefined && { audience: data.audience }),
        ...(audienceConfig !== undefined && { audienceConfig }),
        // A sent campaign's historical record (sentAt, recipientCount) is
        // preserved; archiving only changes the status flag.
        ...(data.status !== undefined && { status: data.status }),
      },
    })

    await logAudit({
      userId: user.id,
      businessId,
      action: AuditAction.SETTINGS_UPDATED,
      entityType: 'MarketingCampaign',
      entityId: params.id,
      oldValues: { name: existing.name, status: existing.status },
      newValues: { name: updated.name, status: updated.status },
      ipAddress: getClientIP(req),
      userAgent: req.headers.get('user-agent') || undefined,
    })

    return NextResponse.json(updated)
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/marketing/campaigns/[id]')
  }
}

// DELETE /api/dashboard/marketing/campaigns/[id] — permanently delete one
// campaign. Deleting one campaign never affects any other campaign.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const user = session.user as any
    if (user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Only owners can manage marketing campaigns' }, { status: 403 })
    }
    const businessId = user.businessId
    const existing = await prisma.marketingCampaign.findFirst({
      where: { id: params.id, businessId },
    })
    if (!existing) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

    await prisma.marketingCampaign.delete({ where: { id: params.id } })

    await logAudit({
      userId: user.id,
      businessId,
      action: AuditAction.SETTINGS_UPDATED,
      entityType: 'MarketingCampaign',
      entityId: params.id,
      oldValues: { name: existing.name, status: existing.status, sentAt: existing.sentAt },
      newValues: null,
      ipAddress: getClientIP(req),
      userAgent: req.headers.get('user-agent') || undefined,
    })

    return NextResponse.json({ success: true, deleted: params.id })
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/marketing/campaigns/[id]')
  }
}

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logAudit } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'
import { snapshotToDraftPatch } from '@/lib/website-versions'

/**
 * POST /api/dashboard/website-content/versions/:id/restore
 *
 * Copies an old version back into the DRAFT. It never touches the published snapshot: the live
 * site keeps showing what it showed until the owner reviews the draft and publishes, which
 * creates a new version. Restoring is therefore reversible and never a silent rollback.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role === 'CUSTOMER') {
      return NextResponse.json({ error: 'Staff access required' }, { status: 403 })
    }
    if (session.user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
    }
    const businessId = session.user.businessId
    if (!businessId) return NextResponse.json({ error: 'No business context' }, { status: 400 })

    const { id } = await params
    // The id is only ever used inside this business's rows.
    const version = await prisma.websiteContentVersion.findFirst({
      where: { id, businessId },
      select: { id: true, version: true, snapshot: true },
    })
    if (!version) return NextResponse.json({ error: 'That version was not found.' }, { status: 404 })

    const patch = snapshotToDraftPatch(version.snapshot)
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'That version has nothing to restore.' }, { status: 422 })
    }

    const updated = await prisma.websiteContent.update({
      where: { businessId },
      data: patch,
      select: { id: true },
    })

    await logAudit({
      userId: session.user.id,
      businessId,
      action: 'WEBSITE_VERSION_RESTORED_TO_DRAFT',
      entityType: 'WebsiteContent',
      entityId: updated.id,
      newValues: { restoredVersion: version.version, fieldsRestored: Object.keys(patch).length },
    })

    return NextResponse.json({
      success: true,
      restoredVersion: version.version,
      fieldsRestored: Object.keys(patch).length,
      note: 'Restored into your draft. Your live site is unchanged until you publish.',
    })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/website-content/versions/:id/restore')
  }
}

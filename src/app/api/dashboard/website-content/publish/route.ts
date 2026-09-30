export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logAudit } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'

/**
 * The editable WebsiteContent fields that make up a publishable snapshot.
 */
const PUBLISH_FIELDS = [
  'heroEyebrow', 'heroTitle', 'heroDescription', 'heroImageUrl',
  'heroPrimaryCtaLabel', 'heroPrimaryCtaHref', 'heroSecondaryCtaLabel',
  'heroSecondaryCtaHref', 'showServices', 'showTeam', 'showReviews',
  'showVisit', 'showFaq', 'showFinalCta', 'servicesTitle',
  'servicesDescription', 'teamTitle', 'teamDescription', 'reviewsTitle',
  'reviewsDescription', 'visitTitle', 'visitDescription', 'faqTitle',
  'faqDescription', 'finalCtaTitle', 'finalCtaDescription',
  'featuredReviewCount',
] as const

/**
 * POST /api/dashboard/website-content/publish
 *
 * Publishes the current DRAFT website content: snapshots the editable
 * fields into publishedContent, which is what the public site renders.
 * Until the first publish the public site shows the live fields (legacy
 * behavior). Owner-only; audited; scoped to the session's business.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
    }
    const businessId = session.user.businessId
    if (!businessId) {
      return NextResponse.json({ error: 'No business context' }, { status: 400 })
    }

    const draft = await prisma.websiteContent.findUnique({ where: { businessId } })
    if (!draft) {
      return NextResponse.json(
        { error: 'No website content to publish yet — configure the website sections first' },
        { status: 404 }
      )
    }

    const snapshot: Record<string, unknown> = {}
    for (const field of PUBLISH_FIELDS) {
      snapshot[field] = (draft as unknown as Record<string, unknown>)[field]
    }

    const updated = await prisma.websiteContent.update({
      where: { businessId },
      data: { publishedContent: snapshot as unknown as Prisma.InputJsonValue, publishedAt: new Date() },
    })

    await logAudit({
      userId: session.user.id,
      businessId,
      action: 'WEBSITE_CONTENT_PUBLISHED',
      entityType: 'WebsiteContent',
      entityId: draft.id,
      newValues: { publishedAt: updated.publishedAt, fieldsPublished: PUBLISH_FIELDS.length },
    })

    return NextResponse.json({ success: true, publishedAt: updated.publishedAt })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/website-content/publish')
  }
}

/**
 * GET /api/dashboard/website-content/publish
 * Returns the draft/publish state for the settings UI.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const businessId = session.user.businessId
    const content = businessId
      ? await prisma.websiteContent.findUnique({
          where: { businessId },
          select: { publishedAt: true, publishedContent: true },
        })
      : null

    const publishedAt = content?.publishedAt ?? null
    let hasUnpublishedChanges = false
    if (content?.publishedContent) {
      const draftRow = await prisma.websiteContent.findUnique({ where: { businessId } })
      if (draftRow) {
        const published: Record<string, unknown> = content.publishedContent as Record<string, unknown>
        hasUnpublishedChanges = PUBLISH_FIELDS.some(
          (f) => JSON.stringify((draftRow as unknown as Record<string, unknown>)[f] ?? null) !== JSON.stringify(published[f] ?? null)
        )
      }
    }
    return NextResponse.json({ publishedAt, hasUnpublishedChanges })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/website-content/publish')
  }
}

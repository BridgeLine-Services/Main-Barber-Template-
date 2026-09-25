export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { getBusinessIdForUser, logAudit } from '@/lib/auth-helpers'
import { updateBusinessSchema } from '@/lib/validation'
import { getClientIP } from '@/lib/rate-limit'
import { handleApiError } from '@/lib/api-errors'

/**
 * GET /api/dashboard/settings
 * Returns the business settings + SEO (OWNER only)
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    try {
      const businessId = await getBusinessIdForUser(auth.user)
      const [business, seo, websiteContent, bookingQuestions] = await Promise.all([
        prisma.business.findUnique({ where: { id: businessId } }),
        prisma.businessSEO.findUnique({ where: { businessId } }),
        prisma.websiteContent.findUnique({ where: { businessId } }),
        prisma.bookingQuestion.findMany({ where: { businessId }, orderBy: { sortOrder: 'asc' } }),
      ])
      if (!business) {
        return NextResponse.json({ error: 'Business not found' }, { status: 404 })
      }
      return NextResponse.json({ business, seo, websiteContent, bookingQuestions })
    } catch (error: any) {
      console.error('[settings] request failed', error)
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/settings')
  }
}

/**
 * PATCH /api/dashboard/settings
 * Update business settings + SEO (OWNER only)
 *
 * Body: {
 *   ...businessFields,
 *   seo?: { siteTitle, siteDescription, keywords, ogTitle, ogDescription, ogImage, canonicalUrl, robotsIndex, robotsFollow, googleVerification }
 * }
 */
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    try {
      const businessId = await getBusinessIdForUser(auth.user)
      const body = await req.json()
      // Extract SEO fields — they go to a separate table
      const { seo, websiteContent, ...businessFields } = body
      // Validate business fields
      const parseResult = updateBusinessSchema.safeParse(businessFields)
      if (!parseResult.success) {
        return NextResponse.json(
          { error: 'Invalid settings data', details: parseResult.error.flatten().fieldErrors },
          { status: 400 }
        )
      }
      // Capture old values for audit
      const oldBusiness = await prisma.business.findUnique({ where: { id: businessId } })
      const oldSeo = await prisma.businessSEO.findUnique({ where: { businessId } })
      // Update business
      const updated = await prisma.business.update({
        where: { id: businessId },
        data: parseResult.data,
      })
      let updatedWebsiteContent = null
      if (websiteContent && typeof websiteContent === 'object') {
        const allowedWebsiteFields = ['heroEyebrow', 'heroTitle', 'heroDescription', 'heroImageUrl', 'heroPrimaryCtaLabel', 'heroPrimaryCtaHref', 'heroSecondaryCtaLabel', 'heroSecondaryCtaHref', 'showServices', 'showTeam', 'showReviews', 'showVisit', 'showFaq', 'showFinalCta', 'servicesTitle', 'servicesDescription', 'teamTitle', 'teamDescription', 'reviewsTitle', 'reviewsDescription', 'visitTitle', 'visitDescription', 'faqTitle', 'faqDescription', 'finalCtaTitle', 'finalCtaDescription', 'featuredReviewCount']
        const websiteData: Record<string, unknown> = {}
        for (const field of allowedWebsiteFields) if (field in websiteContent) websiteData[field] = websiteContent[field]
        if (Object.keys(websiteData).length > 0) {
          updatedWebsiteContent = await prisma.websiteContent.upsert({ where: { businessId }, create: { businessId, ...websiteData }, update: websiteData })
        }
      }
      // Update SEO if provided
      let updatedSeo = null
      if (seo && typeof seo === 'object') {
        const seoData: any = {}
        const allowedSeoFields = [
          'siteTitle', 'siteDescription', 'keywords', 'ogTitle', 'ogDescription',
          'ogImage', 'canonicalUrl', 'robotsIndex', 'robotsFollow', 'googleVerification'
        ]
        for (const field of allowedSeoFields) {
          if (field in seo) seoData[field] = seo[field]
        }
        if (Object.keys(seoData).length > 0) {
          updatedSeo = await prisma.businessSEO.upsert({
            where: { businessId },
            create: { businessId, ...seoData },
            update: seoData,
          })
        }
      }
      await logAudit({
        userId: auth.user.id,
        businessId,
        action: 'SETTINGS_UPDATED',
        entityType: 'Business',
        entityId: businessId,
        oldValues: { business: oldBusiness, seo: oldSeo },
        newValues: { business: parseResult.data, seo: seo || null },
        ipAddress: getClientIP(req),
        userAgent: req.headers.get('user-agent') || undefined,
      })
      return NextResponse.json({ business: updated, seo: updatedSeo, websiteContent: updatedWebsiteContent })
    } catch (error: any) {
      console.error('[settings] request failed', error)
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/settings')
  }
}

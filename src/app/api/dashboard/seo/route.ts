export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOwner, getBusinessIdForUser, logAudit } from '@/lib/auth-helpers'
import { updateBusinessSEOSchema } from '@/lib/validation'
import { getClientIP } from '@/lib/rate-limit'
import { AuditAction } from '@prisma/client'
import { handleApiError } from '@/lib/api-errors'

/**
 * GET /api/dashboard/seo
 * Returns the business SEO settings (OWNER only)
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    try {
      const businessId = await getBusinessIdForUser(auth.user)
      let seo = await prisma.businessSEO.findUnique({
        where: { businessId },
      })
      // Auto-create if missing
      if (!seo) {
        seo = await prisma.businessSEO.create({
          data: { businessId },
        })
      }
      return NextResponse.json({ seo })
    } catch (error: any) {
      console.error('SEO fetch error:', error)
      return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/seo')
  }
}

/**
 * PATCH /api/dashboard/seo
 * Update business SEO settings (OWNER only)
 */
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    try {
      const businessId = await getBusinessIdForUser(auth.user)
      const body = await req.json()
      const parseResult = updateBusinessSEOSchema.safeParse(body)
      if (!parseResult.success) {
        return NextResponse.json(
          { error: 'Invalid SEO data', details: parseResult.error.flatten().fieldErrors },
          { status: 400 }
        )
      }
      const oldSEO = await prisma.businessSEO.findUnique({ where: { businessId } })
      // Upsert: create if doesn't exist
      const seo = await prisma.businessSEO.upsert({
        where: { businessId },
        create: {
          businessId,
          ...parseResult.data,
        },
        update: parseResult.data,
      })
      await logAudit({
        userId: auth.user.id,
        businessId,
        action: AuditAction.SEO_UPDATED,
        entityType: 'BusinessSEO',
        entityId: seo.id,
        oldValues: oldSEO,
        newValues: parseResult.data,
        ipAddress: getClientIP(req),
        userAgent: req.headers.get('user-agent') || undefined,
      })
      return NextResponse.json({ seo })
    } catch (error: any) {
      console.error('SEO update error:', error)
      return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/seo')
  }
}

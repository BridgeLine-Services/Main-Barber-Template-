export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOwner, getBusinessIdForUser, logAudit } from '@/lib/auth-helpers'
import { z } from 'zod'
import { AuditAction } from '@prisma/client'
import { handleApiError } from '@/lib/api-errors'

const faqSchema = z.object({
  category: z.string().min(1).max(100),
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(5000),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
})

/**
 * GET /api/dashboard/faqs
 * Returns all FAQs for the business (OWNER only), including inactive ones.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    try {
      const businessId = await getBusinessIdForUser(auth.user)
      const faqs = await prisma.faq.findMany({
        where: { businessId },
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      })
      return NextResponse.json({ faqs })
    } catch (error: any) {
      console.error('Error fetching FAQs:', error)
      return NextResponse.json({ error: 'Failed to fetch FAQs' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/faqs')
  }
}

/**
 * POST /api/dashboard/faqs
 * Creates a new FAQ entry (OWNER only).
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    try {
      const businessId = await getBusinessIdForUser(auth.user)
      const body = await req.json()
      const parsed = faqSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
      }
      const faq = await prisma.faq.create({
        data: {
          businessId,
          category: parsed.data.category,
          question: parsed.data.question,
          answer: parsed.data.answer,
          sortOrder: parsed.data.sortOrder ?? 0,
          isActive: parsed.data.isActive ?? true,
        },
      })
      await logAudit({
        businessId,
        userId: (auth.user as any).id,
        action: AuditAction.SETTINGS_UPDATED,
        entityType: 'Faq',
        entityId: faq.id,
        newValues: { question: faq.question, category: faq.category },
      })
      return NextResponse.json({ faq }, { status: 201 })
    } catch (error: any) {
      console.error('Error creating FAQ:', error)
      return NextResponse.json({ error: 'Failed to create FAQ' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/faqs')
  }
}

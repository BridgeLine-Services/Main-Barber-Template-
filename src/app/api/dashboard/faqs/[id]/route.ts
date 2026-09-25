export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOwner, getBusinessIdForUser, logAudit } from '@/lib/auth-helpers'
import { z } from 'zod'
import { AuditAction } from '@prisma/client'
import { handleApiError } from '@/lib/api-errors'

const updateFaqSchema = z.object({
  category: z.string().min(1).max(100).optional(),
  question: z.string().min(1).max(500).optional(),
  answer: z.string().min(1).max(5000).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
})

/**
 * PATCH /api/dashboard/faqs/[id]
 * Updates an FAQ entry (OWNER only, must belong to their business).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    try {
      const businessId = await getBusinessIdForUser(auth.user)
      // Verify the FAQ belongs to this business (tenant isolation)
      const existing = await prisma.faq.findFirst({ where: { id: params.id, businessId } })
      if (!existing) {
        return NextResponse.json({ error: 'FAQ not found' }, { status: 404 })
      }
      const body = await req.json()
      const parsed = updateFaqSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
      }
      const faq = await prisma.faq.update({
        where: { id: params.id },
        data: parsed.data,
      })
      await logAudit({
        businessId,
        userId: (auth.user as any).id,
        action: AuditAction.SETTINGS_UPDATED,
        entityType: 'Faq',
        entityId: faq.id,
        oldValues: { question: existing.question, answer: existing.answer },
        newValues: parsed.data,
      })
      return NextResponse.json({ faq })
    } catch (error: any) {
      console.error('Error updating FAQ:', error)
      return NextResponse.json({ error: 'Failed to update FAQ' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/faqs/[id]')
  }
}

/**
 * DELETE /api/dashboard/faqs/[id]
 * Deletes an FAQ entry (OWNER only, must belong to their business).
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    try {
      const businessId = await getBusinessIdForUser(auth.user)
      const existing = await prisma.faq.findFirst({ where: { id: params.id, businessId } })
      if (!existing) {
        return NextResponse.json({ error: 'FAQ not found' }, { status: 404 })
      }
      await prisma.faq.delete({ where: { id: params.id } })
      await logAudit({
        businessId,
        userId: (auth.user as any).id,
        action: AuditAction.SETTINGS_UPDATED,
        entityType: 'Faq',
        entityId: params.id,
        oldValues: { question: existing.question },
      })
      return NextResponse.json({ success: true })
    } catch (error: any) {
      console.error('Error deleting FAQ:', error)
      return NextResponse.json({ error: 'Failed to delete FAQ' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/faqs/[id]')
  }
}

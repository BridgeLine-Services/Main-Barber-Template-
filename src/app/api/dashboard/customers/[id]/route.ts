export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/auth-helpers'
import { handleApiError } from '@/lib/api-errors'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const { id } = await params
    const customer = await prisma.customer.findFirst({
      where: { id, businessId },
      include: {
        appointments: {
          include: { service: true, barber: true },
          orderBy: { startTime: 'desc' },
        },
      },
    })
    if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(customer)
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/customers/[id]')
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const { id } = await params
    const existing = await prisma.customer.findFirst({ where: { id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    try {
      const body = await req.json()
      const data: { notes?: string; tags?: string[]; preferences?: object } = {}
      if (typeof body.notes === 'string') data.notes = body.notes.trim().slice(0, 5000)
      if (Array.isArray(body.tags)) {
        const tags = body.tags.filter((tag: unknown): tag is string => typeof tag === 'string').map((tag: string) => tag.trim()).filter(Boolean)
        data.tags = [...new Set(tags)] as string[]
      }
      if (body.preferences && typeof body.preferences === 'object' && !Array.isArray(body.preferences)) data.preferences = body.preferences
      if (!Object.keys(data).length) return NextResponse.json({ error: 'No valid fields supplied' }, { status: 400 })
      const updated = await prisma.customer.update({ where: { id: existing.id }, data })
      await logAudit({
        userId: (session.user as any)?.id,
        businessId,
        action: 'CUSTOMER_UPDATED',
        entityType: 'Customer',
        entityId: existing.id,
        oldValues: { notes: existing.notes, tags: existing.tags, preferences: existing.preferences },
        newValues: data,
      })
      return NextResponse.json(updated)
    } catch {
      return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/customers/[id]')
  }
}

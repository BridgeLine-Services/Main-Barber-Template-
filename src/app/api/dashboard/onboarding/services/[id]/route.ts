export const dynamic = 'force-dynamic'

// Onboarding — update/delete a single service (owner's own business only).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { resolveOwnerBusinessId } from '@/lib/onboarding'
import { updateServiceSchema } from '@/lib/validation'
import { handleApiError } from '@/lib/api-errors'

const serviceSubset = {
  id: true,
  name: true,
  description: true,
  duration: true,
  price: true,
  isActive: true,
  order: true,
} as const

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = await resolveOwnerBusinessId(auth.user)
    if (!businessId) {
      return NextResponse.json({ error: 'No business linked to your account' }, { status: 409 })
    }
    // Ownership check: the service must belong to the owner's business.
    const existing = await prisma.service.findFirst({
      where: { id: params.id, businessId },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 })
    }
    try {
      const body = await req.json()
      const parsed = updateServiceSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid service data', details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        )
      }
      const { name, description, duration, price, isActive } = parsed.data
      const service = await prisma.service.update({
        where: { id: existing.id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description: description || null }),
          ...(duration !== undefined && { duration }),
          ...(price !== undefined && { price }),
          ...(isActive !== undefined && { isActive }),
        },
        select: serviceSubset,
      })
      return NextResponse.json({ service })
    } catch (error: any) {
      console.error('Onboarding service update error:', error)
      return NextResponse.json({ error: 'Failed to update service' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/onboarding/services/[id]')
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = await resolveOwnerBusinessId(auth.user)
    if (!businessId) {
      return NextResponse.json({ error: 'No business linked to your account' }, { status: 409 })
    }
    // Ownership check before delete — cross-business ids are simply 404s.
    const existing = await prisma.service.findFirst({
      where: { id: params.id, businessId },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 })
    }
    try {
      await prisma.service.delete({ where: { id: existing.id } })
      return NextResponse.json({ success: true })
    } catch (error: any) {
      console.error('Onboarding service delete error:', error)
      return NextResponse.json({ error: 'Failed to delete service' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/onboarding/services/[id]')
  }
}

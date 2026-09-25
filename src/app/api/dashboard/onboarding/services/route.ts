export const dynamic = 'force-dynamic'

// Onboarding — Services step API.
// Owner-scoped CRUD for services during onboarding. The business is ALWAYS
// resolved from the database user record (the JWT claim can be stale), so
// cross-business access is impossible from this endpoint.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { resolveOwnerBusinessId } from '@/lib/onboarding'
import { createServiceSchema } from '@/lib/validation'
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

export async function GET() {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = await resolveOwnerBusinessId(auth.user)
    if (!businessId) {
      return NextResponse.json({ error: 'No business linked to your account yet' }, { status: 409 })
    }
    const services = await prisma.service.findMany({
      where: { businessId },
      select: serviceSubset,
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    })
    return NextResponse.json({ services })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/onboarding/services')
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = await resolveOwnerBusinessId(auth.user)
    if (!businessId) {
      return NextResponse.json({ error: 'Create your business basics first' }, { status: 409 })
    }
    try {
      const body = await req.json()
      const parsed = createServiceSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid service data', details: parsed.error.flatten().fieldErrors },
          { status: 400 }
        )
      }
      const { name, description, duration, price, isActive } = parsed.data
      const service = await prisma.service.create({
        data: {
          businessId, // server-resolved — never from the request body
          name,
          description: description || null,
          duration,
          price,
          isActive: isActive ?? true,
          order: 0,
        },
        select: serviceSubset,
      })
      return NextResponse.json({ service }, { status: 201 })
    } catch (error: any) {
      console.error('Onboarding service create error:', error)
      return NextResponse.json({ error: 'Failed to create service' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/onboarding/services')
  }
}

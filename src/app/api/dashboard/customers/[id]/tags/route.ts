import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { handleApiError } from '@/lib/api-errors'

// GET /api/dashboard/customers/[id]/tags — list tags for a customer
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const user = session.user as any
    try {
      const tags = await prisma.customerTagAssignment.findMany({
        where: { customerId: params.id, businessId: user.businessId },
        orderBy: { assignedAt: 'desc' },
      })
      return NextResponse.json(tags)
    } catch (error) {
      return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/customers/[id]/tags')
  }
}

// POST /api/dashboard/customers/[id]/tags — assign a tag
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const user = session.user as any
    try {
      const body = await request.json()
      const { tag } = body
      if (!tag) {
        return NextResponse.json({ error: 'Tag is required' }, { status: 400 })
      }
      // Check if tag already exists for this customer
      const existing = await prisma.customerTagAssignment.findFirst({
        where: { customerId: params.id, businessId: user.businessId, tag },
      })
      if (existing) {
        return NextResponse.json({ error: 'Tag already assigned' }, { status: 409 })
      }
      const assignment = await prisma.customerTagAssignment.create({
        data: {
          customerId: params.id,
          businessId: user.businessId,
          tag,
        },
      })
      await prisma.auditLog.create({
        data: {
          businessId: user.businessId,
          userId: user.id,
          action: 'CUSTOMER_TAG_ADDED',
          entityType: 'Customer',
          entityId: params.id,
          newValues: { tag } as any,
        },
      })
      return NextResponse.json(assignment, { status: 201 })
    } catch (error) {
      console.error('Tag assign error:', error)
      return NextResponse.json({ error: 'Failed to assign tag' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/customers/[id]/tags')
  }
}

// DELETE /api/dashboard/customers/[id]/tags — remove a tag
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const user = session.user as any
    try {
      const { searchParams } = new URL(request.url)
      const tag = searchParams.get('tag')
      if (!tag) {
        return NextResponse.json({ error: 'Tag parameter required' }, { status: 400 })
      }
      await prisma.customerTagAssignment.deleteMany({
        where: { customerId: params.id, businessId: user.businessId, tag: tag as any },
      })
      await prisma.auditLog.create({
        data: {
          businessId: user.businessId,
          userId: user.id,
          action: 'CUSTOMER_TAG_REMOVED',
          entityType: 'Customer',
          entityId: params.id,
          oldValues: { tag } as any,
        },
      })
      return NextResponse.json({ success: true })
    } catch (error) {
      return NextResponse.json({ error: 'Failed to remove tag' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/customers/[id]/tags')
  }
}

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { handleApiError } from '@/lib/api-errors'

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const user = session.user as any
    if (user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { searchParams } = new URL(request.url)
    const filter = (searchParams.get('filter') as 'all' | 'low_stock' | 'out_of_stock') || 'all'
    const includeArchived = searchParams.get('includeArchived') === 'true'
    try {
      const where: any = { businessId: user.businessId, ...(includeArchived ? {} : { archivedAt: null }) }
      const items = await prisma.inventoryItem.findMany({
        where,
        include: { barber: { select: { name: true } } },
        orderBy: { name: 'asc' },
      })
      let result = items
      if (filter === 'low_stock') {
        result = items.filter(i => i.stock <= i.threshold && i.stock > 0)
      } else if (filter === 'out_of_stock') {
        result = items.filter(i => i.stock <= 0)
      }
      return NextResponse.json(result)
    } catch (error) {
      console.error('Inventory fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch inventory' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/inventory')
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const user = session.user as any
    if (user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    try {
      const body = await request.json()
      const { name, sku, stock, unit, threshold, cost, vendor, barberId, notes } = body
      if (!name?.trim()) {
        return NextResponse.json({ error: 'Name is required' }, { status: 400 })
      }
      const item = await prisma.inventoryItem.create({
        data: {
          businessId: user.businessId,
          name: name.trim(),
          sku: sku?.trim() || null,
          stock: parseFloat(stock) || 0,
          unit: unit || 'each',
          threshold: parseFloat(threshold) || 5,
          cost: cost ? parseFloat(cost) : null,
          vendor: vendor?.trim() || null,
          barberId: barberId || null,
          notes: notes?.trim() || null,
        },
      })
      // Audit log
      await prisma.auditLog.create({
        data: {
          businessId: user.businessId,
          userId: user.id,
          action: 'INVENTORY_UPDATED',
          entityType: 'InventoryItem',
          entityId: item.id,
          newValues: { name, stock, threshold } as any,
        },
      })
      return NextResponse.json(item, { status: 201 })
    } catch (error) {
      console.error('Inventory create error:', error)
      return NextResponse.json({ error: 'Failed to create inventory item' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/inventory')
  }
}

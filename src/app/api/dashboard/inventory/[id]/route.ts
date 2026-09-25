import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { handleApiError } from '@/lib/api-errors'

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
      const item = await prisma.inventoryItem.findFirst({
        where: { id: params.id, businessId: user.businessId },
        include: { barber: { select: { name: true } } },
      })
      if (!item) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      return NextResponse.json(item)
    } catch (error) {
      return NextResponse.json({ error: 'Failed to fetch item' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/inventory/[id]')
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
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
      const { name, sku, stock, unit, threshold, cost, vendor, barberId, notes, adjustment } = body
      const existing = await prisma.inventoryItem.findFirst({
        where: { id: params.id, businessId: user.businessId },
      })
      if (!existing) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      // If adjustment is provided, add to current stock instead of replacing
      const newStock = adjustment !== undefined
        ? Math.max(0, existing.stock + parseFloat(adjustment))
        : stock !== undefined
          ? parseFloat(stock)
          : existing.stock
      const updated = await prisma.inventoryItem.update({
        where: { id: params.id },
        data: {
          name: name?.trim() ?? existing.name,
          sku: sku !== undefined ? (sku?.trim() || null) : existing.sku,
          stock: newStock,
          unit: unit ?? existing.unit,
          threshold: threshold !== undefined ? parseFloat(threshold) : existing.threshold,
          cost: cost !== undefined ? (cost ? parseFloat(cost) : null) : existing.cost,
          vendor: vendor !== undefined ? (vendor?.trim() || null) : existing.vendor,
          barberId: barberId !== undefined ? (barberId || null) : existing.barberId,
          notes: notes !== undefined ? (notes?.trim() || null) : existing.notes,
        },
      })
      await prisma.auditLog.create({
        data: {
          businessId: user.businessId,
          userId: user.id,
          action: 'INVENTORY_UPDATED',
          entityType: 'InventoryItem',
          entityId: updated.id,
          oldValues: { stock: existing.stock } as any,
          newValues: { stock: newStock, name: updated.name } as any,
        },
      })
      return NextResponse.json(updated)
    } catch (error) {
      console.error('Inventory update error:', error)
      return NextResponse.json({ error: 'Failed to update item' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/inventory/[id]')
  }
}

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
    if (user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    try {
      const existing = await prisma.inventoryItem.findFirst({
        where: { id: params.id, businessId: user.businessId },
      })
      if (!existing) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      await prisma.inventoryItem.delete({ where: { id: params.id } })
      await prisma.auditLog.create({
        data: {
          businessId: user.businessId,
          userId: user.id,
          action: 'INVENTORY_UPDATED',
          entityType: 'InventoryItem',
          entityId: params.id,
          oldValues: { name: existing.name } as any,
        },
      })
      return NextResponse.json({ success: true })
    } catch (error) {
      return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/inventory/[id]')
  }
}

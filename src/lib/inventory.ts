import { prisma } from '@/lib/prisma'
import { InventoryItem } from '@prisma/client'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface InventoryWithBarber extends InventoryItem {
  barber?: { name: string } | null
}

export interface LowStockItem {
  id: string
  name: string
  stock: number
  threshold: number
  unit: string
  barberName?: string | null
  deficit: number
}

// ─── Functions ───────────────────────────────────────────────────────────────

export async function getInventory(
  businessId: string,
  filter?: 'all' | 'low_stock' | 'out_of_stock'
): Promise<InventoryWithBarber[]> {
  const items = await prisma.inventoryItem.findMany({
    where: { businessId },
    include: {
      barber: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  })

  if (filter === 'low_stock') {
    return items.filter(i => i.stock <= i.threshold && i.stock > 0)
  }
  if (filter === 'out_of_stock') {
    return items.filter(i => i.stock <= 0)
  }
  return items
}

export async function getLowStockItems(businessId: string): Promise<LowStockItem[]> {
  const items = await prisma.inventoryItem.findMany({
    where: { businessId },
    include: { barber: { select: { name: true } } },
  })

  return items
    .filter(i => i.stock <= i.threshold)
    .map(i => ({
      id: i.id,
      name: i.name,
      stock: i.stock,
      threshold: i.threshold,
      unit: i.unit,
      barberName: i.barber?.name || null,
      deficit: i.threshold - i.stock,
    }))
    .sort((a, b) => b.deficit - a.deficit)
}

export async function updateStock(
  itemId: string,
  businessId: string,
  newStock: number,
): Promise<InventoryItem> {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, businessId },
  })

  if (!item) {
    throw new Error('Inventory item not found')
  }

  return prisma.inventoryItem.update({
    where: { id: itemId },
    data: { stock: newStock },
  })
}

export async function adjustStock(
  itemId: string,
  businessId: string,
  adjustment: number,
): Promise<InventoryItem> {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, businessId },
  })

  if (!item) {
    throw new Error('Inventory item not found')
  }

  const newStock = Math.max(0, item.stock + adjustment)
  return prisma.inventoryItem.update({
    where: { id: itemId },
    data: { stock: newStock },
  })
}

'use client'

import { useState } from 'react'
import {
  Package,
  Plus,
  Minus,
  Trash2,
  AlertTriangle,
  Search,
  X,
  Edit3,
  Archive,
  ArchiveRestore,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface InventoryItem {
  id: string
  businessId: string
  barberId: string | null
  barber?: { name: string } | null
  name: string
  sku: string | null
  stock: number
  unit: string
  threshold: number
  cost: number | null
  vendor: string | null
  notes: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

interface Barber {
  id: string
  name: string
}

export interface InventoryItemFormData {
  name: string
  sku: string
  stock: number
  unit: string
  threshold: number
  cost: number | null
  vendor: string
  barberId: string | null
  notes: string
}

interface InventoryClientProps {
  initialItems: InventoryItem[]
  barbers: Barber[]
}

export function InventoryClient({ initialItems, barbers }: InventoryClientProps) {
  const [items, setItems] = useState<InventoryItem[]>(initialItems)
  const [filter, setFilter] = useState<'all' | 'low_stock' | 'out_of_stock' | 'archived'>('all')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)

  const filtered = items.filter(i => {
    if (filter === 'archived' ? !i.archivedAt : !!i.archivedAt) return false
    if (filter === 'low_stock' && !(i.stock <= i.threshold && i.stock > 0)) return false
    if (filter === 'out_of_stock' && i.stock > 0) return false
    if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const lowStockCount = items.filter(i => !i.archivedAt && i.stock <= i.threshold && i.stock > 0).length
  const outOfStockCount = items.filter(i => !i.archivedAt && i.stock <= 0).length
  const archivedCount = items.filter(i => i.archivedAt).length

  const handleSave = async (data: InventoryItemFormData) => {
    try {
      const url = editingItem
        ? `/api/dashboard/inventory/${editingItem.id}`
        : '/api/dashboard/inventory'
      const method = editingItem ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        const saved = await res.json()
        if (editingItem) {
          setItems(prev => prev.map(i => i.id === saved.id ? { ...saved, barber: i.barber } : i))
        } else {
          setItems(prev => [...prev, saved])
        }
        setShowForm(false)
        setEditingItem(null)
      }
    } catch (err) {
      console.error('Save error:', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this item?')) return
    try {
      await fetch(`/api/dashboard/inventory/${id}`, { method: 'DELETE' })
      setItems(prev => prev.filter(i => i.id !== id))
    } catch (err) {
      console.error('Delete error:', err)
    }
  }

  const handleToggleArchive = async (item: InventoryItem) => {
    const archived = !item.archivedAt
    if (!confirm(
      archived
        ? `Archive "${item.name}"? It will be hidden from lists and low-stock alerts but its history is preserved.`
        : `Restore "${item.name}" to active inventory?`
    )) return
    try {
      const res = await fetch(`/api/dashboard/inventory/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || 'Failed to update item')
        return
      }
      const data = await res.json()
      setItems(prev => prev.map(i => (i.id === item.id ? { ...i, archivedAt: data.archivedAt } : i)))
    } catch (err) {
      console.error('Archive error:', err)
      alert('An error occurred')
    }
  }

  const handleAdjust = async (item: InventoryItem, adjustment: number) => {
    try {
      const res = await fetch(`/api/dashboard/inventory/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustment }),
      })
      if (res.ok) {
        const updated = await res.json()
        setItems(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated, barber: i.barber } : i))
      }
    } catch (err) {
      console.error('Adjust error:', err)
    }
  }

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-serif">Inventory</h1>
          <p className="text-sm text-muted-foreground mt-1">Track products, supplies & stock levels</p>
        </div>
        <button
          onClick={() => { setEditingItem(null); setShowForm(true) }}
          className="px-4 py-2 rounded-lg bg-[var(--dash-brand-soft)] text-[var(--dash-brand)] border border-[var(--dash-brand-border)] hover:bg-[var(--dash-brand-soft)] text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Item
        </button>
      </div>

      {/* Alert Banners */}
      {outOfStockCount > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{outOfStockCount} item{outOfStockCount !== 1 ? 's' : ''} out of stock</span>
        </div>
      )}
      {lowStockCount > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{lowStockCount} item{lowStockCount !== 1 ? 's' : ''} running low</span>
        </div>
      )}

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-2">
          {(['all', 'low_stock', 'out_of_stock', 'archived'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                filter === f
                  ? 'bg-[var(--dash-brand-soft)] text-[var(--dash-brand)] border-[var(--dash-brand-border)]'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground'
              )}
            >
              {f === 'all' ? 'All' : f === 'low_stock' ? 'Low Stock' : f === 'out_of_stock' ? 'Out of Stock' : `Archived${archivedCount ? ` (${archivedCount})` : ''}`}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search items..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-card border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-ring/50"
          />
        </div>
      </div>

      {/* Inventory Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            {items.length === 0 ? 'No inventory items yet. Click "Add Item" to get started.' : 'No items match your filter.'}
          </p>
        </div>
      ) : (
        <div className="bg-card/50 border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs uppercase border-b border-border">
                  <th className="text-left py-3 px-4 font-medium">Item</th>
                  <th className="text-left py-3 px-4 font-medium hidden md:table-cell">Assigned To</th>
                  <th className="text-center py-3 px-4 font-medium">Stock</th>
                  <th className="text-center py-3 px-4 font-medium hidden lg:table-cell">Threshold</th>
                  <th className="text-right py-3 px-4 font-medium hidden lg:table-cell">Cost</th>
                  <th className="text-center py-3 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => {
                  const isOut = item.stock <= 0
                  const isLow = item.stock <= item.threshold && item.stock > 0
                  return (
                    <tr key={item.id} className="border-b border-border/50 hover:bg-[var(--dash-hover)]">
                      <td className="py-3 px-4">
                        <div className="text-foreground font-medium">{item.name}</div>
                        {item.sku && <div className="text-xs text-muted-foreground mt-0.5">SKU: {item.sku}</div>}
                        {item.vendor && <div className="text-xs text-muted-foreground mt-0.5">Vendor: {item.vendor}</div>}
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        {item.barber?.name ? (
                          <span className="text-muted-foreground">{item.barber.name}</span>
                        ) : (
                          <span className="text-muted-foreground italic text-xs">Shop-wide</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={cn(
                          'inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold border',
                          isOut
                            ? 'bg-red-500/10 text-red-400 border-red-500/20'
                            : isLow
                              ? 'bg-orange-500/10 text-orange-400 border-orange-500/20'
                              : 'bg-muted text-foreground/85 border-input'
                        )}>
                          {item.stock} {item.unit}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center hidden lg:table-cell text-muted-foreground">
                        {item.threshold} {item.unit}
                      </td>
                      <td className="py-3 px-4 text-right hidden lg:table-cell text-muted-foreground">
                        {item.cost ? `$${item.cost.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleAdjust(item, -1)}
                            className="w-7 h-7 rounded-md bg-muted hover:bg-red-950/40 text-muted-foreground hover:text-red-400 flex items-center justify-center transition-colors"
                            title="Decrease stock by 1"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleAdjust(item, 1)}
                            className="w-7 h-7 rounded-md bg-muted hover:bg-emerald-950/40 text-muted-foreground hover:text-emerald-400 flex items-center justify-center transition-colors"
                            title="Increase stock by 1"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => { setEditingItem(item); setShowForm(true) }}
                            className="w-7 h-7 rounded-md bg-muted hover:bg-[var(--dash-hover)] text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
                            title="Edit"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleArchive(item)}
                            className="w-7 h-7 rounded-md bg-muted hover:bg-[var(--dash-hover)] text-muted-foreground hover:text-[var(--dash-brand)] flex items-center justify-center transition-colors"
                            title={item.archivedAt ? 'Restore to active inventory' : 'Archive (keep history)'}
                          >
                            {item.archivedAt ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="w-7 h-7 rounded-md bg-muted hover:bg-red-950/40 text-muted-foreground hover:text-red-400 flex items-center justify-center transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {showForm && (
        <InventoryForm
          item={editingItem}
          barbers={barbers}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditingItem(null) }}
        />
      )}
    </div>
  )
}

// ─── Inventory Form Modal ───────────────────────────────────────────────────

function InventoryForm({
  item,
  barbers,
  onSave,
  onClose,
}: {
  item: InventoryItem | null
  barbers: Barber[]
  onSave: (data: InventoryItemFormData) => void
  onClose: () => void
}) {
  const [name, setName] = useState(item?.name || '')
  const [sku, setSku] = useState(item?.sku || '')
  const [stock, setStock] = useState(item?.stock?.toString() || '0')
  const [unit, setUnit] = useState(item?.unit || 'each')
  const [threshold, setThreshold] = useState(item?.threshold?.toString() || '5')
  const [cost, setCost] = useState(item?.cost?.toString() || '')
  const [vendor, setVendor] = useState(item?.vendor || '')
  const [barberId, setBarberId] = useState(item?.barberId || '')
  const [notes, setNotes] = useState(item?.notes || '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      name,
      sku,
      stock: parseFloat(stock) || 0,
      unit,
      threshold: parseFloat(threshold) || 5,
      cost: cost ? parseFloat(cost) : null,
      vendor,
      barberId: barberId || null,
      notes,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            {item ? 'Edit Item' : 'Add Inventory Item'}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground/85">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg bg-[var(--dash-surface)] border border-border text-foreground text-sm focus:outline-none focus:border-ring/50"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
  <label className="block text-sm text-muted-foreground mb-1">SKU <span className="text-muted-foreground">(optional)</span></label>
  <p className="mb-1.5 text-[11px] text-muted-foreground">SKU means Stock Keeping Unit. Use it as an optional identifier for tracking products.</p>
  <input
                type="text"
                value={sku}
                onChange={e => setSku(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--dash-surface)] border border-border text-foreground text-sm focus:outline-none focus:border-ring/50"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Unit</label>
              <input
                type="text"
                value={unit}
                onChange={e => setUnit(e.target.value)}
                placeholder="each, box, bottle..."
                className="w-full px-3 py-2 rounded-lg bg-[var(--dash-surface)] border border-border text-foreground text-sm focus:outline-none focus:border-ring/50"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Stock</label>
              <input
                type="number"
                step="0.1"
                value={stock}
                onChange={e => setStock(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--dash-surface)] border border-border text-foreground text-sm focus:outline-none focus:border-ring/50"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Low Stock Threshold</label>
              <input
                type="number"
                step="0.1"
                value={threshold}
                onChange={e => setThreshold(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--dash-surface)] border border-border text-foreground text-sm focus:outline-none focus:border-ring/50"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Cost</label>
              <input
                type="number"
                step="0.01"
                value={cost}
                onChange={e => setCost(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 rounded-lg bg-[var(--dash-surface)] border border-border text-foreground text-sm focus:outline-none focus:border-ring/50"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Vendor</label>
              <input
                type="text"
                value={vendor}
                onChange={e => setVendor(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--dash-surface)] border border-border text-foreground text-sm focus:outline-none focus:border-ring/50"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Assigned To</label>
            <select
              value={barberId}
              onChange={e => setBarberId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[var(--dash-surface)] border border-border text-foreground text-sm focus:outline-none focus:border-ring/50"
            >
              <option value="">Shop-wide</option>
              {barbers.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-[var(--dash-surface)] border border-border text-foreground text-sm focus:outline-none focus:border-ring/50 resize-none"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 px-4 py-2 rounded-lg bg-[var(--dash-brand-soft)] text-[var(--dash-brand)] border border-[var(--dash-brand-border)] hover:bg-[var(--dash-brand-soft)] text-sm font-medium transition-colors"
            >
              {item ? 'Save Changes' : 'Add Item'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-muted text-muted-foreground border border-input hover:text-foreground text-sm font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

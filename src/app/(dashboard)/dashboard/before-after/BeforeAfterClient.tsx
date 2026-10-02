'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import {
  ArrowLeftRight, Plus, Trash2, X, Eye, EyeOff, GripVertical, Image as ImageIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// Before/After manager — owner-curated real transformation pairs.
//
// Pairs reference two existing media assets of this shop (uploaded via
// Photos). Optional barber/service attribution powers the deep links on
// the public homepage. Publish/unpublish controls homepage visibility.
// All write operations go through /api/dashboard/before-after, which
// re-validates asset ownership and attribution server-side.
// ─────────────────────────────────────────────────────────────────────────────

export interface PairAsset { id: string; url: string; altText?: string | null }

export interface BeforeAfterPairItem {
  id: string
  beforeAsset: PairAsset
  afterAsset: PairAsset
  barberId?: string | null
  barberName?: string | null
  serviceId?: string | null
  serviceName?: string | null
  caption?: string | null
  details?: string | null
  sortOrder: number
  isPublished: boolean
}

export interface Option { id: string; name: string }

export interface MediaOption { id: string; url: string; type: string; altText?: string | null }

interface BeforeAfterClientProps {
  initialPairs: BeforeAfterPairItem[]
  barbers: Option[]
  services: Option[]
  media: MediaOption[]
  canManage: boolean // owners/admins can publish + delete; barbers manage their own
}

const emptyForm = { beforeAssetId: '', afterAssetId: '', barberId: '', serviceId: '', caption: '', details: '' }

export function BeforeAfterClient({ initialPairs, barbers, services, media, canManage }: BeforeAfterClientProps) {
  const { toast } = useToast()
  const [pairs, setPairs] = useState<BeforeAfterPairItem[]>(initialPairs)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const resetForm = () => {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(false)
  }

  const startEdit = (pair: BeforeAfterPairItem) => {
    setEditingId(pair.id)
    setShowForm(true)
    setForm({
      beforeAssetId: pair.beforeAsset.id,
      afterAssetId: pair.afterAsset.id,
      barberId: pair.barberId ?? '',
      serviceId: pair.serviceId ?? '',
      caption: pair.caption ?? '',
      details: pair.details ?? '',
    })
  }

  const savePair = async () => {
    if (!form.beforeAssetId || !form.afterAssetId) {
      toast({ title: 'Pick both images', description: 'A pair needs a before AND an after photo.', variant: 'destructive' })
      return
    }
    if (form.beforeAssetId === form.afterAssetId) {
      toast({ title: 'Images must differ', description: 'Before and after must be two different photos.', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const payload = {
        beforeAssetId: form.beforeAssetId,
        afterAssetId: form.afterAssetId,
        barberId: form.barberId || null,
        serviceId: form.serviceId || null,
        caption: form.caption || null,
        details: form.details || null,
      }
      const res = editingId
        ? await fetch(`/api/dashboard/before-after/${editingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/dashboard/before-after', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to save pair')
      toast({ title: editingId ? 'Pair updated' : 'Pair created' })
      // Refresh the full list (server returns enriched records)
      const listRes = await fetch('/api/dashboard/before-after')
      const listData = await listRes.json().catch(() => null)
      if (listRes.ok && listData?.pairs) setPairs(listData.pairs)
      resetForm()
    } catch (err) {
      toast({ title: 'Failed to save pair', description: err instanceof Error ? err.message : 'Unknown error. Please retry.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const togglePublish = async (pair: BeforeAfterPairItem) => {
    const next = !pair.isPublished
    setPairs((prev) => prev.map((p) => (p.id === pair.id ? { ...p, isPublished: next } : p)))
    try {
      const res = await fetch(`/api/dashboard/before-after/${pair.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublished: next }),
      })
      if (!res.ok) throw new Error('Failed')
      toast({ title: next ? 'Pair published' : 'Pair hidden from the site' })
    } catch {
      setPairs((prev) => prev.map((p) => (p.id === pair.id ? { ...p, isPublished: pair.isPublished } : p)))
      toast({ title: 'Failed to update pair', variant: 'destructive' })
    }
  }

  const movePair = async (pair: BeforeAfterPairItem, delta: -1 | 1) => {
    const visible = pairs.filter((p) => p.barberId === pair.barberId || true)
    const index = visible.findIndex((p) => p.id === pair.id)
    const target = index + delta
    if (target < 0 || target >= visible.length) return
    const next = [...visible]
    ;[next[index], next[target]] = [next[target], next[index]]
    const reordered = next.map((p, i) => ({ ...p, sortOrder: i }))
    setPairs(reordered)
    try {
      await Promise.all(
        reordered.map((p) =>
          fetch(`/api/dashboard/before-after/${p.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sortOrder: p.sortOrder }),
          })
        )
      )
    } catch {
      toast({ title: 'Failed to save new order', variant: 'destructive' })
    }
  }

  const deletePair = async (pair: BeforeAfterPairItem) => {
    if (!window.confirm('Delete this before/after pair? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/dashboard/before-after/${pair.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      setPairs((prev) => prev.filter((p) => p.id !== pair.id))
      toast({ title: 'Pair deleted' })
    } catch {
      toast({ title: 'Failed to delete pair', variant: 'destructive' })
    }
  }

  const selectClass = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none'

  const assetLabel = (m: MediaOption) => {
    const typeLabel = m.type.replace(/_/g, ' ').toLowerCase()
    return `${m.altText || 'Untitled'} (${typeLabel})`
  }

  return (
    <div className="space-y-6">
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ArrowLeftRight className="h-5 w-5 text-amber-500" aria-hidden="true" />
            Before &amp; After
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-zinc-400">
            Curate real transformation pairs from your uploaded photos. Published pairs appear in
            the Before &amp; After section of your homepage (enable it under Settings → Appearance →
            Homepage Sections).
          </p>

          {!showForm ? (
            <Button
              onClick={() => { setForm(emptyForm); setEditingId(null); setShowForm(true) }}
              className="bg-amber-500 text-zinc-950 hover:bg-amber-400"
              disabled={media.length < 2}
            >
              <Plus className="h-4 w-4 mr-1" aria-hidden="true" /> New pair
            </Button>
          ) : (
            <div className="rounded-lg border border-zinc-700 bg-zinc-950/50 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-100">
                  {editingId ? 'Edit pair' : 'New pair'}
                </h3>
                <button
                  type="button"
                  onClick={resetForm}
                  aria-label="Close form"
                  className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-zinc-300 mb-1 block">Before photo</Label>
                  <select
                    value={form.beforeAssetId}
                    onChange={(e) => setForm({ ...form, beforeAssetId: e.target.value })}
                    className={selectClass}
                    aria-label="Before photo"
                  >
                    <option value="">Select a photo…</option>
                    {media.map((m) => (
                      <option key={m.id} value={m.id}>{assetLabel(m)}</option>
                    ))}
                  </select>
                  {form.beforeAssetId && (
                    <Thumb url={media.find((m) => m.id === form.beforeAssetId)?.url} />
                  )}
                </div>
                <div>
                  <Label className="text-zinc-300 mb-1 block">After photo</Label>
                  <select
                    value={form.afterAssetId}
                    onChange={(e) => setForm({ ...form, afterAssetId: e.target.value })}
                    className={selectClass}
                    aria-label="After photo"
                  >
                    <option value="">Select a photo…</option>
                    {media.map((m) => (
                      <option key={m.id} value={m.id}>{assetLabel(m)}</option>
                    ))}
                  </select>
                  {form.afterAssetId && (
                    <Thumb url={media.find((m) => m.id === form.afterAssetId)?.url} />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-zinc-300 mb-1 block">Barber <span className="text-zinc-500">(optional)</span></Label>
                  <select
                    value={form.barberId}
                    onChange={(e) => setForm({ ...form, barberId: e.target.value })}
                    className={selectClass}
                    aria-label="Barber attribution"
                  >
                    <option value="">No attribution</option>
                    {barbers.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-zinc-300 mb-1 block">Service <span className="text-zinc-500">(optional — powers the booking link)</span></Label>
                  <select
                    value={form.serviceId}
                    onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
                    className={selectClass}
                    aria-label="Service attribution"
                  >
                    <option value="">No service</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <Label className="text-zinc-300 mb-1 block">Caption <span className="text-zinc-500">(optional, short)</span></Label>
                <Input
                  value={form.caption}
                  maxLength={120}
                  onChange={(e) => setForm({ ...form, caption: e.target.value })}
                  className="bg-zinc-950 border-zinc-700"
                  placeholder="Skin fade + beard reshape"
                />
              </div>
              <div>
                <Label className="text-zinc-300 mb-1 block">Details <span className="text-zinc-500">(optional)</span></Label>
                <Textarea
                  value={form.details}
                  maxLength={1000}
                  rows={2}
                  onChange={(e) => setForm({ ...form, details: e.target.value })}
                  className="bg-zinc-950 border-zinc-700"
                  placeholder="What was done, products used, time it took…"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={resetForm} className="border-zinc-700 text-zinc-300">Cancel</Button>
                <Button
                  onClick={savePair}
                  disabled={saving || !form.beforeAssetId || !form.afterAssetId}
                  className="bg-amber-500 text-zinc-950 hover:bg-amber-400"
                >
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create pair'}
                </Button>
              </div>
            </div>
          )}

          {media.length < 2 && (
            <p className="text-xs text-zinc-500">
              Upload at least two photos under{' '}
              <a href="/dashboard/media" className="text-amber-500 underline">Photos</a>{' '}
              to create a pair.
            </p>
          )}

          {pairs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 p-8 text-center">
              <ImageIcon className="mx-auto h-8 w-8 text-zinc-600" aria-hidden="true" />
              <p className="mt-2 text-sm text-zinc-400">No before/after pairs yet.</p>
            </div>
          ) : (
            <ol className="space-y-3" aria-label="Before/after pairs">
              {pairs.map((pair, index) => (
                <li
                  key={pair.id}
                  className={cn(
                    'rounded-lg border bg-zinc-950/50',
                    pair.isPublished ? 'border-zinc-700' : 'border-zinc-800 opacity-70'
                  )}
                >
                  <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-1 self-start sm:self-center">
                      <GripVertical className="h-4 w-4 text-zinc-600" aria-hidden="true" />
                      <div className="flex flex-col">
                        <button
                          type="button"
                          onClick={() => movePair(pair, -1)}
                          disabled={index === 0}
                          aria-label="Move pair up"
                          className="text-zinc-400 hover:text-zinc-100 disabled:opacity-25"
                        >▲</button>
                        <button
                          type="button"
                          onClick={() => movePair(pair, 1)}
                          disabled={index === pairs.length - 1}
                          aria-label="Move pair down"
                          className="text-zinc-400 hover:text-zinc-100 disabled:opacity-25"
                        >▼</button>
                      </div>
                    </div>

                    <div className="flex flex-1 gap-2">
                      <div className="relative w-1/2 overflow-hidden rounded-md bg-zinc-800">
                        <img src={pair.beforeAsset.url} alt={pair.beforeAsset.altText || 'Before'} className="h-24 w-full object-cover" />
                        <span className="absolute left-1 top-1 rounded bg-zinc-950/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-200">Before</span>
                      </div>
                      <div className="relative w-1/2 overflow-hidden rounded-md bg-zinc-800">
                        <img src={pair.afterAsset.url} alt={pair.afterAsset.altText || 'After'} className="h-24 w-full object-cover" />
                        <span className="absolute left-1 top-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-950">After</span>
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-100">
                        {pair.caption || 'Untitled pair'}
                      </p>
                      <p className="truncate text-xs text-zinc-500">
                        {[pair.barberName, pair.serviceName].filter(Boolean).join(' · ') || 'No attribution'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => togglePublish(pair)}
                          aria-label={pair.isPublished ? 'Hide from website' : 'Publish to website'}
                          className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                        >
                          {pair.isPublished ? <Eye className="h-4 w-4" aria-hidden="true" /> : <EyeOff className="h-4 w-4" aria-hidden="true" />}
                        </button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => startEdit(pair)} className="border-zinc-700 text-zinc-300">
                        Edit
                      </Button>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => deletePair(pair)}
                          aria-label="Delete pair"
                          className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-red-950/50 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Thumb({ url }: { url?: string }) {
  if (!url) return null
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-zinc-800">
      <img src={url} alt="" className="h-20 w-full object-cover" aria-hidden="true" />
    </div>
  )
}

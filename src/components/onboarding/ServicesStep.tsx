'use client'

// Onboarding Step — Services.
// The owner builds their service menu. Services are persisted immediately to
// the authenticated owner's business, so leaving and returning resumes here.
// Payment is collected in person — there is no online payment in this product,
// and that is surfaced clearly to the owner throughout this step.

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, ArrowRight, Loader2, Pencil,Trash2, Banknote, Scissors } from 'lucide-react'

export interface ServiceItem {
  id: string
  name: string
  description: string | null
  duration: number
  price: number
  isActive: boolean
}

interface ServicesStepProps {
  submitting: boolean
  serverError: string | null
  onContinue: () => void
  onBack: () => void
}

interface FormState {
  name: string
  description: string
  duration: string
  price: string
  isActive: boolean
}

const emptyForm: FormState = {
  name: '',
  description: '',
  duration: '30',
  price: '',
  isActive: true,
}

export function ServicesStep({ submitting, serverError, onContinue, onBack }: ServicesStepProps) {
  const [services, setServices] = useState<ServiceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/onboarding/services')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load services')
      setServices(json.services || [])
    } catch (err) {
      setLoadError(err.message || 'Something went wrong loading your services.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const activeCount = services.filter((s) => s.isActive).length

  function validate(f: FormState): Record<string, string> {
    const e: Record<string, string> = {}
    if (!f.name.trim()) e.name = 'Service name is required'
    else if (f.name.trim().length > 100) e.name = 'Keep the name under 100 characters'
    const dur = Number(f.duration)
    if (!f.duration || Number.isNaN(dur)) e.duration = 'Duration is required'
    else if (dur < 5) e.duration = 'Minimum 5 minutes'
    else if (dur > 480) e.duration = 'Maximum 480 minutes (8 hours)'
    const price = Number(f.price)
    if (f.price === '' || Number.isNaN(price)) e.price = 'Price is required'
    else if (price < 0) e.price = 'Price cannot be negative'
    else if (price > 10000) e.price = 'Price seems too high'
    return e
  }

  function startEdit(s: ServiceItem) {
    setEditingId(s.id)
    setForm({
      name: s.name,
      description: s.description || '',
      duration: String(s.duration),
      price: String(s.price),
      isActive: s.isActive,
    })
    setErrors({})
    setActionError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setEditingId(null)
    setForm(emptyForm)
    setErrors({})
    setActionError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const v = validate(form)
    setErrors(v)
    if (Object.keys(v).length > 0) return

    setBusy(true)
    setActionError(null)
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      duration: Number(form.duration),
      price: Number(form.price),
      isActive: form.isActive,
    }
    try {
      if (editingId) {
        const res = await fetch(`/api/dashboard/onboarding/services/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Failed to update service')
        setServices((prev) => prev.map((s) => (s.id === editingId ? json.service : s)))
      } else {
        const res = await fetch('/api/dashboard/onboarding/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = await res.json()
        if (!res.ok) {
          if (json.details) {
            const first = Object.values(json.details)[0]
            throw new Error(Array.isArray(first) ? first[0] : first)
          }
          throw new Error(json.error || 'Failed to add service')
        }
        setServices((prev) => [...prev, json.service])
      }
      resetForm()
    } catch (err) {
      setActionError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this service? This cannot be undone.')) return
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/dashboard/onboarding/services/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error || 'Failed to delete service')
      }
      setServices((prev) => prev.filter((s) => s.id !== id))
      if (editingId === id) resetForm()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
        <p className="mt-3 text-sm">Loading your services…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-sm text-red-300">{loadError}</p>
        <Button variant="outline" className="mt-4" onClick={load}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <Card className="border-zinc-800 bg-zinc-900/60 max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-zinc-100">Services</CardTitle>
        <CardDescription>
          Add the services your shop offers. Customers will book these online.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Payment-in-person banner — no online payments exist */}
        <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="text-sm">
            <p className="font-medium text-amber-200">Payment is collected in person</p>
            <p className="mt-0.5 text-xs text-amber-200/70">
              There is no online payment in this product. Prices here are for display only —
              customers pay at the chair after their service.
            </p>
          </div>
        </div>

        {/* Status + existing services */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-400">
            {services.length === 0
              ? 'No services yet'
              : `${services.length} service${services.length === 1 ? '' : 's'} · ${activeCount} active`}
          </p>
          {editingId && (
            <Button variant="ghost" size="sm" onClick={resetForm}>
              Cancel edit
            </Button>
          )}
        </div>

        {/* Service list */}
        {services.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700 py-12 text-center">
            <Scissors className="h-8 w-8 text-zinc-600" />
            <p className="mt-3 text-sm font-medium text-zinc-300">No services yet</p>
            <p className="mt-1 text-xs text-zinc-500">Add your first service using the form below.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {services.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-zinc-100">{s.name}</p>
                    {!s.isActive && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {s.duration} min · ${s.price.toFixed(2)}
                    {s.description ? ` · ${s.description}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(s)} disabled={busy}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-400 hover:text-red-300"
                    onClick={() => handleDelete(s.id)}
                    disabled={busy}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Add / edit form */}
        <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950/30 p-4">
          <p className="text-sm font-medium text-zinc-200">{editingId ? 'Edit service' : 'Add a service'}</p>
          <div>
            <Label className="text-zinc-300">Service name</Label>
            <Input
              className="mt-1.5"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Men's Fade"
            />
            {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
          </div>
          <div>
            <Label className="text-zinc-300">Description (optional)</Label>
            <Textarea
              className="mt-1.5"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Briefly describe what's included"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-zinc-300">Duration (minutes)</Label>
              <Input
                type="number"
                min={5}
                max={480}
                step={5}
                className="mt-1.5"
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
              />
              {errors.duration && <p className="mt-1 text-xs text-red-400">{errors.duration}</p>}
            </div>
            <div>
              <Label className="text-zinc-300">Price ($)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                className="mt-1.5"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder="0.00"
              />
              {errors.price && <p className="mt-1 text-xs text-red-400">{errors.price}</p>}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="h-4 w-4 rounded border-zinc-700"
            />
            Active (available for booking)
          </label>

          {actionError && <p className="text-sm text-red-400">{actionError}</p>}

          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? 'Save changes' : 'Add service'}
            </Button>
          </div>
        </form>

        {serverError && <p className="text-sm text-red-400">{serverError}</p>}

        {/* Navigation */}
        <div className="flex items-center justify-between border-t border-zinc-800 pt-4">
          <Button variant="outline" onClick={onBack} disabled={submitting}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
          </Button>
          <div className="flex flex-col items-end gap-1">
            <Button onClick={onContinue} disabled={submitting || busy}>
              Continue <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
            {activeCount === 0 && (
              <p className="text-xs text-amber-400">Add at least one active service to finish setup.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

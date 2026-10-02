'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Loader2, Scissors, Check } from 'lucide-react'

interface ServiceFormProps {
  service?: {
    id: string
    name: string
    description?: string | null
    duration: number
    price: number
    isActive: boolean
    barbers?: Array<{ barberId?: string; id?: string; barber?: { id?: string } }>
  } | null
  barbers: Array<{
    id: string
    name: string
    isActive?: boolean
  }>
  isOpen: boolean
  onClose: () => void
  onSave: () => void
}

export function ServiceForm({ service, barbers, isOpen, onClose, onSave }: ServiceFormProps) {
  const isEdit = Boolean(service?.id)

  const initialAssignedBarberIds = service?.barbers
    ? service.barbers.map((b) => b.barberId || b.id || b.barber?.id).filter(Boolean)
    : barbers.map((b) => b.id)

  const [name, setName] = useState(service?.name || '')
  const [description, setDescription] = useState(service?.description || '')
  const [duration, setDuration] = useState(service?.duration ? String(service.duration) : '30')
  const [price, setPrice] = useState(service?.price !== undefined ? String(service.price) : '35')
  const [isActive, setIsActive] = useState(service?.isActive ?? true)
  const [selectedBarberIds, setSelectedBarberIds] = useState<string[]>(initialAssignedBarberIds)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleBarberToggle = (barberId: string) => {
    if (selectedBarberIds.includes(barberId)) {
      setSelectedBarberIds(selectedBarberIds.filter((id) => id !== barberId))
    } else {
      setSelectedBarberIds([...selectedBarberIds, barberId])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Service name is required')
      return
    }

    const durNum = parseInt(duration, 10)
    if (isNaN(durNum) || durNum <= 0) {
      setError('Duration must be greater than 0 minutes')
      return
    }

    const priceNum = parseFloat(price)
    if (isNaN(priceNum) || priceNum < 0) {
      setError('Price must be greater than or equal to $0')
      return
    }

    setLoading(true)

    try {
      const url = isEdit ? `/api/dashboard/services/${service!.id}` : '/api/dashboard/services'
      const method = isEdit ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          duration: durNum,
          price: priceNum,
          isActive,
          barberIds: selectedBarberIds,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save service')
      }

      onSave()
      onClose()
    } catch (err) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="bg-[var(--dash-surface)] border-border text-foreground max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-serif text-amber-400 flex items-center gap-2">
            <Scissors className="w-5 h-5 text-amber-500" />
            {isEdit ? 'Edit Service' : 'Add New Service'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-foreground/85">Service Name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Classic Haircut, Beard Trim"
              className="bg-card border-border text-xs focus:border-amber-500"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-foreground/85">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary of what this service includes..."
              className="bg-card border-border text-xs focus:border-amber-500 min-h-[70px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-foreground/85">Duration (Minutes) *</Label>
              <Input
                type="number"
                min="5"
                step="5"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="bg-card border-border text-xs focus:border-amber-500 font-mono"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-foreground/85">Price ($) *</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="bg-card border-border text-xs focus:border-amber-500 font-mono"
                required
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-3 bg-card/60 border border-border/80 rounded-xl">
            <div>
              <p className="text-xs font-semibold text-foreground">Active Service</p>
              <p className="text-[11px] text-muted-foreground">Available for online client booking</p>
            </div>
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                isActive ? 'bg-amber-500' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  isActive ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="space-y-2 pt-2">
            <Label className="text-xs text-foreground/85">Assign Barbers who offer this service</Label>
            <div className="bg-card/60 border border-border/80 rounded-xl p-3 space-y-2 max-h-40 overflow-y-auto">
              {barbers.length === 0 ? (
                <p className="text-xs text-muted-foreground">No active barbers available.</p>
              ) : (
                barbers.map((barber) => {
                  const checked = selectedBarberIds.includes(barber.id)
                  return (
                    <label
                      key={barber.id}
                      onClick={() => handleBarberToggle(barber.id)}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-[var(--dash-hover)] cursor-pointer text-xs transition-colors"
                    >
                      <span className="font-medium text-foreground">{barber.name}</span>
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                          checked
                            ? 'bg-amber-500 border-amber-500 text-zinc-950'
                            : 'border-input bg-card'
                        }`}
                      >
                        {checked && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </label>
                  )
                })
              )}
            </div>
          </div>

          <DialogFooter className="pt-4 border-t border-border/80">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="bg-card border-border text-foreground/85 hover:bg-[var(--dash-hover)] text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs gap-2"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isEdit ? 'Save Changes' : 'Create Service'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

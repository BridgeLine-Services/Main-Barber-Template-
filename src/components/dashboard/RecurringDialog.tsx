'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Repeat, Loader2, CheckCircle2, AlertTriangle,Calendar } from 'lucide-react'
import type { RecurringPreview } from '@/lib/recurring'

interface RecurringDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  barbers: { id: string; name: string }[]
  services: { id: string; name: string; duration: number; price: number }[]
  defaultBarberId?: string
  defaultServiceId?: string
  defaultDate?: string
}

export function RecurringDialog({
  open,
  onOpenChange,
  barbers,
  services,
  defaultBarberId,
  defaultServiceId,
  defaultDate,
}: RecurringDialogProps) {
  const [barberId, setBarberId] = useState(defaultBarberId || '')
  const [serviceId, setServiceId] = useState(defaultServiceId || '')
  const [startDate, setStartDate] = useState(defaultDate || '')
  const [intervalWeeks, setIntervalWeeks] = useState(3)
  const [totalOccurrences, setTotalOccurrences] = useState(6)
  const [preferredTime, setPreferredTime] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')

  const [preview, setPreview] = useState<RecurringPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handlePreview = async () => {
    if (!barberId || !serviceId || !startDate || !preferredTime) {
      setError('Please fill in all fields')
      return
    }

    setLoading(true)
    setError(null)
    setPreview(null)

    try {
      const res = await fetch('/api/dashboard/recurring/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barberId,
          serviceId,
          startDate,
          intervalWeeks,
          totalOccurrences,
          preferredTime,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to preview')
      setPreview(data)
    } catch (err) {
      setError(err.message || 'Failed to generate preview')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!customerName || !customerPhone || !customerEmail) {
      setError('Please fill in customer information')
      return
    }

    setCreating(true)
    setError(null)

    const [firstName, ...lastNameParts] = customerName.split(' ')
    const lastName = lastNameParts.join(' ') || ''

    try {
      const res = await fetch('/api/dashboard/recurring/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barberId,
          serviceId,
          startDate,
          intervalWeeks,
          totalOccurrences,
          preferredTime,
          customerData: {
            firstName,
            lastName,
            phone: customerPhone,
            email: customerEmail,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create recurring appointments')

      setSuccess(true)
      setTimeout(() => {
        onOpenChange(false)
        setSuccess(false)
        setPreview(null)
        window.location.reload()
      }, 2500)
    } catch (err) {
      setError(err.message || 'Failed to create appointments')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--dash-surface)] border-border text-foreground max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-400 font-serif">
            <Repeat className="w-5 h-5" />
            Recurring Appointment
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Create a series of appointments with conflict detection
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-3" />
            <p className="text-lg font-semibold text-foreground">Recurring Appointments Created!</p>
            <p className="text-sm text-muted-foreground mt-1">The appointment series has been scheduled.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Configuration */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5">Barber</Label>
                <select
                  value={barberId}
                  onChange={(e) => setBarberId(e.target.value)}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:border-amber-500/50 focus:outline-none"
                >
                  <option value="">Select barber...</option>
                  {barbers.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5">Service</Label>
                <select
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:border-amber-500/50 focus:outline-none"
                >
                  <option value="">Select service...</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.duration}min)</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5">Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-card border-border text-foreground"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5">Preferred Time</Label>
                <Input
                  type="time"
                  value={preferredTime}
                  onChange={(e) => setPreferredTime(e.target.value)}
                  className="bg-card border-border text-foreground"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5">Repeat Every</Label>
                <select
                  value={intervalWeeks}
                  onChange={(e) => setIntervalWeeks(Number(e.target.value))}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:border-amber-500/50 focus:outline-none"
                >
                  <option value={2}>2 weeks</option>
                  <option value={3}>3 weeks</option>
                  <option value={4}>4 weeks</option>
                </select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5"># of Occurrences</Label>
                <select
                  value={totalOccurrences}
                  onChange={(e) => setTotalOccurrences(Number(e.target.value))}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:border-amber-500/50 focus:outline-none"
                >
                  {[3, 4, 6, 8, 10, 12].map((n) => (
                    <option key={n} value={n}>{n} appointments</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Preview Button */}
            <Button
              onClick={handlePreview}
              disabled={loading || !barberId || !serviceId || !startDate || !preferredTime}
              variant="outline"
              className="w-full bg-card border-border text-foreground/85 hover:bg-[var(--dash-hover)]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Checking availability...
                </>
              ) : (
                <>
                  <Calendar className="w-4 h-4 mr-2" />
                  Preview Schedule
                </>
              )}
            </Button>

            {/* Preview Results */}
            {preview && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-400 font-semibold">
                    {preview.availableCount} available
                  </span>
                  {preview.conflictCount > 0 && (
                    <span className="text-amber-400 font-semibold">
                      {preview.conflictCount} conflicts
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto bg-card/60 border border-border/60 rounded-xl p-3">
                  {preview.occurrences.map((occ, i: number) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2 text-xs py-1.5 px-2 rounded-lg ${
                        occ.available
                          ? 'bg-emerald-500/5'
                          : 'bg-amber-500/5'
                      }`}
                    >
                      {occ.available ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      )}
                      <span className="text-foreground font-medium">{occ.dateLabel}</span>
                      {!occ.available && occ.reason && (
                        <span className="text-amber-400/80 text-[10px] ml-auto">
                          {occ.reason}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Customer Info for creating */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <Label className="text-xs text-muted-foreground">Customer Information</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Full name"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="bg-card border-border text-foreground text-sm"
                    />
                    <Input
                      placeholder="Phone"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="bg-card border-border text-foreground text-sm"
                    />
                  </div>
                  <Input
                    placeholder="Email"
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="bg-card border-border text-foreground text-sm"
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg p-3">
                {error}
              </p>
            )}
          </div>
        )}

        {!success && (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="bg-card border-border text-foreground/85 hover:bg-[var(--dash-hover)]"
            >
              Cancel
            </Button>
            {preview && (
              <Button
                onClick={handleCreate}
                disabled={creating || !customerName || !customerPhone || !customerEmail || preview.availableCount === 0}
                className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  `Create ${preview.availableCount} Appointments`
                )}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

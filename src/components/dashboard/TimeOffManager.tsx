'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, Plus, Trash2, Loader2, AlertCircle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface TimeOffManagerProps {
  barberId: string
  initialBlockedTimes: Array<{ id: string; startTime: string; endTime: string; reason?: string | null }>
}

export function TimeOffManager({ barberId, initialBlockedTimes }: TimeOffManagerProps) {
  const router = useRouter()
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('18:00')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleAddBlockedTime = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!startDate || !endDate) {
      setError('Start and end dates are required')
      return
    }

    const start = new Date(`${startDate}T${startTime}:00`)
    const end = new Date(`${endDate}T${endTime}:00`)

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      setError('Invalid date or time format')
      return
    }

    if (end <= start) {
      setError('End date/time must be after start date/time')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/dashboard/blocked-times', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barberId: barberId || null,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          reason: reason.trim() || 'Vacation / Time Off',
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to add blocked time')
      }

      setReason('')
      setStartDate('')
      setEndDate('')
      router.refresh()
    } catch (err) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to remove this time off block?')) return

    setDeletingId(id)
    try {
      const res = await fetch(`/api/dashboard/blocked-times/${id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete blocked time')
      }

      router.refresh()
    } catch (err) {
      alert(err.message || 'An error occurred')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="bg-[var(--dash-surface)] border border-border rounded-2xl p-6 shadow-xl space-y-6">
      <div>
        <h2 className="text-lg font-bold font-serif text-foreground flex items-center gap-2">
          <Calendar className="w-5 h-5 text-[var(--dash-brand)]" />
          <span>Time Off & Blocked Hours</span>
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Schedule vacations, personal days, or blocked time slots
        </p>
      </div>

      {/* Add Form */}
      <form onSubmit={handleAddBlockedTime} className="bg-card/60 border border-border/80 rounded-xl p-4 space-y-4">
        <p className="text-xs font-semibold text-[var(--dash-brand)] uppercase tracking-wider">
          Schedule New Time Off
        </p>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-foreground/85">Start Date & Time</Label>
            <div className="flex gap-2">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-[var(--dash-surface)] border-border text-xs text-foreground focus:border-ring"
                required
              />
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="bg-[var(--dash-surface)] border-border text-xs text-foreground w-28 font-mono focus:border-ring"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-foreground/85">End Date & Time</Label>
            <div className="flex gap-2">
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-[var(--dash-surface)] border-border text-xs text-foreground focus:border-ring"
                required
              />
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="bg-[var(--dash-surface)] border-border text-xs text-foreground w-28 font-mono focus:border-ring"
                required
              />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-foreground/85">Reason / Title</Label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Vacation, Doctor Appointment, Shop Maintenance"
            className="bg-[var(--dash-surface)] border-border text-xs text-foreground focus:border-ring"
          />
        </div>

        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            disabled={loading}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs gap-1.5"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-4 h-4" />}
            Block Time Off
          </Button>
        </div>
      </form>

      {/* Blocked Times List */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Upcoming Blocked Periods ({initialBlockedTimes.length})
        </h3>

        {initialBlockedTimes.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground bg-card/30 border border-border/50 rounded-xl">
            No blocked time off scheduled.
          </div>
        ) : (
          <div className="divide-y divide-border/60 border border-border/80 rounded-xl bg-card/40 overflow-hidden">
            {initialBlockedTimes.map((item) => {
              const start = new Date(item.startTime)
              const end = new Date(item.endTime)

              const startStr = start.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })
              const endStr = end.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })

              return (
                <div key={item.id} className="p-3.5 flex items-center justify-between gap-4 hover:bg-card/80 transition-colors">
                  <div>
                    <p className="text-xs font-bold text-foreground">{item.reason || 'Blocked Time'}</p>
                    <p className="text-[11px] font-mono text-[var(--dash-brand)]/90 mt-0.5 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      {startStr} — {endStr}
                    </p>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(item.id)}
                    disabled={deletingId === item.id}
                    className="h-8 w-8 text-muted-foreground hover:text-red-400 hover:bg-red-950/30 shrink-0"
                    title="Delete Block"
                  >
                    {deletingId === item.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

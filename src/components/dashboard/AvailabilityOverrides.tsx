'use client'

import { useState, useEffect, useCallback } from 'react'
import { CalendarPlus, Trash2, CalendarOff, Clock, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Override {
  id: string
  date: string
  isAvailable: boolean
  startTime: string | null
  endTime: string | null
  reason: string | null
}

export function AvailabilityOverrides({ barberId }: { barberId: string }) {
  const [overrides, setOverrides] = useState<Override[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Form state
  const [date, setDate] = useState('')
  const [isAvailable, setIsAvailable] = useState(true)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchOverrides = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/availability-overrides?barberId=${barberId}`)
      if (res.ok) {
        const data = await res.json()
        setOverrides(data.map((o) => ({
          id: o.id,
          date: o.date,
          isAvailable: o.isAvailable,
          startTime: o.startTime,
          endTime: o.endTime,
          reason: o.reason,
        })))
      }
    } catch (err) {
      console.error('Failed to load overrides:', err)
    } finally {
      setLoading(false)
    }
  }, [barberId])

  useEffect(() => {
    fetchOverrides()
  }, [fetchOverrides])

  const handleSave = async () => {
    if (!date) return
    setSaving(true)
    try {
      const res = await fetch(`/api/dashboard/availability-overrides?barberId=${barberId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          isAvailable,
          startTime: isAvailable ? startTime : undefined,
          endTime: isAvailable ? endTime : undefined,
          reason: reason || undefined,
        }),
      })
      if (res.ok) {
        setShowForm(false)
        setDate('')
        setReason('')
        setIsAvailable(true)
        setStartTime('09:00')
        setEndTime('17:00')
        fetchOverrides()
      }
    } catch (err) {
      console.error('Failed to save override:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this date override?')) return
    try {
      await fetch(`/api/dashboard/availability-overrides?id=${id}`, { method: 'DELETE' })
      setOverrides(prev => prev.filter(o => o.id !== id))
    } catch (err) {
      console.error('Failed to delete override:', err)
    }
  }

  // Group overrides: upcoming vs past
  const now = new Date()
  const upcoming = overrides.filter(o => new Date(o.date) >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
  const sortedUpcoming = upcoming.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <CalendarPlus className="w-4 h-4 text-amber-500" />
            Date-Specific Overrides
          </h3>
          <p className="text-xs text-zinc-500 mt-1">
            Override your recurring schedule for specific dates — time off, special hours, vacation, etc.
          </p>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          size="sm"
          className="bg-amber-500 hover:bg-amber-600 text-zinc-900 font-semibold"
        >
          {showForm ? <X className="w-4 h-4" /> : <CalendarPlus className="w-4 h-4 mr-1" />}
          {showForm ? 'Cancel' : 'Add Override'}
        </Button>
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="mb-4 bg-zinc-950 border border-zinc-800 rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-zinc-400 text-xs">Date</Label>
              <Input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="bg-zinc-800 border-zinc-700 mt-1"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div>
              <Label className="text-zinc-400 text-xs">Type</Label>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => setIsAvailable(true)}
                  className={cn(
                    'flex-1 px-3 py-2 rounded-md text-xs font-medium border transition-colors',
                    isAvailable
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                  )}
                >
                  <Clock className="w-3.5 h-3.5 inline mr-1" />
                  Custom Hours
                </button>
                <button
                  onClick={() => setIsAvailable(false)}
                  className={cn(
                    'flex-1 px-3 py-2 rounded-md text-xs font-medium border transition-colors',
                    !isAvailable
                      ? 'bg-red-500/10 text-red-400 border-red-500/30'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                  )}
                >
                  <CalendarOff className="w-3.5 h-3.5 inline mr-1" />
                  Day Off
                </button>
              </div>
            </div>
          </div>

          {isAvailable && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-zinc-400 text-xs">Start Time</Label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 mt-1"
                />
              </div>
              <div>
                <Label className="text-zinc-400 text-xs">End Time</Label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 mt-1"
                />
              </div>
            </div>
          )}

          <div>
            <Label className="text-zinc-400 text-xs">Reason (optional)</Label>
            <Input
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="bg-zinc-800 border-zinc-700 mt-1"
              placeholder="Vacation, Special opening, Personal, etc."
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              onClick={() => setShowForm(false)}
              variant="outline"
              size="sm"
              className="border-zinc-700 text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!date || saving}
              size="sm"
              className="bg-amber-500 hover:bg-amber-600 text-zinc-900 font-semibold"
            >
              {saving ? 'Saving...' : 'Save Override'}
            </Button>
          </div>
        </div>
      )}

      {/* Existing Overrides */}
      {loading ? (
        <p className="text-xs text-zinc-500 text-center py-4">Loading...</p>
      ) : sortedUpcoming.length === 0 && !showForm ? (
        <div className="text-center py-6">
          <CalendarOff className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
          <p className="text-xs text-zinc-500">No upcoming date overrides. Your recurring schedule applies.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedUpcoming.map(o => {
            const dateObj = new Date(o.date)
            const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

            return (
              <div
                key={o.id}
                className={cn(
                  'flex items-center justify-between gap-3 px-4 py-3 rounded-lg border',
                  o.isAvailable ? 'bg-zinc-950 border-zinc-800' : 'bg-red-950/20 border-red-900/30'
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                    o.isAvailable ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'
                  )}>
                    {o.isAvailable ? <Clock className="w-4 h-4" /> : <CalendarOff className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-200">{dateStr}</p>
                    <p className="text-xs text-zinc-500">
                      {o.isAvailable
                        ? `${o.startTime} – ${o.endTime}${o.reason ? ` · ${o.reason}` : ''}`
                        : `Day off${o.reason ? ` · ${o.reason}` : ''}`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(o.id)}
                  className="w-7 h-7 rounded-md bg-zinc-800 hover:bg-red-950/40 text-zinc-400 hover:text-red-400 flex items-center justify-center transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

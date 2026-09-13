'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Calendar, Clock, Scissors, User, Loader2, CheckCircle2, Sparkles } from 'lucide-react'

interface RebookDialogProps {
  customerId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface RebookSuggestion {
  barber: { id: string; name: string } | null
  service: { id: string; name: string; duration: number; price: number } | null
  suggestedDate: string | null
  lastVisit: string | null
  averageIntervalDays: number | null
  availableSlots: { time: string; available: boolean }[]
  preferences: { key: string; label: string; value: string }[] | null
}

export function RebookDialog({ customerId, open, onOpenChange }: RebookDialogProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [suggestion, setSuggestion] = useState<RebookSuggestion | null>(null)
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    setSuccess(false)
    setSelectedTime(null)

    fetch(`/api/dashboard/customers/${customerId}/rebook`)
      .then(res => res.json())
      .then(data => {
        setSuggestion(data)
        if (data.suggestedDate) {
          setSelectedDate(data.suggestedDate)
        }
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to load rebooking suggestion')
        setLoading(false)
      })
  }, [customerId, open])

  const handleRebook = async () => {
    if (!selectedTime) {
      setError('Please select a time slot')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`/api/dashboard/customers/${customerId}/rebook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barberId: suggestion?.barber?.id,
          serviceId: suggestion?.service?.id,
          date: selectedDate,
          time: selectedTime,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to rebook')
        setSubmitting(false)
        return
      }

      setSuccess(true)
      setSubmitting(false)

      // Refresh the page after 2 seconds
      setTimeout(() => {
        onOpenChange(false)
        router.refresh()
      }, 2000)
    } catch (err) {
      setError('Failed to rebook. Please try again.')
      setSubmitting(false)
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A'
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 max-w-md">
        {(suggestion?.preferences?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-amber-400" /> Saved preferences — for your reference only
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestion.preferences.map((p) => (
                <span key={p.key} className="text-[11px] text-zinc-300 bg-zinc-950/60 border border-zinc-800 rounded-full px-2.5 py-1">
                  <span className="text-zinc-500">{p.label}:</span> {p.value}
                </span>
              ))}
            </div>
          </div>
        )}

        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-400 font-serif">
            <Sparkles className="w-5 h-5" />
            Rebook Customer
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Smart rebooking based on customer history
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
            <span className="ml-2 text-sm text-zinc-400">Loading rebooking suggestion...</span>
          </div>
        ) : success ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-3" />
            <p className="text-lg font-semibold text-zinc-100">Appointment Booked!</p>
            <p className="text-sm text-zinc-400 mt-1">Customer has been rebooked successfully.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Preselected details */}
            <div className="space-y-3 bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <User className="w-4 h-4 text-amber-500 shrink-0" />
                <div className="flex-1">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Barber</p>
                  <p className="text-sm font-medium text-zinc-200">{suggestion?.barber?.name || 'N/A'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Scissors className="w-4 h-4 text-amber-500 shrink-0" />
                <div className="flex-1">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Service</p>
                  <p className="text-sm font-medium text-zinc-200">{suggestion?.service?.name || 'N/A'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-amber-500 shrink-0" />
                <div className="flex-1">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Suggested Date</p>
                  <p className="text-sm font-medium text-zinc-200">{formatDate(selectedDate)}</p>
                </div>
              </div>
              {suggestion?.averageIntervalDays && (
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500">Typical Interval</p>
                    <p className="text-sm font-medium text-zinc-200">Every {suggestion.averageIntervalDays} days</p>
                  </div>
                </div>
              )}
            </div>

            {/* Available time slots */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                Available Times
              </p>
              {suggestion?.availableSlots && suggestion.availableSlots.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                  {suggestion.availableSlots.map((slot, i) => (
                    <button
                      key={i}
                      disabled={!slot.available}
                      onClick={() => setSelectedTime(slot.time)}
                      className={`text-xs py-2 px-3 rounded-lg border font-medium transition-colors ${
                        selectedTime === slot.time
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                          : slot.available
                          ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-700'
                          : 'bg-zinc-900/40 border-zinc-900 text-zinc-600 cursor-not-allowed'
                      }`}
                    >
                      {slot.time}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-zinc-500 bg-zinc-900/40 border border-zinc-800/60 rounded-lg p-4 text-center">
                  No available slots on this date. Try a different date.
                </div>
              )}
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg p-3">
                {error}
              </p>
            )}
          </div>
        )}

        {!loading && !success && (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRebook}
              disabled={!selectedTime || submitting}
              className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Booking...
                </>
              ) : (
                'Rebook Now'
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

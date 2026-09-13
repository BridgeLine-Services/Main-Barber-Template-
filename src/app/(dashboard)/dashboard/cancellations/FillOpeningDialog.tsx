'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Clock, Scissors, User, BellRing, CheckCircle2, XCircle, Users } from 'lucide-react'

interface Candidate {
  entryId: string
  name: string
  phone: string
  email: string
  preferredDate: string
  preferredTimeRange: string | null
  createdAt: string
  matchReasons: string[]
}

interface OpeningInfo {
  appointmentId: string
  serviceName: string
  barberName: string
  startTimeLabel: string
  endTimeLabel: string
}

interface FillOpeningDialogProps {
  opening: OpeningInfo
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FillOpeningDialog({ opening, open, onOpenChange }: FillOpeningDialogProps) {
  const [loading, setLoading] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [holdMinutes, setHoldMinutes] = useState<number | null>(null)
  const [notifyingId, setNotifyingId] = useState<string | null>(null)
  const [notified, setNotified] = useState<{ name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notAvailable, setNotAvailable] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotAvailable(false)
    try {
      const res = await fetch(`/api/dashboard/cancellation-fill/${opening.appointmentId}`)
      if (res.status === 404) {
        setNotAvailable(true)
        setCandidates([])
        setLoading(false)
        return
      }
      if (!res.ok) throw new Error()
      const data = await res.json()
      setCandidates(data.candidates || [])
      setHoldMinutes(data.holdMinutes || null)
    } catch {
      setError('Failed to load waitlist candidates')
    }
    setLoading(false)
  }, [opening.appointmentId])

  useEffect(() => {
    if (open) {
      setNotified(null)
      load()
    }
  }, [open, load])

  const handleNotify = async (candidate: Candidate) => {
    setNotifyingId(candidate.entryId)
    setError(null)
    try {
      const res = await fetch(`/api/dashboard/cancellation-fill/${opening.appointmentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: candidate.entryId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setNotified({ name: candidate.name })
        setCandidates(prev => prev.filter(c => c.entryId !== candidate.entryId))
      } else if (res.status === 409) {
        setError(data.error || 'This opening is no longer available')
        if ((data.error || '').includes('no longer available')) setNotAvailable(true)
        await load()
      } else {
        setError(data.error || 'Failed to notify candidate')
      }
    } catch {
      setError('Failed to notify candidate. Please try again.')
    }
    setNotifyingId(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 border border-zinc-800 text-zinc-100 max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-400 font-serif">
            <BellRing className="w-5 h-5" />
            <span>Appointment Opened</span>
          </DialogTitle>
          <DialogDescription className="text-zinc-400 text-xs">
            Offer this released slot to a waitlist customer. They receive a claim link held for {holdMinutes ?? 15} minutes — the slot is re-checked when they book.
          </DialogDescription>
        </DialogHeader>

        {/* Opening card */}
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2.5 text-sm">
            <Scissors className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-zinc-400 text-xs w-16">Service</span>
            <span className="text-zinc-100 font-medium">{opening.serviceName}</span>
          </div>
          <div className="flex items-center gap-2.5 text-sm">
            <User className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-zinc-400 text-xs w-16">Barber</span>
            <span className="text-zinc-100 font-medium">{opening.barberName}</span>
          </div>
          <div className="flex items-center gap-2.5 text-sm">
            <Clock className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-zinc-400 text-xs w-16">Time</span>
            <span className="text-zinc-100 font-medium">{opening.startTimeLabel} – {opening.endTimeLabel}</span>
          </div>
        </div>

        {/* Result states */}
        {notified && (
          <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3.5 text-sm text-emerald-300">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>{notified.name}</strong> has been notified with a claim link. The entry is held until they book or the offer expires.
            </span>
          </div>
        )}

        {notAvailable && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 p-3.5 text-sm text-red-300">
            <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>This opening is no longer available — the slot has been booked or is in the past.</span>
          </div>
        )}

        {error && !notAvailable && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        {/* Candidates */}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Finding eligible waitlist customers…
          </div>
        ) : !notAvailable && (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 uppercase tracking-wide">
              <Users className="w-3.5 h-3.5" />
              Eligible waitlist candidates
              <span className="text-zinc-600 normal-case font-normal">({candidates.length})</span>
            </div>
            {candidates.length === 0 ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center text-sm text-zinc-500">
                No eligible waitlist entries for this service and barber. You can still book the slot manually from the Calendar.
              </div>
            ) : (
              candidates.map((c, i) => (
                <div key={c.entryId} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-zinc-600">#{i + 1}</span>
                        <span className="text-sm font-medium text-zinc-100 truncate">{c.name}</span>
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">{c.phone}</div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {c.matchReasons.map(reason => (
                          <span key={reason} className="text-[10px] text-zinc-400 bg-zinc-800/70 border border-zinc-700/60 rounded-full px-2 py-0.5">
                            {reason}
                          </span>
                        ))}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleNotify(c)}
                      disabled={notifyingId !== null}
                      className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold shrink-0 h-8"
                    >
                      {notifyingId === c.entryId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Notify'}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

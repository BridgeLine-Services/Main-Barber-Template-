'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2, UserX, XCircle, History, CalendarPlus, ChevronDown,
  RefreshCw, Clock, Scissors, StickyNote, User, Loader2, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatRelativeWhen, availableActions } from '@/lib/barber-mode'
import { Button } from '@/components/ui/button'

// ─── Types (serialized shapes from the server page) ────────────────────────

interface CustomerLite {
  id: string
  firstName: string
  lastName: string
  phone: string
  notes?: string | null
  preferences?: unknown
}

interface ServiceLite {
  id: string
  name: string
  duration: number
  price: number
}

export interface AppointmentCardData {
  id: string
  confirmationNumber: string
  status: string
  startTime: string
  endTime: string
  timeLabel: string
  endLabel: string
  customer: CustomerLite
  service: ServiceLite
  customerNotes?: string | null
}

export interface BarberModeClientProps {
  timezone: string
  todayLabel: string
  counts: { total: number; upcoming: number; completed: number }
  current: AppointmentCardData | null
  next: AppointmentCardData | null
  upcoming: AppointmentCardData[]
  completed: AppointmentCardData[]
  cancelled: AppointmentCardData[]
  noShows: AppointmentCardData[]
  all: AppointmentCardData[]
}

// ─── Status chip (semantic tokens only) ────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  CONFIRMED: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  COMPLETED: 'text-muted-foreground bg-secondary border-border',
  CANCELLED: 'text-destructive bg-destructive/10 border-destructive/20',
  NO_SHOW: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  RESCHEDULED: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
}
const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending', CONFIRMED: 'Confirmed', COMPLETED: 'Completed',
  CANCELLED: 'Cancelled', NO_SHOW: 'No-show', RESCHEDULED: 'Rescheduled',
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={cn('inline-block rounded border px-2 py-0.5 text-xs font-medium',
      STATUS_STYLES[status] || 'text-muted-foreground bg-secondary border-border')}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

// ─── Quick actions (existing PATCH route enforces RBAC + transitions) ──────

function useAppointmentAction() {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const act = useCallback(async (
    appointment: AppointmentCardData,
    status: 'COMPLETED' | 'NO_SHOW' | 'CANCELLED',
    reason?: string
  ) => {
    if (busyId) return
    setBusyId(appointment.id)
    setError(null)
    try {
      const res = await fetch(`/api/dashboard/appointments/${appointment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...(reason ? { [status === 'NO_SHOW' ? 'noShowReason' : 'cancellationReason']: reason } : {}) }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Update failed')
      } else {
        router.refresh()
      }
    } catch {
      setError('Update failed — check your connection')
    } finally {
      setBusyId(null)
    }
  }, [busyId, router])

  return { act, busyId, error }
}

// ─── Customer history (barber-scoped API) ──────────────────────────────────

interface HistoryData {
  customer: CustomerLite
  appointments: Array<{
    id: string
    confirmationNumber: string
    status: string
    dateLabel: string
    timeLabel: string
    service: ServiceLite | null
    customerNotes?: string | null
  }>
  summary: { visits: number; lastVisit: string | null }
  rebooking: { dueDate: string | null; dueSoon: boolean; recommendedIntervalDays: number | null }
}

function HistoryPanel({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const [data, setData] = useState<HistoryData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/dashboard/barber-mode/history?customerId=${customerId}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load history')))
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [customerId])

  if (error) return <p className="px-3 py-3 text-sm text-destructive">{error}</p>
  if (!data) return <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading history…</p>

  const prefs = data.customer.preferences
  const prefEntries = prefs && typeof prefs === 'object' && !Array.isArray(prefs)
    ? Object.entries(prefs as Record<string, unknown>).filter(([, v]) => v != null && v !== '')
    : []

  return (
    <div className="space-y-3 border-t border-border bg-background/60 px-3 py-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <span className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground">
          {data.summary.visits} visit{data.summary.visits === 1 ? '' : 's'} with you
        </span>
        {data.summary.lastVisit && (
          <span className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground">
            Last visit {data.summary.lastVisit}
          </span>
        )}
        {data.rebooking.dueDate && (
          <span className={cn('rounded-md px-2 py-1 text-xs',
            data.rebooking.dueSoon ? 'bg-primary/10 text-primary' : 'bg-secondary text-secondary-foreground')}>
            {data.rebooking.dueSoon ? 'Due for next visit' : 'Next visit around'} {data.rebooking.dueDate}
          </span>
        )}
      </div>

      {(data.customer.notes || prefEntries.length > 0) && (
        <div className="rounded-lg border border-border bg-card/60 p-3 space-y-2">
          {data.customer.notes && (
            <p className="flex items-start gap-2 text-foreground/80">
              <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              {data.customer.notes}
            </p>
          )}
          {prefEntries.map(([k, v]) => (
            <p key={k} className="text-foreground/80">
              <span className="capitalize text-muted-foreground">{String(k).replace(/([A-Z])/g, ' $1')}:</span>{' '}
              {String(v)}
            </p>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">With you</p>
        {data.appointments.length === 0 && (
          <p className="text-muted-foreground">No history with you yet.</p>
        )}
        {data.appointments.map(a => (
          <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground/90">{a.service?.name || 'Service'}</p>
              <p className="text-xs text-muted-foreground">{a.dateLabel} · {a.timeLabel}</p>
            </div>
            <StatusChip status={a.status} />
          </div>
        ))}
      </div>

      <button onClick={onClose} className="w-full pt-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
        Close history
      </button>
    </div>
  )
}

// ─── Rebook dialog (existing rebooking infrastructure) ─────────────────────

function RebookDialog({
  customer, onClose, onBooked,
}: {
  customer: CustomerLite
  onClose: () => void
  onBooked: () => void
}) {
  const [data, setData] = useState<{
    service: ServiceLite | null
    suggestedDate: string | null
    availableSlots: { time: string; available: boolean }[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    // barberId override is set by the caller context (own chair) via the
    // session barber — the API derives the barber from the query param.
    fetch(`/api/dashboard/customers/${customer.id}/rebook`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.error) { setError(d.error); setLoading(false); return }
        setData({
          service: d.service,
          suggestedDate: d.suggestedDate,
          availableSlots: d.availableSlots || [],
        })
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setError('Could not load rebooking options'); setLoading(false) } })
    return () => { cancelled = true }
  }, [customer.id])

  const submit = async () => {
    if (!selectedTime || !data?.suggestedDate) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/dashboard/customers/${customer.id}/rebook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: data.suggestedDate,
          time: selectedTime,
          // Keep the suggestion's barber/service unless the history view
          // provided overrides — the POST validates through the engine.
        }),
      })
      const d = await res.json()
      if (!res.ok) setError(d.error || 'Booking failed')
      else { onBooked(); onClose(); router.refresh() }
    } catch {
      setError('Booking failed — check your connection')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Book next appointment for ${customer.firstName} ${customer.lastName}`}>
      <div className="w-full max-w-md rounded-t-xl border border-border bg-card p-4 text-card-foreground shadow-xl sm:rounded-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold tracking-tight">Book next for {customer.firstName}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        {loading && <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Finding their usual…</p>}
        {error && !loading && <p className="py-2 text-sm text-destructive">{error}</p>}

        {!loading && data && (
          <div className="space-y-3">
            {data.service ? (
              <div className="rounded-lg border border-border bg-background/60 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Their usual</p>
                <p className="font-medium">{data.service.name}</p>
                <p className="text-xs text-muted-foreground">{data.service.duration} min · ${data.service.price.toFixed(0)}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No past services to suggest — book them from the calendar instead.</p>
            )}

            {data.availableSlots.length > 0 && (
              <>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Available times</p>
                <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto">
                  {data.availableSlots.filter(s => s.available).map(s => (
                    <button
                      key={s.time}
                      onClick={() => setSelectedTime(s.time)}
                      className={cn(
                        'min-h-11 rounded-lg border px-2 py-2 text-sm font-medium transition-colors',
                        selectedTime === s.time
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-foreground hover:border-primary/50'
                      )}
                    >
                      {s.time}
                    </button>
                  ))}
                </div>
                <Button onClick={submit} disabled={!selectedTime || submitting} className="h-12 w-full text-base">
                  {submitting ? 'Booking…' : selectedTime ? `Book ${selectedTime}` : 'Pick a time'}
                </Button>
              </>
            )}
            {data.service && data.availableSlots.length === 0 && (
              <p className="text-sm text-muted-foreground">No open slots for the suggested date — try the calendar instead.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Appointment card ──────────────────────────────────────────────────────

function AppointmentCard({
  appt, variant, now,
}: {
  appt: AppointmentCardData
  variant: 'current' | 'next' | 'row'
  now: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showRebook, setShowRebook] = useState(false)
  const { act, busyId, error } = useAppointmentAction()
  const actions = availableActions({ status: appt.status })
  const busy = busyId === appt.id

  const isCurrent = variant === 'current'
  const isNext = variant === 'next'

  return (
    <div className={cn(
      'rounded-xl border bg-card text-card-foreground shadow-sm',
      isCurrent && 'border-primary/40 ring-1 ring-primary/20',
      isNext && 'border-border',
      !isCurrent && !isNext && 'border-border/70',
    )}>
      <button
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <div className={cn('flex w-14 shrink-0 flex-col items-center justify-center rounded-lg',
          isCurrent ? 'bg-primary/10 text-primary' : 'bg-secondary text-secondary-foreground')}>
          <span className="text-sm font-bold leading-tight">{appt.timeLabel}</span>
          {appt.service && <span className="text-[10px] opacity-70">{appt.service.duration}m</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-foreground">{appt.customer.firstName} {appt.customer.lastName}</p>
            <StatusChip status={appt.status} />
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Scissors className="h-3.5 w-3.5" /> {appt.service?.name}
          </p>
          {isCurrent && (
            <p className="mt-1 text-xs font-medium text-primary">
              Now · ends {appt.endLabel}
            </p>
          )}
          {isNext && (
            <p className="mt-1 text-xs text-muted-foreground">
              {formatRelativeWhen(appt.startTime, now)} · ends {appt.endLabel}
            </p>
          )}
        </div>
        <ChevronDown className={cn('h-5 w-5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <p className="flex items-center gap-2 text-muted-foreground">
              <User className="h-4 w-4" /> {appt.customer.phone}
            </p>
            <p className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" /> {appt.timeLabel}–{appt.endLabel}
            </p>
          </div>
          {appt.customerNotes && (
            <p className="flex items-start gap-2 rounded-lg border border-border bg-background/60 p-3 text-sm text-foreground/80">
              <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              {appt.customerNotes}
            </p>
          )}

          {actions.complete && (
            <div className="grid grid-cols-3 gap-2">
              <Button
                onClick={() => act(appt, 'COMPLETED')}
                disabled={busy}
                className="h-11 border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                <span className="text-xs font-semibold">Done</span>
              </Button>
              <Button
                onClick={() => { if (confirm('Mark as no-show?')) act(appt, 'NO_SHOW') }}
                disabled={busy}
                className="h-11 border border-orange-500/30 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20"
              >
                <UserX className="h-4 w-4" />
                <span className="text-xs font-semibold">No-show</span>
              </Button>
              <Button
                onClick={() => { if (confirm('Cancel this appointment?')) act(appt, 'CANCELLED') }}
                disabled={busy}
                className="h-11 border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20"
              >
                <XCircle className="h-4 w-4" />
                <span className="text-xs font-semibold">Cancel</span>
              </Button>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setShowHistory(h => !h)} className="h-10">
              <History className="h-4 w-4" />
              <span className="text-xs">History</span>
            </Button>
            {(appt.status === 'COMPLETED' || appt.status === 'CONFIRMED' || appt.status === 'PENDING') && (
              <Button variant="outline" onClick={() => setShowRebook(true)} className="h-10">
                <CalendarPlus className="h-4 w-4" />
                <span className="text-xs">Book next</span>
              </Button>
            )}
          </div>

          {showHistory && <HistoryPanel customerId={appt.customer.id} onClose={() => setShowHistory(false)} />}
        </div>
      )}

      {showRebook && (
        <RebookDialog
          customer={appt.customer}
          onClose={() => setShowRebook(false)}
          onBooked={() => {}}
        />
      )}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────

export function BarberModeClient(props: BarberModeClientProps) {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const nowRef = useRef(new Date().toISOString())
  const [, forceTick] = useState(0)

  // Auto-refresh the day every 60s (server re-derives current/next).
  useEffect(() => {
    const id = setInterval(() => {
      setRefreshing(true)
      router.refresh()
      setTimeout(() => setRefreshing(false), 800)
    }, 60_000)
    return () => clearInterval(id)
  }, [router])

  // Keep the relative labels fresh without a server round-trip.
  useEffect(() => {
    const id = setInterval(() => { nowRef.current = new Date().toISOString(); forceTick(t => t + 1) }, 30_000)
    return () => clearInterval(id)
  }, [])

  const { current, next, upcoming, completed, cancelled, noShows, all, counts, todayLabel } = props

  return (
    <div className="mx-auto max-w-xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-semibold tracking-tight text-foreground">Your chair</h1>
          <p className="text-sm text-muted-foreground">{todayLabel} · {counts.total} appointment{counts.total === 1 ? '' : 's'}</p>
        </div>
        <button
          onClick={() => { setRefreshing(true); router.refresh(); setTimeout(() => setRefreshing(false), 800) }}
          aria-label="Refresh"
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
        >
          <RefreshCw className={cn('h-5 w-5', refreshing && 'animate-spin')} />
        </button>
      </div>

      {/* Now */}
      {current ? (
        <section aria-label="Current appointment">
          <AppointmentCard appt={current} variant="current" now={nowRef.current} />
        </section>
      ) : next ? (
        <section aria-label="Next appointment">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next up</p>
          <AppointmentCard appt={next} variant="next" now={nowRef.current} />
        </section>
      ) : (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Nothing on the books for the rest of today.
        </div>
      )}

      {/* Remaining today */}
      {upcoming.length > 0 && (
        <section aria-label="Remaining appointments today" className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Later today ({upcoming.length})
          </p>
          {upcoming.map(a => <AppointmentCard key={a.id} appt={a} variant="row" now={nowRef.current} />)}
        </section>
      )}

      {/* Full day schedule */}
      <section aria-label="Today's schedule" className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today&apos;s schedule</p>
        {all.length === 0 && (
          <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No appointments today.
          </p>
        )}
        {all.map(a => (
          <div key={`row-${a.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="w-14 shrink-0 text-sm font-semibold text-foreground">{a.timeLabel}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground/90">{a.customer.firstName} {a.customer.lastName}</p>
                <p className="truncate text-xs text-muted-foreground">{a.service?.name}</p>
              </div>
            </div>
            <StatusChip status={a.status} />
          </div>
        ))}
      </section>

      {(cancelled.length > 0 || noShows.length > 0) && (
        <p className="pb-2 text-center text-xs text-muted-foreground">
          {cancelled.length} cancelled · {noShows.length} no-show{noShows.length === 1 ? '' : 's'} today — shown in the schedule above.
        </p>
      )}
    </div>
  )
}

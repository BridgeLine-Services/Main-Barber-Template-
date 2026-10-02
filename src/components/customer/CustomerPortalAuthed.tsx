'use client'

// ============================================================================
// AUTHENTICATED CUSTOMER PORTAL — the session-based CUSTOMER experience.
//
// All data comes from /api/portal/* which resolve the customer from the
// authenticated session server-side (never from client-supplied ids).
// The legacy verification-token flow (CustomerPortal) remains available
// for guests who booked without an account.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { Loader2, CalendarClock, History, LogOut } from 'lucide-react'
import RescheduleFlow from '@/components/customer/RescheduleFlow'

interface PortalAppointment {
  id: string
  confirmationNumber: string
  status: string
  startTime: string
  endTime: string
  barber: { id: string; name: string } | null
  service: { id: string; name: string; duration: number; price: number | null } | null
}

interface Me {
  user: { name?: string | null; email?: string | null }
  customer: { firstName: string; lastName: string; email: string; phone: string } | null
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-primary/15 text-primary',
  CONFIRMED: 'bg-emerald-600/15 text-emerald-600 dark:text-emerald-400',
  RESCHEDULED: 'bg-sky-600/15 text-sky-600 dark:text-sky-400',
  CANCELLED: 'bg-destructive/15 text-destructive',
  COMPLETED: 'bg-muted text-muted-foreground',
  NO_SHOW: 'bg-destructive/15 text-destructive',
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export function CustomerPortalAuthed({ businessName }: { businessName: string }) {
  const [me, setMe] = useState<Me | null>(null)
  const [upcoming, setUpcoming] = useState<PortalAppointment[]>([])
  const [history, setHistory] = useState<PortalAppointment[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [meRes, apptRes] = await Promise.all([
        fetch('/api/portal/me'),
        fetch('/api/portal/appointments'),
      ])
      if (meRes.ok) setMe(await meRes.json())
      if (apptRes.ok) {
        const data = await apptRes.json()
        setUpcoming(data.upcoming || [])
        setHistory(data.history || [])
      }
    } catch {
      setError('Could not load your portal. Please refresh the page.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const cancelAppointment = async (id: string) => {
    if (!confirm('Cancel this appointment?')) return
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/portal/appointments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Could not cancel the appointment.')
      } else {
        await load()
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  const rescheduleAppointment = useCallback(async (id: string, startTime: string) => {
    const res = await fetch(`/api/portal/appointments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reschedule', startTime }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.error || 'Unable to reschedule.')
    return { startTime: data.startTime }
  }, [])

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
  }

  const displayName = me?.customer ? `${me.customer.firstName} ${me.customer.lastName}` : (me?.user?.name || 'Welcome')

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 lg:py-16 space-y-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow-accent mb-3">Your Account</p>
          <h1 className="display-heading text-display-2 text-foreground">Your Account</h1>
          <p className="text-sm text-muted-foreground">
            {displayName}{me?.user?.email ? ` · ${me.user.email}` : ''} · {businessName}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/book" className="inline-flex rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90">
            Book Appointment
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted"
          >
            <LogOut className="h-4 w-4" /> Sign Out
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-500">{error}</div>
      )}

      {!me?.customer && (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <h2 className="mb-2 text-xl font-bold text-foreground">Welcome!</h2>
          <p className="text-sm text-muted-foreground">
            You don&apos;t have any visits recorded with this shop yet. Book your first appointment and
            it will appear here automatically.
          </p>
        </div>
      )}

      {/* Upcoming */}
      <section>
        <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-foreground">
          <CalendarClock className="h-5 w-5 text-primary" /> Upcoming Appointments
        </h2>
        {upcoming.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
            No upcoming appointments. <Link href="/book" className="font-medium text-primary underline-offset-2 hover:underline">Book one now</Link>.
          </div>
        ) : (
          <div className="space-y-3">
            {upcoming.map(a => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-foreground">{a.service?.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[a.status] || 'bg-muted text-muted-foreground'}`}>{a.status}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{fmtDate(a.startTime)} · with {a.barber?.name || 'any barber'}</p>
                  <p className="text-xs text-muted-foreground">Confirmation {a.confirmationNumber}</p>
                </div>
                <div className="flex w-full flex-wrap items-center justify-end gap-2">
                  {a.barber && a.service && (
                    <RescheduleFlow
                      serviceId={a.service.id}
                      barberId={a.barber.id}
                      currentStartTime={a.startTime}
                      submit={(startTime) => rescheduleAppointment(a.id, startTime)}
                      onRescheduled={load}
                    />
                  )}
                  <button
                    onClick={() => cancelAppointment(a.id)}
                    disabled={busyId === a.id}
                    className="rounded-lg border border-red-500/30 px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {busyId === a.id ? 'Cancelling…' : 'Cancel'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* History */}
      <section>
        <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-foreground">
          <History className="h-5 w-5 text-primary" /> Appointment History
        </h2>
        {history.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">No past appointments yet.</div>
        ) : (
          <div className="space-y-2">
            {history.map(a => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                <div>
                  <p className="font-medium text-foreground">{a.service?.name}</p>
                  <p className="text-sm text-muted-foreground">{fmtDate(a.startTime)} · {a.barber?.name || 'any barber'}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[a.status] || 'bg-muted text-muted-foreground'}`}>{a.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

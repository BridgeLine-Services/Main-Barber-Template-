'use client'

import { useState } from 'react'
import { Search, Calendar, Clock, Scissors, User, Phone, Mail, CheckCircle, XCircle, Gift, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  CONFIRMED: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  COMPLETED: 'text-foreground/70 bg-zinc-700/40 border-zinc-600',
  CANCELLED: 'text-red-400 bg-red-500/10 border-red-500/20',
  NO_SHOW: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  RESCHEDULED: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-Show',
  RESCHEDULED: 'Rescheduled',
}

interface PortalAppointment {
  confirmationNumber: string
  customerAccessToken: string
  status: string
  startTime: string
  endTime: string
  barber: { name: string } | null
  service: { name: string; price: number; duration: number } | null
}

interface PortalData {
  customer: {
    firstName: string
    lastName: string
    email: string
    phone: string
    smsConsent: boolean
  }
  upcoming: PortalAppointment[]
  past: PortalAppointment[]
  loyalty: { programName: string; type: string; visits: number } | null
}

export function CustomerPortal({ businessId, businessName }: { businessId: string; businessName: string }) {
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PortalData | null>(null)
  const [code, setCode] = useState('')
  const [codeRequested, setCodeRequested] = useState(false)

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setData(null)

    try {
      const res = await fetch('/api/public/portal/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email || undefined, phone: phone || undefined, businessId }) })
      if (!res.ok) setError('Please try again.')
      else setCodeRequested(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await fetch('/api/public/portal/logout', { method: 'POST' })
    setData(null)
    setCodeRequested(false)
    setCode('')
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/public/portal/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email || undefined, phone: phone || undefined, code }) })
      if (!res.ok) { const result = await res.json(); setError(result.error || 'The verification code is invalid or expired.') }
      else {
        const lookup = await fetch('/api/public/portal/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, phone, businessId }) })
        const result = await lookup.json()
        if (lookup.ok) setData(result); else setError('Your session expired. Please request a new code.')
      }
    } catch { setError('Please try again.') } finally { setLoading(false) }
  }

  // ── Lookup Form ─────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/30 text-accent flex items-center justify-center mx-auto mb-4">
            <Calendar className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-foreground font-serif">My Appointments</h1>
          <p className="text-sm text-muted-foreground mt-1">Look up your appointments and loyalty status at {businessName}</p>
        </div>

        <form onSubmit={codeRequested ? handleVerify : handleLookup} className="space-y-4 bg-card/40 border border-border rounded-xl p-6">
          {codeRequested ? (
            <div>
              <p className="mb-3 text-sm text-muted-foreground">Check your email or phone for your verification code.</p>
              <label className="block text-sm text-muted-foreground mb-1.5">Verification code</label>
              <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-foreground/80 text-sm focus:outline-none focus:border-accent/50" />
            </div>
          ) : <><div>
            <label className="block text-sm text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" /> Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-foreground/80 text-sm focus:outline-none focus:border-accent/50"
            />
          </div>
          <div className="text-center text-xs text-muted-foreground/70">— or —</div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" /> Phone
            </label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="(555) 555-0100"
              className="w-full px-3 py-2.5 rounded-lg bg-background border border-border text-foreground/80 text-sm focus:outline-none focus:border-accent/50"
            />
          </div></>}

          {error && (
            <p className="text-sm text-red-400 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || (!email && !phone)}
            className="w-full px-4 py-2.5 rounded-lg bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            <Search className="w-4 h-4" />
            {loading ? 'Please wait...' : codeRequested ? 'Verify Code' : 'Send Verification Code'}
          </button>
        </form>
      </div>
    )
  }

  // ── Results Dashboard ─────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <button onClick={handleLogout} className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-accent transition-colors"><ArrowLeft className="w-4 h-4" /> New Lookup</button>
        <button onClick={handleLogout} className="text-xs text-muted-foreground hover:text-red-400">Log out</button>
      </div>

      {/* Customer Header */}
      <div className="bg-card/40 border border-border rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center text-accent font-bold text-lg">
            {data.customer.firstName[0]}{data.customer.lastName[0]}
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">{data.customer.firstName} {data.customer.lastName}</h1>
            <p className="text-xs text-muted-foreground">{data.customer.email} · {data.customer.phone}</p>
          </div>
        </div>

        {/* Loyalty */}
        {data.loyalty && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-accent/5 border border-accent/15">
            <Gift className="w-5 h-5 text-accent" />
            <div>
              <p className="text-sm font-medium text-accent">{data.loyalty.programName}</p>
              <p className="text-xs text-muted-foreground">{data.loyalty.visits} visits completed</p>
            </div>
          </div>
        )}
      </div>

      {/* Upcoming Appointments */}
      <div>
        <h2 className="text-sm font-semibold text-foreground/70 mb-3 uppercase tracking-wide flex items-center gap-2">
          <Calendar className="w-4 h-4 text-accent" /> Upcoming ({data.upcoming.length})
        </h2>
        {data.upcoming.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4 text-center bg-card/30 border border-border/50 rounded-lg">
            No upcoming appointments. <a href="/book" className="text-accent hover:underline">Book one →</a>
          </p>
        ) : (
          <div className="space-y-3">
            {data.upcoming.map(a => <AppointmentCard key={a.confirmationNumber} appt={a} />)}
          </div>
        )}
      </div>

      {/* Past Appointments */}
      <div>
        <h2 className="text-sm font-semibold text-foreground/70 mb-3 uppercase tracking-wide flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" /> History ({data.past.length})
        </h2>
        {data.past.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4 text-center bg-card/30 border border-border/50 rounded-lg">
            No past appointments yet.
          </p>
        ) : (
          <div className="space-y-3">
            {data.past.slice(0, 20).map(a => <AppointmentCard key={a.confirmationNumber} appt={a} />)}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Appointment Card ───────────────────────────────────────────────────────

function AppointmentCard({ appt }: { appt: PortalAppointment }) {
  const date = new Date(appt.startTime)
  const canCancel = appt.status === 'PENDING' || appt.status === 'CONFIRMED'

  return (
    <div className="bg-card/40 border border-border rounded-xl p-4 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
          <Scissors className="w-5 h-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground/80 truncate">{appt.service?.name || 'Service'}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at{' '}
            {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className={cn('inline-block px-2 py-0.5 rounded text-xs font-medium border', STATUS_COLORS[appt.status])}>
              {STATUS_LABELS[appt.status] || appt.status}
            </span>
            {appt.barber && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <User className="w-3 h-3" /> {appt.barber.name}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {appt.service && <span className="text-sm font-semibold text-accent">${appt.service.price.toFixed(0)}</span>}
        {canCancel && (
          <a
            href={`/appointment/${appt.confirmationNumber}?token=${appt.customerAccessToken}`}
            className="text-xs text-red-400 hover:text-red-300 hover:underline"
          >
            Cancel
          </a>
        )}
      </div>
    </div>
  )
}

'use client'

import { CalendarCheck, CalendarX, CheckCircle2, Clock, DollarSign, UserX, Users, Armchair, ChevronRight, AlertTriangle } from 'lucide-react'
import type { DailyOperationsSnapshot } from '@/lib/daily-operations'

interface Props {
  snapshot: DailyOperationsSnapshot | null
  dbAvailable: boolean
  timezone: string
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtMoney(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function SummaryTile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number | string; accent: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={accent}>{icon}</span>
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold font-mono text-zinc-100">{value}</p>
    </div>
  )
}

export function DailyOperationsClient({ snapshot, dbAvailable, timezone }: Props) {
  if (!dbAvailable) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 font-serif">Daily Operations</h1>
          <p className="text-sm text-zinc-400 mt-1">Today at a glance</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-10 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500/60 mx-auto mb-3" />
          <p className="text-zinc-300 font-medium">Database not available</p>
          <p className="text-sm text-zinc-500 mt-1">The operations dashboard will appear here once the database is connected.</p>
        </div>
      </div>
    )
  }

  if (!snapshot) return null

  const workingBarbers = snapshot.barbers.filter((b) => b.isWorkingToday)
  const totalOpenSlots = snapshot.barbers.reduce((acc, b) => acc + b.openRanges.length, 0)

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 font-serif">Daily Operations</h1>
          <p className="text-sm text-zinc-400 mt-1">
            {new Date(`${snapshot.dateStr}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · {snapshot.timezone}
          </p>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryTile icon={<CalendarCheck className="w-4 h-4" />} label="Appointments Today" value={snapshot.totals.appointmentsToday} accent="text-amber-400" />
        <SummaryTile icon={<Clock className="w-4 h-4" />} label="Upcoming" value={snapshot.totals.upcoming} accent="text-blue-400" />
        <SummaryTile icon={<CheckCircle2 className="w-4 h-4" />} label="Completed" value={snapshot.totals.completed} accent="text-emerald-400" />
        <SummaryTile icon={<CalendarX className="w-4 h-4" />} label="Cancelled" value={snapshot.totals.cancelled} accent="text-red-400" />
        <SummaryTile icon={<UserX className="w-4 h-4" />} label="No-Shows" value={snapshot.totals.noShows} accent="text-orange-400" />
        <SummaryTile icon={<Users className="w-4 h-4" />} label="Active Barbers" value={snapshot.totals.activeBarbers} accent="text-purple-400" />
      </div>

      {/* Scheduled service value */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
          <DollarSign className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-zinc-500 font-medium">Scheduled Service Value Today</p>
          <p className="text-2xl font-bold font-mono text-emerald-400">{fmtMoney(snapshot.scheduledServiceValue)}</p>
          <p className="text-[11px] text-zinc-600 mt-0.5">
            Estimated from booked services — this is not collected revenue.
          </p>
        </div>
      </div>

      {/* Open time today */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide flex items-center gap-2">
            <Armchair className="w-4 h-4 text-amber-500" /> Open Time Today
            <span className="text-zinc-600 normal-case font-normal">({totalOpenSlots} slot{totalOpenSlots === 1 ? '' : 's'} · 15+ min gaps)</span>
          </h2>
        </div>

        {workingBarbers.length === 0 ? (
          <p className="text-sm text-zinc-500 py-3 text-center">No barbers scheduled today.</p>
        ) : (
          <div className="space-y-3">
            {workingBarbers.map((b) => (
              <div key={b.barberId} className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-zinc-100">{b.barberName}</span>
                    {/* Current / next */}
                    {b.current ? (
                      <span className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-0.5">
                        Now: {b.current.customerName} · {b.current.serviceName} until {fmtTime(b.current.endTime)}
                      </span>
                    ) : b.next ? (
                      <span className="text-[11px] text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-full px-2.5 py-0.5">
                        Next: {b.next.customerName} at {fmtTime(b.next.startTime)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-zinc-600">No appointments left today</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Utilization: scheduled vs available minutes today */}
                    {b.utilization && b.utilization.availableMinutes > 0 && (
                      <span
                        className="text-[11px] text-zinc-400"
                        title={`Scheduled: ${Math.round(b.utilization.scheduledMinutes / 60 * 10) / 10}h · Available: ${Math.round(b.utilization.availableMinutes / 60 * 10) / 10}h (working window minus breaks, blocks, closures)`}
                      >
                        Scheduled: {Math.round((b.utilization.scheduledMinutes / 60) * 10) / 10}h · Available: {Math.round((b.utilization.availableMinutes / 60) * 10) / 10}h · Utilization: {Math.min(100, Math.round(b.utilization.utilizationPct ?? 0))}%
                      </span>
                    )}
                    <a
                      href={`/dashboard/calendar?date=${snapshot.dateStr}`}
                      className="text-xs font-semibold text-amber-400 hover:text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-1.5 transition-colors"
                    >
                      Book
                    </a>
                    <a
                      href={`/dashboard/schedule`}
                      className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded-lg px-2.5 py-1.5 transition-colors"
                    >
                      View schedule
                    </a>
                  </div>
                </div>

                {b.openRanges.length === 0 ? (
                  <p className="text-xs text-zinc-600">Fully booked or no bookable gaps for the rest of today.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {b.openRanges.map((r, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 text-xs text-zinc-200 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5"
                        title={`${r.minutes} minutes`}
                      >
                        <Clock className="w-3 h-3 text-amber-500/70" />
                        {fmtTime(r.start)} – {fmtTime(r.end)}
                        <span className="text-zinc-600">({r.minutes}m)</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Barbers off today */}
      {snapshot.barbers.some((b) => !b.isWorkingToday) && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4">
          <p className="text-xs text-zinc-500">
            Off today:{' '}
            {snapshot.barbers
              .filter((b) => !b.isWorkingToday)
              .map((b) => b.barberName)
              .join(', ')}
          </p>
        </div>
      )}
    </div>
  )
}

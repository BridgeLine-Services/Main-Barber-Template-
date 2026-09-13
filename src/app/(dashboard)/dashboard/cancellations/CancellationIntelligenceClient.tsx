'use client'

import { useState } from 'react'
import { AlertTriangle, TrendingDown, Users, CalendarX, Search, BellRing } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FillOpeningDialog } from './FillOpeningDialog'

interface CancellationRecord {
  id: string
  reason: string
  note: string | null
  createdAt: string
  customer: {
    id: string
    firstName: string
    lastName: string
    phone: string
    email: string
  }
  appointment: {
    id: string
    status: string
    serviceName: string
    barberName: string
    startTime: string
    endTime: string
    fillable: boolean
  } | null
}

interface FillOpening {
  appointmentId: string
  serviceName: string
  barberName: string
  startTimeLabel: string
  endTimeLabel: string
}

interface Stats {
  total: number
  byReason: Record<string, number>
  uniqueCustomers: number
}

const REASON_COLORS: Record<string, string> = {
  TOO_EXPENSIVE: 'text-red-400 bg-red-500/10 border-red-500/20',
  SCHEDULE_CONFLICT: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  FEELING_SICK: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  FOUND_ANOTHER_TIME: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  OTHER: 'text-zinc-400 bg-zinc-700/30 border-zinc-600',
}

const REASON_LABELS: Record<string, string> = {
  TOO_EXPENSIVE: 'Too Expensive',
  SCHEDULE_CONFLICT: 'Schedule Conflict',
  FEELING_SICK: 'Feeling Sick',
  FOUND_ANOTHER_TIME: 'Found Another Time',
  OTHER: 'Other',
}

export function CancellationIntelligenceClient({
  initialRecords,
  initialStats,
}: {
  initialRecords: CancellationRecord[]
  initialStats: Stats
}) {
  const [records] = useState(initialRecords)
  const [stats] = useState(initialStats)
  const [search, setSearch] = useState('')
  const [fillOpening, setFillOpening] = useState<FillOpening | null>(null)
  const [reasonFilter, setReasonFilter] = useState<string | null>(null)

  const filtered = records.filter(r => {
    if (reasonFilter && r.reason !== reasonFilter) return false
    if (search) {
      const q = search.toLowerCase()
      const name = `${r.customer.firstName} ${r.customer.lastName}`.toLowerCase()
      return name.includes(q) || r.customer.email.toLowerCase().includes(q) || r.customer.phone.includes(q)
    }
    return true
  })

  const maxReasonCount = Math.max(...Object.values(stats.byReason), 1)

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-100 font-serif">Cancellation Intelligence</h1>
        <p className="text-sm text-zinc-400 mt-1">Understand why customers cancel to reduce churn</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <CalendarX className="w-4 h-4 text-red-400" />
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Total Cancellations</span>
          </div>
          <p className="text-2xl font-bold text-zinc-100">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-orange-400" />
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Unique Customers</span>
          </div>
          <p className="text-2xl font-bold text-zinc-100">{stats.uniqueCustomers}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Repeat Cancellers</span>
          </div>
          <p className="text-2xl font-bold text-zinc-100">{stats.total - stats.uniqueCustomers}</p>
        </div>
      </div>

      {/* Reason Breakdown */}
      {Object.keys(stats.byReason).length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4 uppercase tracking-wide">Cancellation Reasons</h2>
          <div className="space-y-3">
            {Object.entries(stats.byReason)
              .sort(([,a], [,b]) => b - a)
              .map(([reason, count]) => (
                <div key={reason}>
                  <div className="flex items-center justify-between mb-1.5">
                    <button
                      onClick={() => setReasonFilter(reasonFilter === reason ? null : reason)}
                      className={cn(
                        'text-sm font-medium px-2.5 py-1 rounded-md border transition-colors',
                        REASON_COLORS[reason] || REASON_COLORS.OTHER
                      )}
                    >
                      {REASON_LABELS[reason] || reason}
                    </button>
                    <span className="text-sm text-zinc-400">{count} ({((count / stats.total) * 100).toFixed(1)}%)</span>
                  </div>
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500/60 rounded-full"
                      style={{ width: `${(count / maxReasonCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          placeholder="Search by customer name, email, or phone..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
        />
      </div>

      {/* Records Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <AlertTriangle className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-500 text-sm">
            {records.length === 0 ? 'No cancellation records yet.' : 'No records match your filter.'}
          </p>
        </div>
      ) : (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 text-xs uppercase border-b border-zinc-800">
                  <th className="text-left py-3 px-4 font-medium">Customer</th>
                  <th className="text-left py-3 px-4 font-medium">Reason</th>
                  <th className="text-left py-3 px-4 font-medium hidden md:table-cell">Note</th>
                  <th className="text-right py-3 px-4 font-medium">Date</th>
                  <th className="text-right py-3 px-4 font-medium">Fill</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="py-3 px-4">
                      <div className="text-zinc-200 font-medium">{r.customer.firstName} {r.customer.lastName}</div>
                      <div className="text-xs text-zinc-500 mt-0.5">{r.customer.phone}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={cn(
                        'inline-block px-2.5 py-1 rounded-md text-xs font-medium border',
                        REASON_COLORS[r.reason] || REASON_COLORS.OTHER
                      )}>
                        {REASON_LABELS[r.reason] || r.reason}
                      </span>
                    </td>
                    <td className="py-3 px-4 hidden md:table-cell text-zinc-400 text-xs italic max-w-xs">
                      {r.note || '—'}
                    </td>
                    <td className="py-3 px-4 text-right text-zinc-500 text-xs">
                      {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {r.appointment?.fillable ? (
                        <button
                          onClick={() => {
                            const start = new Date(r.appointment!.startTime)
                            const end = new Date(r.appointment!.endTime)
                            setFillOpening({
                              appointmentId: r.appointment!.id,
                              serviceName: r.appointment!.serviceName,
                              barberName: r.appointment!.barberName,
                              startTimeLabel: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                              endTimeLabel: end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                            })
                          }}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-1.5 transition-colors"
                        >
                          <BellRing className="w-3.5 h-3.5" />
                          Fill Opening
                        </button>
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cancellation-fill dialog */}
      {fillOpening && (
        <FillOpeningDialog
          opening={fillOpening}
          open={fillOpening !== null}
          onOpenChange={(next) => { if (!next) setFillOpening(null) }}
        />
      )}
    </div>
  )
}

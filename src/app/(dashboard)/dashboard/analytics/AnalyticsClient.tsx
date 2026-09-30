'use client'

import { useState, useCallback } from 'react'
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Calendar,
  AlertTriangle,
  UserPlus,
  Clock,
  Award,
  Users,
  Activity,
  LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface TodayStats {
  totalAppointments: number
  cancellations: number
  noShows: number
  newCustomers: number
  completed: number
  upcoming: number
}

interface BusinessPerformance {
  totalAppointments: number
  completedAppointments: number
  cancelledAppointments: number
  noShowAppointments: number
  revenueEstimate: number
  averageTicket: number
  cancellationRate: number
  noShowRate: number
  retentionRate: number
  newCustomers: number
  returningCustomers: number
  totalCustomers: number
}

interface ServiceBarberBreakdown {
  serviceName: string
  totalCount: number
  barberBreakdown: { barberName: string; count: number }[]
}

interface PeakHour {
  dayOfWeek: string
  hour: string
  count: number
}

interface BarberPerformance {
  barberName: string
  appointments: number
  revenue: number
  cancellations: number
  noShows: number
}

interface AnalyticsData {
  today: TodayStats
  performance: BusinessPerformance
  servicesPerBarber: ServiceBarberBreakdown[]
  peakHours: PeakHour[]
  barberPerformance: BarberPerformance[]
}

interface AnalyticsClientProps {
  initialData: AnalyticsData | null
}

export function AnalyticsClient({ initialData }: AnalyticsClientProps) {
  const [data, setData] = useState<AnalyticsData | null>(initialData)
  const [rangeDays, setRangeDays] = useState(30)
  const [, setLoading] = useState(false)

  const fetchAnalytics = useCallback(async (days: number) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/dashboard/analytics?days=${days}`)
      if (res.ok) {
        const result = await res.json()
        setData(result)
      }
    } catch (err) {
      console.error('Failed to fetch analytics:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleRangeChange = (days: number) => {
    setRangeDays(days)
    fetchAnalytics(days)
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Activity className="w-10 h-10 text-zinc-600 mx-auto mb-3 animate-pulse" />
          <p className="text-zinc-400 text-sm">Loading analytics...</p>
        </div>
      </div>
    )
  }

  const { today, performance, servicesPerBarber, peakHours, barberPerformance } = data

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 font-serif">Analytics</h1>
          <p className="text-sm text-zinc-400 mt-1">Business intelligence & performance insights</p>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              onClick={() => handleRangeChange(days)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors border',
                rangeDays === days
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:border-zinc-700'
              )}
            >
              {days === 7 ? '7 days' : days === 30 ? '30 days' : '90 days'}
            </button>
          ))}
        </div>
      </div>

      {/* Today's Stats */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3 uppercase tracking-wide">Today</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={Calendar}
            label="Appointments"
            value={today.totalAppointments}
            subtext={`${today.completed} done · ${today.upcoming} upcoming`}
            color="amber"
          />
          <StatCard
            icon={AlertTriangle}
            label="Cancellations"
            value={today.cancellations}
            subtext="Today"
            color="red"
          />
          <StatCard
            icon={Clock}
            label="No-Shows"
            value={today.noShows}
            subtext="Today"
            color="orange"
          />
          <StatCard
            icon={UserPlus}
            label="New Customers"
            value={today.newCustomers}
            subtext="Today"
            color="green"
          />
        </div>
      </div>

      {/* Business Performance */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3 uppercase tracking-wide">
          Business Performance · Last {rangeDays} days
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={Calendar}
            label="Total Appointments"
            value={performance.totalAppointments}
            subtext={`${performance.completedAppointments} completed`}
            color="amber"
          />
          <StatCard
            icon={DollarSign}
            label="Revenue Estimate"
            value={`$${performance.revenueEstimate.toFixed(0)}`}
            subtext={`Avg $${performance.averageTicket.toFixed(2)}/visit`}
            color="green"
          />
          <StatCard
            icon={TrendingDown}
            label="Cancellation Rate"
            value={`${performance.cancellationRate.toFixed(1)}%`}
            subtext={`${performance.cancelledAppointments} cancelled`}
            color="red"
          />
          <StatCard
            icon={AlertTriangle}
            label="No-Show Rate"
            value={`${performance.noShowRate.toFixed(1)}%`}
            subtext={`${performance.noShowAppointments} no-shows`}
            color="orange"
          />
          <StatCard
            icon={TrendingUp}
            label="Retention Rate"
            value={`${performance.retentionRate.toFixed(1)}%`}
            subtext={`${performance.returningCustomers} returning`}
            color="green"
          />
          <StatCard
            icon={UserPlus}
            label="New Customers"
            value={performance.newCustomers}
            subtext={`of ${performance.totalCustomers} total`}
            color="amber"
          />
          <StatCard
            icon={Award}
            label="Completed Visits"
            value={performance.completedAppointments}
            subtext="In range"
            color="amber"
          />
          <StatCard
            icon={Users}
            label="Returning Customers"
            value={performance.returningCustomers}
            subtext="Multiple visits"
            color="green"
          />
        </div>
      </div>

      {/* Two column: Barber Performance + Peak Hours */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Barber Performance */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4 uppercase tracking-wide flex items-center gap-2">
            <Award className="w-4 h-4 text-amber-500" />
            Barber Performance
          </h2>
          {barberPerformance.length === 0 ? (
            <p className="text-zinc-500 text-sm py-8 text-center">No data for this period</p>
          ) : (
            <div className="space-y-3">
              {barberPerformance.map((b, i) => {
                const maxRevenue = Math.max(...barberPerformance.map(b => b.revenue), 1)
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-200 text-sm font-medium">{b.barberName}</span>
                        <span className="text-xs text-zinc-500">
                          {b.appointments} appts · {b.cancellations} canc · {b.noShows} NS
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-amber-400">
                        ${b.revenue.toFixed(0)}
                      </span>
                    </div>
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500/60 rounded-full transition-all"
                        style={{ width: `${(b.revenue / maxRevenue) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Peak Hours */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-300 mb-4 uppercase tracking-wide flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500" />
            Peak Hours
          </h2>
          {peakHours.length === 0 ? (
            <p className="text-zinc-500 text-sm py-8 text-center">No data for this period</p>
          ) : (
            <div className="space-y-2.5">
              {peakHours.map((ph, i) => {
                const maxCount = Math.max(...peakHours.map(p => p.count), 1)
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-zinc-300">
                        {ph.dayOfWeek} · {ph.hour}
                      </span>
                      <span className="text-xs font-medium text-zinc-400">{ph.count} visits</span>
                    </div>
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500/60 rounded-full"
                        style={{ width: `${(ph.count / maxCount) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Services Per Barber */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4 uppercase tracking-wide flex items-center gap-2">
          <Calendar className="w-4 h-4 text-amber-500" />
          Services Breakdown by Barber
        </h2>
        {servicesPerBarber.length === 0 ? (
          <p className="text-zinc-500 text-sm py-8 text-center">No data for this period</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-500 text-xs uppercase border-b border-zinc-800">
                  <th className="text-left py-2 px-3 font-medium">Service</th>
                  <th className="text-right py-2 px-3 font-medium">Total</th>
                  <th className="text-left py-2 px-3 font-medium">Barber Breakdown</th>
                </tr>
              </thead>
              <tbody>
                {servicesPerBarber.map((s, i) => {
                  return (
                    <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="py-3 px-3 text-zinc-200 font-medium">{s.serviceName}</td>
                      <td className="py-3 px-3 text-right">
                        <span className="text-amber-400 font-semibold">{s.totalCount}</span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex flex-wrap gap-1.5">
                          {s.barberBreakdown.map((b, j) => (
                            <span
                              key={j}
                              className="text-xs px-2 py-1 rounded-md bg-zinc-800 text-zinc-400 border border-zinc-700/50"
                            >
                              {b.barberName}: <span className="text-zinc-200 font-medium">{b.count}</span>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Stat Card Component ────────────────────────────────────────────────────

const colorClasses: Record<string, { bg: string; text: string; border: string }> = {
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  red: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20' },
  green: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
}

function StatCard({
  icon: Icon,
  label,
  value,
  subtext,
  color = 'amber',
}: {
  icon: LucideIcon
  label: string
  value: string | number
  subtext: string
  color?: string
}) {
  const c = colorClasses[color] || colorClasses.amber
  return (
    <div className={cn('rounded-xl border p-4 bg-zinc-900/50', c.border)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">{label}</span>
        <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', c.bg, c.text)}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>
      <p className="text-2xl font-bold text-zinc-100">{value}</p>
      <p className="text-xs text-zinc-500 mt-1">{subtext}</p>
    </div>
  )
}

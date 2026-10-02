'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  RefreshCw,
  Calendar,
  Clock,
  User,
  Scissors,Send,
  Loader2,
  AlertTriangle,
  TrendingUp } from 'lucide-react'

interface RetentionMetrics {
  due: number
  overdue: number
  atRisk: number
  inactive: number
  cancellations: number
  noShows: number
  todayAppointments: number
  tomorrowAppointments: number
}

export interface RebookingTask {
  customerId: string
  customerName: string
  customerPhone: string
  customerEmail: string
  lastVisit: string
  averageIntervalDays: number
  predictedNextDate: string
  daysOverdue: number
  intelligence: {
    favoriteBarberName: string | null
    favoriteServiceName: string | null
    visitCount: number
    lifetimeValue: number
  }
}

export function RebookingDashboardClient({ initialTasks, initialMetrics }: { initialTasks: RebookingTask[]; initialMetrics: RetentionMetrics | null }) {
  const [tasks, setTasks] = useState(initialTasks)
  const metrics = initialMetrics
  const [sending, setSending] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())

  const handleSend = async (customerId: string) => {
    setSending(customerId)
    try {
      const res = await fetch('/api/dashboard/rebooking/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, channel: 'SMS' }),
      })
      const data = await res.json()
      if (data.success) {
        setSentIds(prev => new Set(prev).add(customerId))
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSending(null)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/dashboard/rebooking/tasks')
      const data = await res.json()
      setTasks(data.tasks || [])
    } catch (e) {
      console.error(e)
    } finally {
      setRefreshing(false)
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-serif text-foreground flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-amber-500" />
            Rebooking Engine
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {tasks.length} customer{tasks.length !== 1 ? 's' : ''} due for rebooking
          </p>
        </div>
        <Button
          onClick={handleRefresh}
          variant="outline"
          size="sm"
          className="bg-card border-border text-foreground/85 hover:bg-[var(--dash-hover)]"
        >
          {refreshing ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Refresh
        </Button>
      </div>

      {/* Summary Stats */}
      {tasks.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-[var(--dash-surface)] border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground font-medium">Total Due</p>
            <p className="text-2xl font-bold font-mono text-amber-400 mt-1">{tasks.length}</p>
          </div>
          <div className="bg-[var(--dash-surface)] border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground font-medium">Overdue 30+ Days</p>
            <p className="text-2xl font-bold font-mono text-red-400 mt-1">
              {tasks.filter(t => t.daysOverdue >= 30).length}
            </p>
          </div>
          <div className="bg-[var(--dash-surface)] border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground font-medium">Overdue 14+ Days</p>
            <p className="text-2xl font-bold font-mono text-orange-400 mt-1">
              {tasks.filter(t => t.daysOverdue >= 14).length}
            </p>
          </div>
          <div className="bg-[var(--dash-surface)] border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground font-medium">Avg Interval</p>
            <p className="text-2xl font-bold font-mono text-foreground mt-1">
              {Math.round(tasks.reduce((acc, t) => acc + t.averageIntervalDays, 0) / tasks.length)}d
            </p>
          </div>
        </div>
      )}

      {metrics && (
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
  {[
  ['Due', metrics.due, 'text-amber-400'],
  ['Overdue', metrics.overdue, 'text-orange-400'],
  ['At risk', metrics.atRisk, 'text-red-400'],
  ['Today', metrics.todayAppointments, 'text-emerald-400'],
  ].map(([label, value, color]) => (
  <Link key={label} href="#retention-tasks" className="bg-[var(--dash-surface)] border border-border rounded-xl p-4 hover:border-amber-500/40 transition-colors">
  <p className="text-xs text-muted-foreground font-medium">{label}</p>
  <p className={`text-2xl font-bold font-mono mt-1 ${color}`}>{value}</p>
  </Link>
  ))}
  </div>
  )}

  {/* Tasks List */}
      {tasks.length === 0 ? (
        <div className="bg-[var(--dash-surface)] border border-border rounded-2xl p-12 text-center">
          <Calendar className="w-10 h-10 mx-auto text-zinc-700 mb-3" />
          <p className="text-sm text-muted-foreground font-medium">No customers due for rebooking</p>
          <p className="text-xs text-muted-foreground mt-1">All caught up! Customers will appear here when they're due.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const isSent = sentIds.has(task.customerId)
            const overdueColor =
              task.daysOverdue >= 30 ? 'text-red-400 bg-red-500/10 border-red-500/20' :
              task.daysOverdue >= 14 ? 'text-orange-400 bg-orange-500/10 border-orange-500/20' :
              'text-amber-400 bg-amber-500/10 border-amber-500/20'

            return (
              <div
                key={task.customerId}
                className="bg-[var(--dash-surface)] border border-border rounded-2xl p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-sm font-serif shrink-0">
                      {task.customerName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <div>
                      <Link
                        href={`/dashboard/customers/${task.customerId}`}
                        className="text-sm font-semibold text-foreground hover:text-amber-400 transition-colors"
                      >
                        {task.customerName}
                      </Link>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${overdueColor}`}>
                          {task.daysOverdue > 0 ? `${task.daysOverdue}d overdue` : 'Due today'}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {task.intelligence.visitCount} visits · ${task.intelligence.lifetimeValue} LTV
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isSent ? (
                      <span className="text-xs text-emerald-400 font-medium px-3 py-2">
                        ✓ Reminder sent
                      </span>
                    ) : (
                      <Button
                        onClick={() => handleSend(task.customerId)}
                        disabled={sending === task.customerId}
                        size="sm"
                        className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                      >
                        {sending === task.customerId ? (
                          <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Sending...</>
                        ) : (
                          <><Send className="w-3.5 h-3.5 mr-1.5" />Send Reminder</>
                        )}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Intelligence Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="flex items-center gap-2 bg-card/60 border border-border/60 rounded-lg p-2.5">
                    <User className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Fav. Barber</p>
                      <p className="text-xs font-medium text-foreground">{task.intelligence.favoriteBarberName || 'N/A'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-card/60 border border-border/60 rounded-lg p-2.5">
                    <Scissors className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Fav. Service</p>
                      <p className="text-xs font-medium text-foreground">{task.intelligence.favoriteServiceName || 'N/A'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-card/60 border border-border/60 rounded-lg p-2.5">
                    <Clock className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Interval</p>
                      <p className="text-xs font-medium text-foreground">{task.averageIntervalDays} days</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-card/60 border border-border/60 rounded-lg p-2.5">
                    <Calendar className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Last Visit</p>
                      <p className="text-xs font-medium text-foreground">{formatDate(task.lastVisit)}</p>
                    </div>
                  </div>
                </div>

                {/* Predicted date */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 border-t border-border/60">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  <span>
                    Expected: <span className="text-amber-400 font-medium">{formatDate(task.predictedNextDate)}</span>
                    {' · '}
                    {task.daysOverdue > 0
                      ? `${task.daysOverdue} days overdue`
                      : 'Due now'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

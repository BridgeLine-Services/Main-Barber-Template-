'use client'

import { useState } from 'react'
import { UserX, AlertTriangle, Shield, Users, Save } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NoShowAppointment {
  id: string
  confirmationNumber: string
  startTime: string
  noShowCount: number
  noShowReason?: string | null
  noShowAt?: string | null
  reliability?: { band: string; label: string; noShowPercentage: number }
  customer: { id: string; firstName: string; lastName: string; phone: string; email: string }
  barber: { name: string } | null
  service: { name: string; price: number } | null
}

interface NoShowPolicy {
  id: string
  firstNoShow: string
  secondNoShow: string
  thirdNoShow: string
  requireDeposit: boolean
  depositAmount: number | null
  isActive: boolean
}

export interface NoShowData {
  noShows: NoShowAppointment[]
  policy: NoShowPolicy
  stats: { total: number; uniqueCustomers: number; repeatOffenders: number }
}

const ESCALATION_LABELS: Record<string, string> = {
  warning: 'Warning Only',
  flag: 'Flag Customer',
  require_confirmation: 'Require Confirmation',
  require_deposit: 'Require Deposit',
}

const OFFENSE_COLORS: Record<number, string> = {
  1: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  2: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  3: 'text-red-400 bg-red-500/10 border-red-500/20',
}

export function NoShowManagementClient({ initialData }: { initialData: NoShowData | null }) {
  const [noShows] = useState(initialData?.noShows || [])
  const [policy, setPolicy] = useState<NoShowPolicy | null>(initialData?.policy || null)
  const [stats] = useState(initialData?.stats || { total: 0, uniqueCustomers: 0, repeatOffenders: 0 })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handlePolicyUpdate = async () => {
    if (!policy) return
    setSaving(true)
    try {
      const res = await fetch('/api/dashboard/no-shows', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } catch (err) {
      console.error('Policy update error:', err)
    } finally {
      setSaving(false)
    }
  }

  if (!initialData) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <UserX className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Loading no-show data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground font-serif">No-Show Management</h1>
        <p className="text-sm text-muted-foreground mt-1">Track no-shows and configure escalation policies</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <UserX className="w-4 h-4 text-red-400" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total No-Shows</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-orange-400" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Unique Customers</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{stats.uniqueCustomers}</p>
        </div>
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Repeat Offenders</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{stats.repeatOffenders}</p>
        </div>
      </div>

      {/* Policy Configuration */}
      {policy && (
        <div className="bg-card/50 border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground/85 uppercase tracking-wide flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-500" />
              Escalation Policy
            </h2>
            <button
              onClick={handlePolicyUpdate}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Policy'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(['firstNoShow', 'secondNoShow', 'thirdNoShow'] as const).map((field, idx) => (
              <div key={field}>
                <label className="block text-sm text-muted-foreground mb-2">
                  {idx === 0 ? '1st No-Show' : idx === 1 ? '2nd No-Show' : '3rd No-Show'}
                </label>
                <select
                  value={policy[field]}
                  onChange={e => setPolicy({ ...policy, [field]: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--dash-surface)] border border-border text-foreground text-sm focus:outline-none focus:border-amber-500/50"
                >
                  {Object.entries(ESCALATION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-6 pt-2 border-t border-border/50">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={policy.requireDeposit}
                onChange={e => setPolicy({ ...policy, requireDeposit: e.target.checked })}
                className="w-4 h-4 rounded border-input bg-card text-amber-500 focus:ring-amber-500/50"
              />
              <span className="text-sm text-foreground/85">Require deposit for flagged customers</span>
            </label>
            {policy.requireDeposit && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Amount:</span>
                <input
                  type="number"
                  step="0.01"
                  value={policy.depositAmount || ''}
                  onChange={e => setPolicy({ ...policy, depositAmount: parseFloat(e.target.value) || null })}
                  placeholder="0.00"
                  className="w-24 px-2 py-1 rounded-lg bg-[var(--dash-surface)] border border-border text-foreground text-sm focus:outline-none focus:border-amber-500/50"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* No-Show Records */}
      {noShows.length === 0 ? (
        <div className="text-center py-16">
          <UserX className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No no-show records yet.</p>
        </div>
      ) : (
        <div className="bg-card/50 border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs uppercase border-b border-border">
                  <th className="text-left py-3 px-4 font-medium">Customer</th>
                  <th className="text-left py-3 px-4 font-medium hidden md:table-cell">Barber</th>
                  <th className="text-left py-3 px-4 font-medium hidden lg:table-cell">Service</th>
                  <th className="text-center py-3 px-4 font-medium">Offenses</th>
                  <th className="text-left py-3 px-4 font-medium hidden sm:table-cell">Reliability</th>
                  <th className="text-left py-3 px-4 font-medium hidden lg:table-cell">Reason</th>
                  <th className="text-right py-3 px-4 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {noShows.map(a => (
                  <tr key={a.id} className="border-b border-border/50 hover:bg-[var(--dash-hover)]">
                    <td className="py-3 px-4">
                      <div className="text-foreground font-medium">{a.customer.firstName} {a.customer.lastName}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{a.customer.phone}</div>
                    </td>
                    <td className="py-3 px-4 hidden md:table-cell text-muted-foreground">{a.barber?.name || '—'}</td>
                    <td className="py-3 px-4 hidden lg:table-cell text-muted-foreground">{a.service?.name || '—'}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={cn(
                        'inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border',
                        OFFENSE_COLORS[Math.min(a.noShowCount, 3)] || OFFENSE_COLORS[3]
                      )}>
                        {a.noShowCount}x
                      </span>
                    </td>
                    <td className="py-3 px-4 hidden sm:table-cell">
                      <span className={cn(
                        'inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium',
                        a.reliability?.band === 'HIGH_RISK' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
                          a.reliability?.band === 'WATCH' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
                            'text-foreground/85 bg-muted border-input'
                      )}>
                        {a.reliability?.label || 'Watch'}{a.reliability ? ` · ${a.reliability.noShowPercentage}%` : ''}
                      </span>
                    </td>
                    <td className="py-3 px-4 hidden lg:table-cell text-muted-foreground max-w-48 truncate">
                      {a.noShowReason || 'Not recorded'}
                    </td>
                    <td className="py-3 px-4 text-right text-muted-foreground text-xs">
                      {new Date(a.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

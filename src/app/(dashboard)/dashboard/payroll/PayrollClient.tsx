'use client'

/**
 * Owner Payroll Reporting dashboard client.
 *
 * The owner is the final authority: the shop-level switch gates the whole
 * feature. When OFF, reports are hidden (rows stay untouched) and only
 * the settings card shows. When ON, the owner can generate payroll-ready
 * period reports, review, export CSV, finalize, and correct finalized
 * numbers through the audited adjustment mechanism.
 *
 * This is NOT a payroll processor: it organizes payroll-ready information
 * for the owner to hand to their actual payroll provider.
 */
import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { Loader2, Download, Lock, Plus } from 'lucide-react'

interface PayrollSettingsDto {
  id: string
  enabled: boolean
  payPeriodType: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'CUSTOM'
  payPeriodAnchorDate: string
  customPeriodDays: number
  barberSelfView: boolean
}

interface ReportLine {
  id: string
  barberId: string
  barberName: string
  serviceRevenue: number
  tips: number
  commission: number
  adjustments: number
  regularHours: number
  overtimeHours: number
  totalHours: number
  estimatedPayout: number
  manualAdjustments: number
  effectivePayout: number
}

interface ReportDto {
  id: string
  status: 'DRAFT' | 'REVIEWED' | 'EXPORTED' | 'FINALIZED'
  periodType: string
  periodStart: string
  periodEnd: string
  periodLabel: string
  reviewedAt: string | null
  exportedAt: string | null
  finalizedAt: string | null
  createdAt: string
}

interface ReportListItem extends ReportDto {
  lines: { barberName: string }[]
  _count: { adjustments: number }
}

interface AdjustmentDto {
  id: string
  barberId: string
  amount: number
  reason: string
  createdAt: string
}

const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
const hours = (n: number) => n.toFixed(2)

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  REVIEWED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  EXPORTED: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  FINALIZED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
}

export function PayrollClient({ enabled }: { enabled: boolean }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState<PayrollSettingsDto | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [reports, setReports] = useState<ReportListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{
    report: ReportDto
    lines: ReportLine[]
    adjustments: AdjustmentDto[]
  } | null>(null)
  const [anchor, setAnchor] = useState('')
  const [generating, setGenerating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [adjOpen, setAdjOpen] = useState(false)
  const [adjBarber, setAdjBarber] = useState('')
  const [adjAmount, setAdjAmount] = useState('')
  const [adjReason, setAdjReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [settingsRes, reportsRes] = await Promise.all([
        fetch('/api/dashboard/payroll/settings'),
        fetch('/api/dashboard/payroll/reports'),
      ])
      if (settingsRes.ok) setSettings((await settingsRes.json()).settings)
      if (reportsRes.ok) {
        const data = await reportsRes.json()
        setReports(data.reports ?? [])
      }
    } catch {
      toast({ title: 'Could not load payroll settings', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  const loadDetail = useCallback(
    async (id: string) => {
      setBusy(true)
      try {
        const res = await fetch(`/api/dashboard/payroll/reports/${id}`)
        if (res.ok) {
          setDetail(await res.json())
          setSelectedId(id)
        } else if (res.status === 404) {
          toast({ title: 'Report not found', variant: 'destructive' })
          setSelectedId(null)
        }
      } catch {
        toast({ title: 'Could not load report', variant: 'destructive' })
      } finally {
        setBusy(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (enabled && reports.length > 0 && !selectedId) loadDetail(reports[0].id)
  }, [enabled, reports, selectedId, loadDetail])

  const patchSettings = async (data: Partial<PayrollSettingsDto>) => {
    if (!settings) return
    setSavingSettings(true)
    try {
      const res = await fetch('/api/dashboard/payroll/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        const { settings: updated } = await res.json()
        setSettings(updated)
        if (data.enabled !== undefined) {
          // list visibility changes with the master switch
          const reportsRes = await fetch('/api/dashboard/payroll/reports')
          if (reportsRes.ok) {
            const data2 = await reportsRes.json()
            setReports(data2.reports ?? [])
            if (!data2.reports?.length) {
              setDetail(null)
              setSelectedId(null)
            }
          }
        }
        toast({ title: 'Payroll settings saved' })
      } else {
        const body = await res.json().catch(() => ({}))
        toast({ title: body.error ?? 'Could not save settings', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Could not save settings', variant: 'destructive' })
    } finally {
      setSavingSettings(false)
    }
  }

  const generate = async () => {
    setGenerating(true)
    try {
      const body: Record<string, string> = anchor ? { anchor } : {}
      const res = await fetch('/api/dashboard/payroll/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast({ title: `Report created for ${data.report.periodLabel}` })
        await load()
        await loadDetail(data.report.id)
      } else {
        toast({ title: data.error ?? 'Could not generate report', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Could not generate report', variant: 'destructive' })
    } finally {
      setGenerating(false)
    }
  }

  const setStatus = async (status: 'REVIEWED' | 'FINALIZED') => {
    if (!selectedId) return
    setBusy(true)
    try {
      const res = await fetch(`/api/dashboard/payroll/reports/${selectedId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast({ title: `Report marked ${status.toLowerCase()}` })
        await load()
        await loadDetail(selectedId)
      } else {
        toast({ title: data.error ?? 'Could not update status', variant: 'destructive' })
      }
    } finally {
      setBusy(false)
    }
  }

  const addAdjustment = async () => {
    if (!selectedId || !adjBarber) return
    setBusy(true)
    try {
      const res = await fetch(`/api/dashboard/payroll/reports/${selectedId}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barberId: adjBarber,
          amount: Number(adjAmount),
          reason: adjReason,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast({ title: 'Adjustment added (audited)' })
        setAdjOpen(false)
        setAdjBarber('')
        setAdjAmount('')
        setAdjReason('')
        await load()
        await loadDetail(selectedId)
      } else {
        toast({ title: data.error ?? 'Could not add adjustment', variant: 'destructive' })
      }
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = () => {
    if (selectedId) window.open(`/api/dashboard/payroll/reports/${selectedId}/export`, '_blank')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payroll Reporting</h1>
        <p className="text-sm text-muted-foreground">
          Payroll-ready reports for your actual payroll provider — never a
          payroll processor. Owner only.
        </p>
      </div>

      {/* ── Shop settings (owner authority) ── */}
      <Card>
        <CardHeader>
          <CardTitle>Feature settings</CardTitle>
          <CardDescription>
            You have final authority. Turning reporting OFF hides reports but
            keeps every historical record — time clock, commissions,
            appointments, and payments keep working either way.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Payroll Reporting</p>
              <p className="text-sm text-muted-foreground">
                {settings?.enabled ? 'On — reports available below' : 'Off — reports hidden'}
              </p>
            </div>
            <Switch
              checked={!!settings?.enabled}
              disabled={savingSettings}
              onCheckedChange={(v) => patchSettings({ enabled: v })}
            />
          </div>

          {settings?.enabled && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Pay period</Label>
                  <Select
                    value={settings.payPeriodType}
                    onValueChange={(v) =>
                      patchSettings({ payPeriodType: v as PayrollSettingsDto['payPeriodType'] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="WEEKLY">Weekly</SelectItem>
                      <SelectItem value="BIWEEKLY">Biweekly</SelectItem>
                      <SelectItem value="MONTHLY">Monthly</SelectItem>
                      <SelectItem value="CUSTOM">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {settings.payPeriodType === 'CUSTOM' && (
                  <div className="space-y-1.5">
                    <Label>Custom length (days)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={settings.customPeriodDays}
                      onChange={(e) =>
                        setSettings({ ...settings, customPeriodDays: Number(e.target.value) })
                      }
                      onBlur={() =>
                        patchSettings({ customPeriodDays: settings.customPeriodDays })
                      }
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Anchor date</Label>
                  <Input
                    type="date"
                    value={settings.payPeriodAnchorDate.slice(0, 10)}
                    onChange={(e) => {
                      if (e.target.value) patchSettings({ payPeriodAnchorDate: e.target.value })
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Barber self-view</p>
                  <p className="text-xs text-muted-foreground">
                    Let each barber see their own payroll summary — never other
                    barbers&apos; data and never shop totals.
                  </p>
                </div>
                <Switch
                  checked={settings.barberSelfView}
                  disabled={savingSettings}
                  onCheckedChange={(v) => patchSettings({ barberSelfView: v })}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {settings?.enabled ? (
        <>
          {/* ── Generate ── */}
          <Card>
            <CardHeader>
              <CardTitle>Generate a report</CardTitle>
              <CardDescription>
                Pick any date in the pay period you want. The report freezes
                time clock hours, completed-service revenue, tips, commissions,
                and adjustments as of today.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label>Period date</Label>
                <Input
                  type="date"
                  value={anchor}
                  onChange={(e) => setAnchor(e.target.value)}
                />
              </div>
              <Button onClick={generate} disabled={generating}>
                {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Generate draft
              </Button>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* ── Report list ── */}
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle>Reports</CardTitle>
                <CardDescription>Newest first</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {reports.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No payroll reports yet.
                  </p>
                )}
                {reports.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => loadDetail(r.id)}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      selectedId === r.id ? 'border-primary bg-accent' : 'hover:bg-accent'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{r.periodLabel}</span>
                      <Badge className={STATUS_STYLE[r.status]}>{r.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {r.lines.length} barber{r.lines.length === 1 ? '' : 's'}
                      {r._count?.adjustments ? ` · ${r._count.adjustments} adjustment${r._count.adjustments === 1 ? '' : 's'}` : ''}
                    </p>
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* ── Report detail ── */}
            <Card className="lg:col-span-2">
              {detail ? (
                <>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <CardTitle>{detail.report.periodLabel}</CardTitle>
                        <CardDescription>
                          {detail.report.periodType.toLowerCase()} period ·{' '}
                          {new Date(detail.report.periodStart).toLocaleDateString()} –{' '}
                          {new Date(detail.report.periodEnd).toLocaleDateString()}
                        </CardDescription>
                      </div>
                      <Badge className={STATUS_STYLE[detail.report.status]}>
                        {detail.report.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                            <th className="py-2 pr-3">Barber</th>
                            <th className="py-2 pr-3">Services</th>
                            <th className="py-2 pr-3">Tips</th>
                            <th className="py-2 pr-3">Commission</th>
                            <th className="py-2 pr-3">Adj.</th>
                            <th className="py-2 pr-3">Reg. hrs</th>
                            <th className="py-2 pr-3">OT hrs</th>
                            <th className="py-2 pr-3">Total hrs</th>
                            <th className="py-2">Est. payout</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.lines.map((l) => (
                            <tr key={l.id} className="border-b last:border-0">
                              <td className="py-2 pr-3 font-medium">{l.barberName}</td>
                              <td className="py-2 pr-3">{money(l.serviceRevenue)}</td>
                              <td className="py-2 pr-3">{money(l.tips)}</td>
                              <td className="py-2 pr-3">{money(l.commission)}</td>
                              <td className="py-2 pr-3">
                                {money(l.adjustments)}
                                {l.manualAdjustments !== 0 && (
                                  <span className="ml-1 text-xs text-muted-foreground">
                                    ({l.manualAdjustments > 0 ? '+' : ''}
                                    {l.manualAdjustments} manual)
                                  </span>
                                )}
                              </td>
                              <td className="py-2 pr-3">{hours(l.regularHours)}</td>
                              <td className="py-2 pr-3">{hours(l.overtimeHours)}</td>
                              <td className="py-2 pr-3">{hours(l.totalHours)}</td>
                              <td className="py-2 font-medium">{money(l.effectivePayout)}</td>
                            </tr>
                          ))}
                          {detail.lines.length === 0 && (
                            <tr>
                              <td colSpan={9} className="py-4 text-center text-muted-foreground">
                                No activity this period.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {detail.adjustments.length > 0 && (
                      <div className="rounded-md border p-3">
                        <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                          Adjustment trail (finalized data is never rewritten)
                        </p>
                        <ul className="space-y-1 text-sm">
                          {detail.adjustments.map((a) => (
                            <li key={a.id} className="flex justify-between gap-2">
                              <span>
                                {detail.lines.find((l) => l.barberId === a.barberId)?.barberName ??
                                  'Barber'}
                                : {a.reason}
                              </span>
                              <span className="font-medium">
                                {a.amount > 0 ? '+' : ''}
                                {money(a.amount).replace('$', '$')}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={exportCsv}>
                        <Download className="mr-2 h-4 w-4" />
                        Export CSV
                      </Button>
                      {detail.report.status === 'DRAFT' && (
                        <Button variant="outline" onClick={() => setStatus('REVIEWED')} disabled={busy}>
                          Mark reviewed
                        </Button>
                      )}
                      {detail.report.status !== 'FINALIZED' && (
                        <Button
                          variant="outline"
                          onClick={() => setStatus('FINALIZED')}
                          disabled={busy}
                        >
                          <Lock className="mr-2 h-4 w-4" />
                          Finalize
                        </Button>
                      )}
                      <Button variant="outline" onClick={() => setAdjOpen(!adjOpen)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add adjustment
                      </Button>
                    </div>

                    {adjOpen && (
                      <div className="space-y-3 rounded-md border p-3">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="space-y-1.5">
                            <Label>Barber</Label>
                            <Select value={adjBarber} onValueChange={setAdjBarber}>
                              <SelectTrigger>
                                <SelectValue placeholder="Choose" />
                              </SelectTrigger>
                              <SelectContent>
                                {detail.lines.map((l) => (
                                  <SelectItem key={l.barberId} value={l.barberId}>
                                    {l.barberName}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label>Amount ($)</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={adjAmount}
                              onChange={(e) => setAdjAmount(e.target.value)}
                              placeholder="e.g. -25 or 50"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Reason (required)</Label>
                            <Input
                              value={adjReason}
                              onChange={(e) => setAdjReason(e.target.value)}
                              placeholder="e.g. missed break deduction"
                            />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Adjustments append to the audit trail — finalized
                          numbers are never silently modified.
                        </p>
                        <Button size="sm" onClick={addAdjustment} disabled={busy || !adjBarber || !adjAmount || !adjReason.trim()}>
                          Save adjustment
                        </Button>
                      </div>
                    )}

                    {detail.report.status === 'FINALIZED' && (
                      <p className="text-xs text-muted-foreground">
                        This report is finalized. Need a change? Add an audited
                        adjustment above — the frozen numbers stay provable.
                      </p>
                    )}
                  </CardContent>
                </>
              ) : (
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Generate a report to see per-barber hours, revenue, tips,
                    commissions, and estimated payouts.
                  </p>
                </CardContent>
              )}
            </Card>
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Payroll reporting is off. Historical reports are preserved and
              will reappear when you turn it back on. Time clock,
              commissions, appointments, and payments are unaffected.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

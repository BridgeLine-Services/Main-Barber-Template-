'use client'

/**
 * Owner commissions dashboard client.
 *
 * The OWNER is the final authority: the master switch gates everything.
 * Disabled = live dashboards hidden, calculations stopped, historical
 * ledger rows preserved below the switch. Every action here calls a
 * server-authorized owner-only API — hiding this UI is never the only
 * defense.
 */
import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { Loader2 } from 'lucide-react'

interface Settings {
  id: string
  enabled: boolean
  barberSelfViewEnabled: boolean
  defaultRateType: 'PERCENT' | 'FIXED'
  defaultRatePercent: number
  defaultRateFixed: number
  productCommissionEnabled: boolean
  productRateType: 'PERCENT' | 'FIXED'
  productRatePercent: number
  productRateFixed: number
  tipsMode: 'EXCLUDED' | 'PASS_THROUGH' | 'PERCENT'
  tipsCommissionPercent: number
  includeNoShowFees: boolean
  calculateOnUnpaid: boolean
}

interface Rule {
  id: string
  barberId: string | null
  serviceId: string | null
  rateType: 'PERCENT' | 'FIXED'
  ratePercent: number | null
  rateFixed: number | null
  barber?: { id: string; name: string } | null
  service?: { id: string; name: string } | null
}

interface ReportBarber {
  barberId: string
  name: string
  serviceRevenue: number
  productRevenue: number
  tips: number
  rateLabel: string
  commission: number
  adjustments: number
  shopShare: number
  payout: number
  pendingPayout: number
  paidPayout: number
  entryCount: number
}

interface Report {
  from: string
  to: string
  totals: {
    serviceRevenue: number
    productRevenue: number
    tips: number
    commission: number
    adjustments: number
    shopShare: number
    payout: number
    pendingPayout: number
    paidPayout: number
  }
  barbers: ReportBarber[]
}

interface Entry {
  id: string
  barberName: string
  appointmentRef: string | null
  serviceName: string | null
  source: 'SERVICE' | 'PRODUCT' | 'TIP'
  grossAmount: number
  rateType: string
  ratePercent: number | null
  rateFixed: number | null
  commissionAmount: number
  adjustment: number
  refundAdjustment: number
  payout: number
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'ADJUSTED'
  paidAmount: number
  notes: string | null
  createdAt: string
}

interface BarberOpt { id: string; name: string }
interface ServiceOpt { id: string; name: string }

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const STATUS_BADGE: Record<Entry['status'], string> = {
  PENDING: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  APPROVED: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  PAID: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  ADJUSTED: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
}

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
] as const

export function CommissionsClient({ initialEnabled }: { initialEnabled: boolean }) {
  const { toast } = useToast()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [enabled, setEnabled] = useState(initialEnabled)
  const [rules, setRules] = useState<Rule[]>([])
  const [barbers, setBarbers] = useState<BarberOpt[]>([])
  const [services, setServices] = useState<ServiceOpt[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [preset, setPreset] = useState<'today' | 'week' | 'month'>('month')
  const [barberFilter, setBarberFilter] = useState<string>('all')
  const [busy, setBusy] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)

  // ── rule form state ──
  const [ruleBarber, setRuleBarber] = useState<string>('any')
  const [ruleService, setRuleService] = useState<string>('any')
  const [ruleType, setRuleType] = useState<'PERCENT' | 'FIXED'>('PERCENT')
  const [rulePercent, setRulePercent] = useState<string>('40')
  const [ruleFixed, setRuleFixed] = useState<string>('')

  const loadAll = useCallback(async () => {
    try {
      const [sRes, bRes, svRes] = await Promise.all([
        fetch('/api/dashboard/commissions/settings'),
        fetch('/api/dashboard/barbers'),
        fetch('/api/dashboard/services'),
      ])
      if (sRes.ok) {
        const data = await sRes.json()
        setSettings(data.settings)
        setRules(data.rules)
        setEnabled(data.settings.enabled)
      }
      if (bRes.ok) {
        const data = await bRes.json()
        setBarbers(Array.isArray(data) ? data : (data.barbers ?? []))
      }
      if (svRes.ok) {
        const data = await svRes.json()
        setServices(Array.isArray(data) ? data : (data.services ?? []))
      }
    } catch {
      toast({ title: 'Failed to load commission data', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }, [toast])

  const loadReportAndEntries = useCallback(async () => {
    const q = new URLSearchParams({ preset, ...(barberFilter !== 'all' ? { barberId: barberFilter } : {}) })
    try {
      const [rRes, eRes] = await Promise.all([
        fetch(`/api/dashboard/commissions/report?${q}`),
        fetch(`/api/dashboard/commissions/entries?${q}`),
      ])
      if (rRes.ok) setReport((await rRes.json()).report)
      if (eRes.ok) setEntries((await eRes.json()).entries)
    } catch {
      toast({ title: 'Failed to load report', variant: 'destructive' })
    }
  }, [preset, barberFilter, toast])

  useEffect(() => {
    void Promise.resolve().then(loadAll)
  }, [loadAll])
  useEffect(() => {
    void Promise.resolve().then(loadReportAndEntries)
  }, [loadReportAndEntries])

  const patchSettings = async (patch: Partial<Settings>) => {
    if (!settings) return
    setSavingSettings(true)
    try {
      const res = await fetch('/api/dashboard/commissions/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setSettings(data.settings)
      setEnabled(data.settings.enabled)
      toast({ title: 'Commission settings saved' })
    } catch {
      toast({ title: 'Could not save settings', variant: 'destructive' })
    } finally {
      setSavingSettings(false)
    }
  }

  const addRule = async () => {
    const body: Record<string, unknown> = {
      barberId: ruleBarber === 'any' ? null : ruleBarber,
      serviceId: ruleService === 'any' ? null : ruleService,
      rateType: ruleType,
    }
    if (ruleType === 'PERCENT') body.ratePercent = Number(rulePercent)
    else body.rateFixed = Number(ruleFixed)
    try {
      const res = await fetch('/api/dashboard/commissions/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Invalid rule')
      }
      await loadAll()
      toast({ title: 'Commission rule saved' })
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Could not save rule', variant: 'destructive' })
    }
  }

  const deleteRule = async (id: string) => {
    try {
      const res = await fetch(`/api/dashboard/commissions/rules/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setRules((r) => r.filter((x) => x.id !== id))
      toast({ title: 'Rule removed' })
    } catch {
      toast({ title: 'Could not remove rule', variant: 'destructive' })
    }
  }

  const entryAction = async (id: string, action: 'approve' | 'adjust' | 'mark-paid', amount?: number, notes?: string) => {
    try {
      const res = await fetch(`/api/dashboard/commissions/entries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(amount !== undefined ? { amount } : {}), ...(notes !== undefined ? { notes } : {}) }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Action failed')
      }
      await loadReportAndEntries()
      toast({ title: `Entry ${action === 'mark-paid' ? 'marked paid' : 'updated'}` })
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'Action failed', variant: 'destructive' })
    }
  }

  const deleteEntry = async (id: string) => {
    if (!window.confirm('Delete this commission entry? This is a correction and will be audited.')) return
    try {
      const res = await fetch(`/api/dashboard/commissions/entries/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      await loadReportAndEntries()
      toast({ title: 'Entry deleted (audited)' })
    } catch {
      toast({ title: 'Could not delete entry', variant: 'destructive' })
    }
  }

  const exportCsv = () => {
    const q = new URLSearchParams({ preset, format: 'csv', ...(barberFilter !== 'all' ? { barberId: barberFilter } : {}) })
    window.open(`/api/dashboard/commissions/report?${q}`, '_blank')
  }

  const rateLabel = (r: Rule) =>
    r.rateType === 'PERCENT' ? `${r.ratePercent ?? 0}%` : `$${(r.rateFixed ?? 0).toFixed(2)} flat`

  return (
    <div className="space-y-6 p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Commissions</h1>
          <p className="text-sm text-muted-foreground">
            Owner-controlled barber commission system — rates, ledger and payouts.
          </p>
        </div>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {/* ── Master switch ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Master Switch</CardTitle>
              <CardDescription>
                OFF stops all commission calculations and hides barber views. Historical records are preserved.
              </CardDescription>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => {
                setEnabled(checked)
                void patchSettings({ enabled: checked })
              }}
              aria-label="Enable commissions"
            />
          </div>
        </CardHeader>
        {!enabled && (
          <CardContent className="pt-0">
            <p className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
              Commissions are currently disabled. Calculations are stopped and barber commission views are hidden.
              Enable the switch to configure rates and use the dashboards below — historical ledger rows are never
              deleted by disabling.
            </p>
          </CardContent>
        )}
      </Card>

      {enabled && settings && (
        <>
          {/* ── Configuration ── */}
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>Shop defaults; per-barber and per-service overrides live in Rules below.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">Default Rate</Label>
                    <p className="text-xs text-muted-foreground">Applied when no rule matches the barber/service.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={settings.defaultRateType}
                    onValueChange={(v) => patchSettings({ defaultRateType: v as 'PERCENT' | 'FIXED' })}
                  >
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PERCENT">Percent</SelectItem>
                      <SelectItem value="FIXED">Flat</SelectItem>
                    </SelectContent>
                  </Select>
                  {settings.defaultRateType === 'PERCENT' ? (
                    <div className="relative max-w-[120px]">
                      <Input
                        type="number" min={0} max={100} defaultValue={settings.defaultRatePercent}
                        onBlur={(e) => patchSettings({ defaultRatePercent: Number(e.target.value) })}
                        className="pr-7"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">%</span>
                    </div>
                  ) : (
                    <div className="relative max-w-[140px]">
                      <Input
                        type="number" min={0} step="0.01" defaultValue={settings.defaultRateFixed}
                        onBlur={(e) => patchSettings({ defaultRateFixed: Number(e.target.value) })}
                        className="pl-7"
                      />
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">$</span>
                    </div>
                  )}
                  {savingSettings && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">Barber Self-View</Label>
                    <p className="text-xs text-muted-foreground">Let barbers see their own commissions &amp; earnings.</p>
                  </div>
                  <Switch
                    checked={settings.barberSelfViewEnabled}
                    onCheckedChange={(v) => patchSettings({ barberSelfViewEnabled: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">Commission Unpaid Completions</Label>
                    <p className="text-xs text-muted-foreground">Pay-later shops: completed appointments earn commission even without POS checkout.</p>
                  </div>
                  <Switch
                    checked={settings.calculateOnUnpaid}
                    onCheckedChange={(v) => patchSettings({ calculateOnUnpaid: v })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">No-Show Fee Commission</Label>
                    <p className="text-xs text-muted-foreground">Commission collected no-show fees (opt-in). Cancellation fees are never commissioned.</p>
                  </div>
                  <Switch
                    checked={settings.includeNoShowFees}
                    onCheckedChange={(v) => patchSettings({ includeNoShowFees: v })}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-medium">Product Commission</Label>
                  <p className="text-xs text-muted-foreground">POS product line items only; custom items are never commissioned.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={settings.productCommissionEnabled}
                    onCheckedChange={(v) => patchSettings({ productCommissionEnabled: v })}
                  />
                  {settings.productCommissionEnabled && (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number" min={0} max={100} defaultValue={settings.productRatePercent}
                        onBlur={(e) => patchSettings({ productRatePercent: Number(e.target.value), productRateType: 'PERCENT' })}
                        className="w-20"
                      />
                      <span className="text-xs font-bold text-muted-foreground">% per product</span>
                    </div>
                  )}
                </div>

                <div>
                  <Label className="text-sm font-medium">Tip Treatment</Label>
                  <p className="text-xs text-muted-foreground">Tips are the barber&apos;s own unless configured otherwise.</p>
                </div>
                <Select value={settings.tipsMode} onValueChange={(v) => patchSettings({ tipsMode: v as Settings['tipsMode'] })}>
                  <SelectTrigger className="w-full max-w-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EXCLUDED">Excluded — tips are the barber&apos;s own</SelectItem>
                    <SelectItem value="PASS_THROUGH">Pass-through — full tip added to payout</SelectItem>
                    <SelectItem value="PERCENT">Percent — commission tips at a rate</SelectItem>
                  </SelectContent>
                </Select>
                {settings.tipsMode === 'PERCENT' && (
                  <div className="flex items-center gap-2 pt-2">
                    <Input
                      type="number" min={0} max={100} defaultValue={settings.tipsCommissionPercent}
                      onBlur={(e) => patchSettings({ tipsCommissionPercent: Number(e.target.value) })}
                      className="w-20"
                    />
                    <span className="text-xs font-bold text-muted-foreground">% of tips</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── Rules ── */}
          <Card>
            <CardHeader>
              <CardTitle>Rate Rules</CardTitle>
              <CardDescription>
                Priority: barber + service → barber only → service only → default. A barber&apos;s participation
                preference (opt-out) always reduces further; it can never override your settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 items-end">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Barber</Label>
                  <Select value={ruleBarber} onValueChange={setRuleBarber}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any barber</SelectItem>
                      {barbers.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Service</Label>
                  <Select value={ruleService} onValueChange={setRuleService}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any service</SelectItem>
                      {services.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Rate</Label>
                  <Select value={ruleType} onValueChange={(v) => setRuleType(v as 'PERCENT' | 'FIXED')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PERCENT">Percent</SelectItem>
                      <SelectItem value="FIXED">Flat</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">{ruleType === 'PERCENT' ? 'Percent' : 'Amount ($)'}</Label>
                  <Input
                    type="number" min={0} max={ruleType === 'PERCENT' ? 100 : undefined} step={ruleType === 'PERCENT' ? 1 : 0.01}
                    value={ruleType === 'PERCENT' ? rulePercent : ruleFixed}
                    onChange={(e) => (ruleType === 'PERCENT' ? setRulePercent : setRuleFixed)(e.target.value)}
                  />
                </div>
                <Button onClick={addRule} disabled={!ruleBarber || (ruleType === 'PERCENT' ? rulePercent === '' : ruleFixed === '')}>
                  Save Rule
                </Button>
              </div>

              {rules.length > 0 && (
                <div className="rounded-md border divide-y">
                  {rules.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{r.barber ? r.barber.name : 'Any barber'}</Badge>
                        <span className="text-muted-foreground">+</span>
                        <Badge variant="outline">{r.service ? r.service.name : 'Any service'}</Badge>
                        <span className="font-semibold">→ {rateLabel(r)}</span>
                      </div>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteRule(r.id)}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Report ── */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Commission Report</CardTitle>
                  <CardDescription>Per-barber summary over the selected period.</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={preset} onValueChange={(v) => setPreset(v as typeof preset)}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRESETS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={barberFilter} onValueChange={setBarberFilter}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All barbers</SelectItem>
                      {barbers.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
                  <Button variant="outline" size="sm" onClick={() => window.print()}>Print</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {report && report.barbers.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">Barber</th>
                        <th className="pb-2 pr-4 font-medium text-right">Services</th>
                        <th className="pb-2 pr-4 font-medium text-right">Products</th>
                        <th className="pb-2 pr-4 font-medium text-right">Tips</th>
                        <th className="pb-2 pr-4 font-medium">Rate</th>
                        <th className="pb-2 pr-4 font-medium text-right">Commission</th>
                        <th className="pb-2 pr-4 font-medium text-right">Adjustments</th>
                        <th className="pb-2 pr-4 font-medium text-right">Shop Share</th>
                        <th className="pb-2 pr-4 font-medium text-right">Est. Payout</th>
                        <th className="pb-2 font-medium text-right">Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.barbers.map((b) => (
                        <tr key={b.barberId} className="border-b last:border-0">
                          <td className="py-2.5 pr-4 font-medium">{b.name}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{money(b.serviceRevenue)}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{money(b.productRevenue)}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{money(b.tips)}</td>
                          <td className="py-2.5 pr-4 text-muted-foreground">{b.rateLabel}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums font-semibold">{money(b.commission)}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{money(b.adjustments)}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{money(b.shopShare)}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{money(b.payout)}</td>
                          <td className="py-2.5 text-right tabular-nums">{money(b.paidPayout)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 font-semibold">
                        <td className="py-2.5 pr-4">TOTAL</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums">{money(report.totals.serviceRevenue)}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums">{money(report.totals.productRevenue)}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums">{money(report.totals.tips)}</td>
                        <td />
                        <td className="py-2.5 pr-4 text-right tabular-nums">{money(report.totals.commission)}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums">{money(report.totals.adjustments)}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums">{money(report.totals.shopShare)}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums">{money(report.totals.payout)}</td>
                        <td className="py-2.5 text-right tabular-nums">{money(report.totals.paidPayout)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No commission entries in this period yet. Entries appear automatically as POS checkouts complete.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── Ledger ── */}
          <Card>
            <CardHeader>
              <CardTitle>Commission Ledger</CardTitle>
              <CardDescription>
                Immutable history: refunds adjust rows instead of rewriting them. Approve, adjust, mark paid or
                (correction only) delete — every action is audited.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {entries.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">Date</th>
                        <th className="pb-2 pr-4 font-medium">Barber</th>
                        <th className="pb-2 pr-4 font-medium">Source</th>
                        <th className="pb-2 pr-4 font-medium text-right">Base</th>
                        <th className="pb-2 pr-4 font-medium">Rate</th>
                        <th className="pb-2 pr-4 font-medium text-right">Commission</th>
                        <th className="pb-2 pr-4 font-medium text-right">Net</th>
                        <th className="pb-2 pr-4 font-medium">Status</th>
                        <th className="pb-2 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id} className="border-b last:border-0 align-middle">
                          <td className="py-2.5 pr-4 whitespace-nowrap text-muted-foreground">
                            {new Date(e.createdAt).toLocaleDateString()}
                          </td>
                          <td className="py-2.5 pr-4 font-medium">{e.barberName}</td>
                          <td className="py-2.5 pr-4">
                            <Badge variant="outline" className="text-xs">{e.source}</Badge>
                          </td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{money(e.grossAmount)}</td>
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {e.rateType === 'PERCENT' ? `${e.ratePercent ?? 0}%` : `$${(e.rateFixed ?? 0).toFixed(2)}`}
                          </td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{money(e.commissionAmount)}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums font-semibold">
                            {money(e.payout)}
                            {e.refundAdjustment < 0 && (
                              <span className="ml-1 text-xs text-muted-foreground">(refund)</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-4">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[e.status]}`}>
                              {e.status}
                            </span>
                          </td>
                          <td className="py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {(e.status === 'PENDING' || e.status === 'ADJUSTED') && (
                                <Button variant="ghost" size="sm" onClick={() => entryAction(e.id, 'approve')}>Approve</Button>
                              )}
                              <Button
                                variant="ghost" size="sm"
                                onClick={() => {
                                  const v = window.prompt('Adjustment amount (+/-, dollars):')
                                  if (v === null) return
                                  const amount = Number(v)
                                  if (!Number.isFinite(amount)) return void toast({ title: 'Invalid amount', variant: 'destructive' })
                                  void entryAction(e.id, 'adjust', amount, window.prompt('Reason (optional):') ?? undefined)
                                }}
                              >
                                Adjust
                              </Button>
                              {e.status !== 'PAID' && (
                                <Button
                                  variant="ghost" size="sm"
                                  onClick={() => {
                                    const v = window.prompt(`Mark paid — amount (defaults to ${money(e.payout)}):`, String(e.payout))
                                    if (v === null) return
                                    const amount = v === '' ? e.payout : Number(v)
                                    if (!Number.isFinite(amount) || amount < 0) return void toast({ title: 'Invalid amount', variant: 'destructive' })
                                    void entryAction(e.id, 'mark-paid', amount)
                                  }}
                                >
                                  Mark Paid
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteEntry(e.id)}>
                                Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No entries in this period.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

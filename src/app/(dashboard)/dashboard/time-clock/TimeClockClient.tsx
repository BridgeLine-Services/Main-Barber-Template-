'use client'

/**
 * Owner Time Clock dashboard client.
 *
 * The owner is the final authority: the shop-level switch (settings page)
 * gates everything. When OFF, no clock records are created and the live
 * board shows a quiet off-state; historical entries stay visible here
 * for payroll. Every action calls a server-authorized owner-only API —
 * hiding this UI is never the only defense.
 */
import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { Loader2, Download, Pencil } from 'lucide-react'

interface BoardRow {
  barberId: string
  barberName: string
  state: 'IN' | 'BREAK' | 'OUT'
  since: string | null
  todayHours: number
  eligible: boolean
}

interface ReportBarber {
  barberId: string
  barberName: string
  regularHours: number
  dailyOvertimeHours: number
  weeklyOvertimeHours: number
  overtimeHours: number
  totalHours: number
  openShift: boolean
  entryCount: number
}

interface EntryRow {
  id: string
  barberId: string
  barber: { name: string }
  clockInAt: string
  clockOutAt: string | null
  breakMinutes: number
  notes: string | null
  revisions: { id: string; field: string; reason: string }[]
}

interface EditState {
  id: string
  clockInAt: string
  clockOutAt: string
  breakMinutes: number
  notes: string
  reason: string
}

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'
const fmtHours = (n: number) => n.toFixed(2)

export function TimeClockClient({ enabled }: { enabled: boolean }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [board, setBoard] = useState<BoardRow[]>([])
  const [report, setReport] = useState<ReportBarber[]>([])
  const [totals, setTotals] = useState<Record<string, number>>({})
  const [entries, setEntries] = useState<EntryRow[]>([])
  const [barberFilter, setBarberFilter] = useState<string>('all')
  const [barbers, setBarbers] = useState<{ id: string; name: string }[]>([])
  const [preset, setPreset] = useState('payperiod')
  const [edit, setEdit] = useState<EditState | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams({ preset, ...(barberFilter !== 'all' && { barberId: barberFilter }) })
      const [boardRes, reportRes, entriesRes, barbersRes] = await Promise.all([
        enabled ? fetch(`/api/dashboard/time-clock/status`) : Promise.resolve(null),
        fetch(`/api/dashboard/time-clock/report?${q}`),
        fetch(`/api/dashboard/time-clock/entries?${q}`),
        fetch('/api/dashboard/barbers'),
      ])
      if (boardRes?.ok) setBoard((await boardRes.json()).board)
      if (reportRes.ok) {
        const data = await reportRes.json()
        setReport(data.barbers)
        setTotals(data.totals)
      }
      if (entriesRes.ok) setEntries((await entriesRes.json()).entries)
      if (barbersRes.ok) {
        const data = await barbersRes.json()
        setBarbers(Array.isArray(data) ? data.map((b: any) => ({ id: b.id, name: b.name })) : data.barbers ?? [])
      }
    } catch {
      toast({ title: 'Could not load time clock data', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [enabled, preset, barberFilter, toast])

  useEffect(() => {
    void load()
  }, [load])

  const openEdit = (e: EntryRow) => {
    // datetime-local needs a local, timezone-adjusted value
    const toLocal = (iso: string | null) => {
      if (!iso) return ''
      const d = new Date(iso)
      const off = d.getTimezoneOffset()
      return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16)
    }
    setEdit({
      id: e.id,
      clockInAt: toLocal(e.clockInAt),
      clockOutAt: toLocal(e.clockOutAt),
      breakMinutes: e.breakMinutes,
      notes: e.notes ?? '',
      reason: '',
    })
  }

  const saveEdit = async () => {
    if (!edit) return
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/dashboard/time-clock/entries/${edit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clockInAt: edit.clockInAt ? new Date(edit.clockInAt).toISOString() : undefined,
          clockOutAt: edit.clockOutAt ? new Date(edit.clockOutAt).toISOString() : null,
          breakMinutes: edit.breakMinutes,
          notes: edit.notes,
          reason: edit.reason,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Correction failed')
      }
      toast({ title: 'Entry corrected', description: 'Change recorded in the audit trail.' })
      setEdit(null)
      void load()
    } catch (err) {
      toast({
        title: 'Could not correct entry',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setSavingEdit(false)
    }
  }

  const exportUrl = () => {
    const q = new URLSearchParams({ preset, ...(barberFilter !== 'all' && { barberId: barberFilter }) })
    return `/api/dashboard/time-clock/export?${q}`
  }

  const stateBadge = (state: BoardRow['state']) => {
    if (state === 'IN') return <Badge className="bg-emerald-100 text-emerald-800">Clocked in</Badge>
    if (state === 'BREAK') return <Badge className="bg-amber-100 text-amber-800">On break</Badge>
    return <Badge variant="secondary">Clocked out</Badge>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Time Clock</h1>
          <p className="text-sm text-muted-foreground">
            Live board, hours &amp; overtime reports, and payroll-ready export.{' '}
            {!enabled && <span className="text-amber-700">Feature is currently OFF — records below are history only.</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href={exportUrl()}>
            <Button variant="outline" size="sm">
              <Download className="mr-1 h-4 w-4" /> Export CSV
            </Button>
          </a>
          <a href="/dashboard/time-clock/settings">
            <Button variant="outline" size="sm">Settings</Button>
          </a>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1">
            <Label className="text-xs">Period</Label>
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This week</SelectItem>
                <SelectItem value="payperiod">Pay period</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Barber</Label>
            <Select value={barberFilter} onValueChange={setBarberFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All barbers</SelectItem>
                {barbers.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Refresh
          </Button>
        </CardContent>
      </Card>

      {/* Live board */}
      {enabled && (
        <Card>
          <CardHeader>
            <CardTitle>Right now</CardTitle>
            <CardDescription>Who is clocked in, on break, or out — with today&apos;s hours.</CardDescription>
          </CardHeader>
          <CardContent>
            {board.length === 0 ? (
              <p className="text-sm text-muted-foreground">No barbers yet.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {board.map((b) => (
                  <div key={b.barberId} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="font-medium">{b.barberName}</p>
                      <p className="text-xs text-muted-foreground">
                        Since {fmtTime(b.since)} · today {fmtHours(b.todayHours)}h
                      </p>
                    </div>
                    {stateBadge(b.state)}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Hours & overtime */}
      <Card>
        <CardHeader>
          <CardTitle>Hours &amp; overtime</CardTitle>
          <CardDescription>Daily and weekly overtime use the shop&apos;s configured thresholds.</CardDescription>
        </CardHeader>
        <CardContent>
          {report.length === 0 ? (
            <p className="text-sm text-muted-foreground">No time entries in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2">Barber</th>
                    <th className="py-2">Regular</th>
                    <th className="py-2">OT (daily)</th>
                    <th className="py-2">OT (weekly)</th>
                    <th className="py-2">Total OT</th>
                    <th className="py-2">Total</th>
                    <th className="py-2">Shifts</th>
                  </tr>
                </thead>
                <tbody>
                  {report.map((r) => (
                    <tr key={r.barberId} className="border-b last:border-0">
                      <td className="py-2 font-medium">
                        {r.barberName}{' '}
                        {r.openShift && <Badge variant="outline" className="ml-1 text-xs">open shift</Badge>}
                      </td>
                      <td className="py-2">{fmtHours(r.regularHours)}</td>
                      <td className="py-2">{fmtHours(r.dailyOvertimeHours)}</td>
                      <td className="py-2">{fmtHours(r.weeklyOvertimeHours)}</td>
                      <td className="py-2">{fmtHours(r.overtimeHours)}</td>
                      <td className="py-2 font-semibold">{fmtHours(r.totalHours)}</td>
                      <td className="py-2">{r.entryCount}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold">
                    <td className="py-2">Totals</td>
                    <td className="py-2">{fmtHours(totals.regularHours ?? 0)}</td>
                    <td className="py-2">{fmtHours(totals.dailyOvertimeHours ?? 0)}</td>
                    <td className="py-2">{fmtHours(totals.weeklyOvertimeHours ?? 0)}</td>
                    <td className="py-2">{fmtHours(totals.overtimeHours ?? 0)}</td>
                    <td className="py-2">{fmtHours(totals.totalHours ?? 0)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Entries + corrections */}
      <Card>
        <CardHeader>
          <CardTitle>Time entries</CardTitle>
          <CardDescription>
            Corrections are recorded with original value, new value, who changed it, when, and the reason.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No time entries in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2">Barber</th>
                    <th className="py-2">Clock in</th>
                    <th className="py-2">Break (min)</th>
                    <th className="py-2">Clock out</th>
                    <th className="py-2">Corrected</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="py-2 font-medium">{e.barber.name}</td>
                      <td className="py-2">{fmtTime(e.clockInAt)}</td>
                      <td className="py-2">{e.breakMinutes}</td>
                      <td className="py-2">{e.clockOutAt ? fmtTime(e.clockOutAt) : <Badge variant="outline">open</Badge>}</td>
                      <td className="py-2">
                        {e.revisions?.length ? (
                          <Badge variant="secondary">{e.revisions.length} change{e.revisions.length > 1 ? 's' : ''}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(e)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Correct
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Correction dialog */}
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct time entry</DialogTitle>
            <DialogDescription>
              Every change is recorded (original → new, by whom, when, and your reason).
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Clock in</Label>
                  <Input
                    type="datetime-local"
                    value={edit.clockInAt}
                    onChange={(ev) => setEdit({ ...edit, clockInAt: ev.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Clock out</Label>
                  <Input
                    type="datetime-local"
                    value={edit.clockOutAt}
                    onChange={(ev) => setEdit({ ...edit, clockOutAt: ev.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Break minutes (unpaid)</Label>
                <Input
                  type="number"
                  min={0}
                  value={edit.breakMinutes}
                  onChange={(ev) => setEdit({ ...edit, breakMinutes: Number(ev.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Input value={edit.notes} onChange={(ev) => setEdit({ ...edit, notes: ev.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reason (required)</Label>
                <Input
                  value={edit.reason}
                  placeholder="e.g. forgot to clock out"
                  onChange={(ev) => setEdit({ ...edit, reason: ev.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button onClick={() => void saveEdit()} disabled={savingEdit || !edit?.reason.trim()}>
              {savingEdit && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

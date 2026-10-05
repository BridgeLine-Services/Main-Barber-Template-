'use client'

/**
 * Owner Time Clock settings client.
 *
 * The master switch is the owner's FINAL AUTHORITY: OFF hides time clock
 * UI everywhere and blocks new records server-side, but historical
 * entries are never deleted. Overtime thresholds are shop data (0 = rule
 * disabled) — nothing is hard-coded. A barber can never reach this page
 * or its APIs.
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
  dailyOvertimeThresholdHours: number
  weeklyOvertimeThresholdHours: number
  payPeriodType: 'WEEKLY' | 'BIWEEKLY'
}

interface BarberAccess {
  id: string
  name: string
  access: { eligible: boolean; canViewTeamRecords: boolean }
}

export function TimeClockSettingsClient() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [barbers, setBarbers] = useState<BarberAccess[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [settingsRes, accessRes] = await Promise.all([
        fetch('/api/dashboard/time-clock/settings'),
        fetch('/api/dashboard/time-clock/access'),
      ])
      if (settingsRes.ok) setSettings((await settingsRes.json()).settings)
      if (accessRes.ok) setBarbers((await accessRes.json()).barbers)
    } catch {
      toast({ title: 'Could not load settings', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const patchSettings = async (patch: Partial<Settings>) => {
    setSaving(true)
    try {
      const res = await fetch('/api/dashboard/time-clock/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error()
      setSettings((await res.json()).settings)
      toast({ title: 'Time clock settings saved' })
    } catch {
      toast({ title: 'Could not save settings', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const patchAccess = async (barberId: string, patch: { eligible?: boolean; canViewTeamRecords?: boolean }) => {
    try {
      const res = await fetch('/api/dashboard/time-clock/access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barberId, ...patch }),
      })
      if (!res.ok) throw new Error()
      setBarbers((prev) =>
        prev.map((b) =>
          b.id === barberId ? { ...b, access: { ...b.access, ...patch } } : b
        )
      )
      toast({ title: 'Barber access updated' })
    } catch {
      toast({ title: 'Could not update barber access', variant: 'destructive' })
    }
  }

  if (loading || !settings) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading time clock settings…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Time Clock Settings</h1>
        <p className="text-sm text-muted-foreground">
          Owner controls: master switch, overtime rules, pay period, and barber authorization.
        </p>
      </div>

      {/* Master switch */}
      <Card>
        <CardHeader>
          <CardTitle>Master switch</CardTitle>
          <CardDescription>
            OFF hides all time clock UI and stops new clock records — historical
            records always remain available, and scheduling is never affected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="font-medium">Time Clock</p>
              <p className="text-xs text-muted-foreground">Final authority: the owner.</p>
            </div>
            <div className="flex items-center gap-3">
              {settings.enabled ? (
                <Badge className="bg-emerald-100 text-emerald-800">ON</Badge>
              ) : (
                <Badge variant="secondary">OFF</Badge>
              )}
              <Switch
                checked={settings.enabled}
                disabled={saving}
                onCheckedChange={(checked) => void patchSettings({ enabled: checked })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Overtime rules */}
      <Card>
        <CardHeader>
          <CardTitle>Overtime rules</CardTitle>
          <CardDescription>
            Configurable thresholds — 0 disables that rule. These produce payroll-ready
            data only; the system never creates payroll payments.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Daily OT after (hours)</Label>
            <Input
              type="number"
              min={0}
              max={24}
              step={0.5}
              defaultValue={settings.dailyOvertimeThresholdHours}
              onBlur={(e) => {
                const v = Number(e.target.value)
                if (v !== settings.dailyOvertimeThresholdHours && v >= 0 && v <= 24)
                  void patchSettings({ dailyOvertimeThresholdHours: v })
              }}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Weekly OT after (hours)</Label>
            <Input
              type="number"
              min={0}
              max={168}
              step={0.5}
              defaultValue={settings.weeklyOvertimeThresholdHours}
              onBlur={(e) => {
                const v = Number(e.target.value)
                if (v !== settings.weeklyOvertimeThresholdHours && v >= 0 && v <= 168)
                  void patchSettings({ weeklyOvertimeThresholdHours: v })
              }}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Pay period</Label>
            <Select
              value={settings.payPeriodType}
              onValueChange={(v) => void patchSettings({ payPeriodType: v as 'WEEKLY' | 'BIWEEKLY' })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="WEEKLY">Weekly (Mon–Sun)</SelectItem>
                <SelectItem value="BIWEEKLY">Bi-weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Barber authorization */}
      <Card>
        <CardHeader>
          <CardTitle>Barber authorization</CardTitle>
          <CardDescription>
            Who may clock in/out, and who is explicitly authorized to view other
            barbers&apos; hours (off by default).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {barbers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No barbers yet.</p>
          ) : (
            <div className="divide-y">
              {barbers.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <p className="font-medium">{b.name}</p>
                  <div className="flex flex-wrap items-center gap-6">
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={b.access.eligible}
                        onCheckedChange={(checked) => void patchAccess(b.id, { eligible: checked })}
                      />
                      Can clock in/out
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={b.access.canViewTeamRecords}
                        onCheckedChange={(checked) => void patchAccess(b.id, { canViewTeamRecords: checked })}
                      />
                      Can view team records
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

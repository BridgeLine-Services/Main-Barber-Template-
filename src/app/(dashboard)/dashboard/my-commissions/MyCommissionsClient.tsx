'use client'

/**
 * Barber commission self-view: their own earnings summary, entries and
 * participation preference. Data comes from the /my endpoint which is
 * scoped to the session's barberId — a barber can never see another
 * barber's commissions regardless of what this UI does.
 */
import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'

interface Entry {
  id: string
  date: string
  serviceName: string
  appointmentRef: string | null
  source: string
  grossAmount: number
  rateLabel: string
  commissionAmount: number
  adjustment: number
  payout: number
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'ADJUSTED'
  paidAt: string | null
  notes: string | null
}

interface MyData {
  enabled: boolean
  participates: boolean
  from: string
  to: string
  summary: {
    revenue: number
    tips: number
    commission: number
    adjustments: number
    payout: number
    pendingPayout: number
    paidPayout: number
  }
  entries: Entry[]
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const STATUS_BADGE: Record<Entry['status'], string> = {
  PENDING: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  APPROVED: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  PAID: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  ADJUSTED: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
}

export function MyCommissionsClient({ available }: { available: boolean }) {
  const { toast } = useToast()
  const [preset, setPreset] = useState<'today' | 'week' | 'month'>('month')
  const [data, setData] = useState<MyData | null>(null)
  const [participates, setParticipates] = useState(true)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/commissions/my?preset=${preset}`)
      if (res.status === 403) {
        setData(null)
        return
      }
      if (!res.ok) throw new Error()
      const d: MyData = await res.json()
      setData(d)
      setParticipates(d.participates)
    } catch {
      toast({ title: 'Could not load commissions', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [preset, toast])

  useEffect(() => {
    if (available) void Promise.resolve().then(load)
  }, [available, load])

  const toggleParticipation = async (v: boolean) => {
    setParticipates(v)
    try {
      const res = await fetch('/api/dashboard/commissions/participation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participates: v }),
      })
      if (!res.ok) throw new Error()
      toast({ title: v ? 'You opted into commissions' : 'You opted out of commissions' })
    } catch {
      setParticipates(!v)
      toast({ title: 'Could not update participation', variant: 'destructive' })
    }
  }

  if (!available || data === null) {
    return (
      <div className="space-y-6 p-4 md:p-8 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold tracking-tight">My Commissions</h1>
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {available
              ? loading
                ? 'Loading…'
                : 'Your commissions are not available. The shop owner may have disabled commissions or the barber self-view.'
              : 'Your commissions are not available. The shop owner may have disabled commissions or the barber self-view.'}
          </CardContent>
        </Card>
      </div>
    )
  }

  const s = data.summary

  return (
    <div className="space-y-6 p-4 md:p-8 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Commissions</h1>
          <p className="text-sm text-muted-foreground">Your earnings from completed services, products and tips.</p>
        </div>
        <Select value={preset} onValueChange={(v) => setPreset(v as typeof preset)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">This week</SelectItem>
            <SelectItem value="month">This month</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Revenue</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{money(s.revenue)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tips</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{money(s.tips)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending payout</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{money(s.pendingPayout)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Paid out</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{money(s.paidPayout)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Participation</CardTitle>
          <CardDescription>
            Opting out stops new commission entries for you. The shop owner&apos;s settings always take precedence —
            commissions stay off for everyone if the owner disabled them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch checked={participates} onCheckedChange={toggleParticipation} aria-label="Participate in commissions" />
            <span className="text-sm">{participates ? 'Participating in commissions' : 'Opted out of commissions'}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Entries</CardTitle>
          <CardDescription>Refunds adjust your commission automatically; the original calculation stays visible.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No commissions in this period yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Date</th>
                    <th className="pb-2 pr-4 font-medium">Service</th>
                    <th className="pb-2 pr-4 font-medium">Base</th>
                    <th className="pb-2 pr-4 font-medium">Rate</th>
                    <th className="pb-2 pr-4 font-medium text-right">Commission</th>
                    <th className="pb-2 pr-4 font-medium text-right">Net</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="py-2.5 pr-4 whitespace-nowrap text-muted-foreground">{new Date(e.date).toLocaleDateString()}</td>
                      <td className="py-2.5 pr-4 font-medium">{e.serviceName}{e.appointmentRef && <span className="ml-1.5 text-xs text-muted-foreground">#{e.appointmentRef}</span>}</td>
                      <td className="py-2.5 pr-4 tabular-nums">{money(e.grossAmount)}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{e.rateLabel}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{money(e.commissionAmount)}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums font-semibold">
                        {money(e.payout)}
                        {e.adjustment !== 0 && <span className="ml-1 text-xs text-muted-foreground">({money(e.adjustment)})</span>}
                      </td>
                      <td className="py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[e.status]}`}>{e.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

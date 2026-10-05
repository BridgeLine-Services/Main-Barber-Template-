'use client'

/**
 * Barber self-service Time Clock client.
 *
 * Clock in / out, start / end break, and own hours for today and this
 * week. A barber cannot override an owner-disabled feature: when the
 * shop switch is OFF this page shows a quiet off-state and every punch
 * API rejects server-side. All actions use the session's barberId —
 * never a client-supplied value.
 */
import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { Loader2, Coffee, LogIn, LogOut, Timer } from 'lucide-react'

interface MyData {
  state: 'IN' | 'BREAK' | 'OUT'
  since: string | null
  summary: {
    preset: string
    from: string
    to: string
    totalHours: number
    regularHours: number
    overtimeHours: number
    openShift: boolean
  }[]
  entries: { id: string; clockInAt: string; clockOutAt: string | null; breakMinutes: number }[]
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'
const hours = (n: number) => n.toFixed(2)

export function MyTimeClockClient({ available }: { available: boolean }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(available)
  const [data, setData] = useState<MyData | null>(null)
  const [punching, setPunching] = useState(false)

  const load = useCallback(async () => {
    if (!available) return
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard/time-clock/my')
      if (!res.ok) throw new Error()
      setData(await res.json())
    } catch {
      toast({ title: 'Could not load your time clock', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [available, toast])

  useEffect(() => {
    void load()
  }, [load])

  const punch = async (kind: 'in' | 'out' | 'break') => {
    setPunching(true)
    try {
      const res =
        kind === 'break'
          ? await fetch('/api/dashboard/time-clock/break', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: data?.state === 'BREAK' ? 'end' : 'start' }),
            })
          : await fetch('/api/dashboard/time-clock/clock', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: kind }),
            })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Request failed')
      toast({ title: body.code === 'BREAK_ALREADY_ACTIVE' ? 'Already on break' : 'Done' })
      void load()
    } catch (err) {
      toast({
        title: 'Could not record that',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setPunching(false)
    }
  }

  if (!available) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Time Clock</CardTitle>
          <CardDescription>
            The shop&apos;s time clock is currently not available. Scheduling and your
            appointments are unaffected.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const state = data?.state ?? 'OUT'
  const today = data?.summary.find((s) => s.preset === 'today')
  const week = data?.summary.find((s) => s.preset === 'week')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Time Clock</h1>
        <p className="text-sm text-muted-foreground">Clock in and out, take breaks, and track your hours.</p>
      </div>

      {/* Punch card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {state === 'IN' && <Badge className="bg-emerald-100 text-emerald-800">Clocked in</Badge>}
              {state === 'BREAK' && <Badge className="bg-amber-100 text-amber-800">On break</Badge>}
              {state === 'OUT' && <Badge variant="secondary">Clocked out</Badge>}
              <span className="text-sm text-muted-foreground">Since {fmt(data?.since ?? null)}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {state === 'OUT' ? (
                <Button onClick={() => void punch('in')} disabled={punching || loading}>
                  {punching ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <LogIn className="mr-1 h-4 w-4" />}
                  Clock in
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => void punch('break')}
                    disabled={punching || loading}
                  >
                    {punching ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Coffee className="mr-1 h-4 w-4" />}
                    {state === 'BREAK' ? 'End break' : 'Start break'}
                  </Button>
                  <Button onClick={() => void punch('out')} disabled={punching || loading}>
                    {punching ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <LogOut className="mr-1 h-4 w-4" />}
                    Clock out
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Hours */}
      <div className="grid gap-4 sm:grid-cols-2">
        {[today, week].map((s, i) => (
          <Card key={i}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Timer className="h-4 w-4" /> {i === 0 ? 'Today' : 'This week'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {loading && !s ? (
                <p className="text-sm text-muted-foreground">…</p>
              ) : (
                <>
                  <p className="text-3xl font-bold">{hours(s?.totalHours ?? 0)}h</p>
                  <p className="text-xs text-muted-foreground">
                    {hours(s?.regularHours ?? 0)}h regular · {hours(s?.overtimeHours ?? 0)}h overtime
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent entries (own records only) */}
      <Card>
        <CardHeader>
          <CardTitle>My recent shifts</CardTitle>
          <CardDescription>You can view your own records; changes are owner-controlled.</CardDescription>
        </CardHeader>
        <CardContent>
          {!data?.entries.length ? (
            <p className="text-sm text-muted-foreground">No shifts this pay period yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2">Clock in</th>
                    <th className="py-2">Break (min)</th>
                    <th className="py-2">Clock out</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.slice(-10).reverse().map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="py-2">{fmt(e.clockInAt)}</td>
                      <td className="py-2">{e.breakMinutes}</td>
                      <td className="py-2">{e.clockOutAt ? fmt(e.clockOutAt) : <Badge variant="outline">open</Badge>}</td>
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

'use client'

/**
 * Barber self-view of payroll summaries — own periods only. The owner
 * controls availability (PayrollSettings.barberSelfView); when off, a
 * quiet "not available" state. Never shows other barbers' data or shop
 * totals: the /my endpoint scopes server-side to the session's barberId.
 * This is informational reporting — the shop still pays through its
 * actual payroll provider.
 */
import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { Loader2 } from 'lucide-react'

interface Summary {
  reportId: string
  status: string
  periodLabel: string
  serviceRevenue: number
  tips: number
  commission: number
  adjustments: number
  regularHours: number
  overtimeHours: number
  totalHours: number
  estimatedPayout: number
}

const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
const hours = (n: number) => n.toFixed(2)

export function MyPayrollClient({ available }: { available: boolean }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(available)
  const [summaries, setSummaries] = useState<Summary[]>([])

  useEffect(() => {
    if (!available) return
    ;(async () => {
      try {
        const res = await fetch('/api/dashboard/payroll/my')
        if (res.ok) {
          const data = await res.json()
          setSummaries(data.summaries ?? [])
        } else if (res.status !== 403) {
          toast({ title: 'Could not load payroll summaries', variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Could not load payroll summaries', variant: 'destructive' })
      } finally {
        setLoading(false)
      }
    })()
  }, [available, toast])

  if (!available) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">My Payroll</h1>
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Payroll summaries are not available right now. Ask your shop owner
              if you have questions about a pay period.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Payroll</h1>
        <p className="text-sm text-muted-foreground">
          Your own payroll-ready summaries per pay period — hours, tips,
          commissions, and estimated payout. Questions? Ask your shop owner;
          they finalize every period.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : summaries.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No payroll summaries yet — reports appear once your owner
              generates them.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {summaries.map((s) => (
            <Card key={s.reportId}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle>{s.periodLabel}</CardTitle>
                    <CardDescription>
                      {hours(s.regularHours)} regular hrs · {hours(s.overtimeHours)} overtime
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">{s.status.toLowerCase()}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Services</dt>
                    <dd className="font-medium">{money(s.serviceRevenue)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Tips</dt>
                    <dd className="font-medium">{money(s.tips)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Commission</dt>
                    <dd className="font-medium">{money(s.commission)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Adjustments</dt>
                    <dd className="font-medium">{money(s.adjustments)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Est. payout</dt>
                    <dd className="font-medium">{money(s.estimatedPayout)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

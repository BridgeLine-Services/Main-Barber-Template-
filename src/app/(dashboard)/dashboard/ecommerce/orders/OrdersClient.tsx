'use client'

/**
 * Shop orders client. Reads GET /api/dashboard/ecommerce/orders (list + stats,
 * status filter) and mutates via PATCH /api/dashboard/ecommerce/orders/[id]:
 *   { action: 'fulfill', next: 'PROCESSING'|'SHIPPED'|'DELIVERED', trackingNumber? }
 *   { action: 'cancel', restock: boolean }
 *   { action: 'refund' }
 * The server enforces the fulfillment state machine and tenant scope; this
 * UI only offers transitions the current status allows.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { Loader2, PackageCheck, RefreshCw, XCircle, Undo2 } from 'lucide-react'

type OrderStatus =
  | 'PENDING' | 'PAID' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED'
  | 'CANCELED' | 'PAYMENT_FAILED' | 'REFUNDED'

interface OrderItemRow {
  id: string
  productId: string
  nameSnapshot: string
  quantity: number
  priceSnapshot: number
}

interface OrderRow {
  id: string
  orderNumber: string
  email: string
  shippingAddress: unknown
  subtotal: number
  total: number
  currency: string
  status: OrderStatus
  trackingNumber: string | null
  createdAt: string
  items: OrderItemRow[]
}

interface StatRow {
  status: OrderStatus
  count: number
  revenue: number
}

const STATUS_FILTERS: (OrderStatus | 'ALL')[] = [
  'ALL', 'PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELED', 'REFUNDED',
]

const NEXT_STATUSES: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PAID: ['PROCESSING', 'SHIPPED', 'DELIVERED'],
  PROCESSING: ['SHIPPED', 'DELIVERED'],
  SHIPPED: ['DELIVERED'],
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatPrice(n: number, currency: string) {
  const symbol = currency === 'USD' || currency === '' ? '$' : `${currency} `
  return `${symbol}${n.toFixed(2)}`
}

const STATUS_BADGE_VARIANT: Partial<Record<OrderStatus, 'default' | 'outline' | 'destructive'>> = {
  PAID: 'default',
  PENDING: 'outline',
  PROCESSING: 'outline',
  SHIPPED: 'outline',
  DELIVERED: 'default',
  CANCELED: 'destructive',
  PAYMENT_FAILED: 'destructive',
  REFUNDED: 'destructive',
}

export function OrdersClient() {
  const { toast } = useToast()
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [stats, setStats] = useState<StatRow[]>([])
  const [filter, setFilter] = useState<OrderStatus | 'ALL'>('ALL')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tracking, setTracking] = useState<Record<string, string>>({})

  const load = useCallback(async (status: OrderStatus | 'ALL') => {
    setLoading(true)
    try {
      const res = await fetch(`/api/dashboard/ecommerce/orders${status !== 'ALL' ? `?status=${status}` : ''}`)
      if (res.ok) {
        const data = (await res.json()) as { orders: OrderRow[]; stats: StatRow[] }
        setOrders(data.orders)
        setStats(data.stats)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Deferred one microtask so the first render never cascades setState
    // synchronously inside the effect.
    void Promise.resolve().then(() => load(filter))
  }, [filter, load])

  const act = async (order: OrderRow, body: Record<string, unknown>, successTitle: string) => {
    setBusyId(order.id)
    try {
      const res = await fetch(`/api/dashboard/ecommerce/orders/${encodeURIComponent(order.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast({ title: data.error ?? 'Action failed', variant: 'destructive' })
        return
      }
      toast({ title: successTitle })
      void load(filter)
    } finally {
      setBusyId(null)
    }
  }

  const revenue = stats.reduce((sum, s) => (s.status === 'PAID' || s.status === 'DELIVERED' || s.status === 'SHIPPED' || s.status === 'PROCESSING' ? sum + s.revenue : sum), 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Shop Orders</h1>
          <p className="text-sm text-muted-foreground">
            Fulfill, track and refund online orders.
          </p>
        </div>
        <Button variant="outline" size="icon" aria-label="Refresh orders" onClick={() => void load(filter)}>
          <RefreshCw className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Collected revenue</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-semibold">{formatPrice(revenue, 'USD')}</p></CardContent>
        </Card>
        {(['PAID', 'PROCESSING', 'SHIPPED'] as OrderStatus[]).map((st) => (
          <Card key={st}>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{st}</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{stats.find((s) => s.status === st)?.count ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((st) => (
          <Button
            key={st}
            variant={filter === st ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(st)}
          >
            {st === 'ALL' ? 'All' : st}
            {st !== 'ALL' && (stats.find((s) => s.status === st)?.count ?? 0) > 0 && (
              <span className="ml-1.5 text-xs opacity-70">{stats.find((s) => s.status === st)?.count}</span>
            )}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Loading orders…
        </div>
      ) : orders.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No orders in this view yet.</p>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const nexts = NEXT_STATUSES[o.status] ?? []
            const canCancel = o.status === 'PENDING' || o.status === 'PAID'
            const canRefund = o.status === 'PAID' || o.status === 'PROCESSING'
            return (
              <Card key={o.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {o.orderNumber}
                        <span className="ml-2 text-sm font-normal text-muted-foreground">{formatDate(o.createdAt)}</span>
                      </p>
                      <p className="text-sm text-muted-foreground">{o.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_BADGE_VARIANT[o.status] ?? 'outline'}>{o.status}</Badge>
                      <p className="font-semibold">{formatPrice(o.total, o.currency)}</p>
                    </div>
                  </div>

                  <div className="text-sm space-y-1">
                    {o.items.map((it) => (
                      <div key={it.id} className="flex justify-between text-muted-foreground">
                        <span>{it.nameSnapshot} × {it.quantity}</span>
                        <span>{formatPrice(it.priceSnapshot * it.quantity, o.currency)}</span>
                      </div>
                    ))}
                    {o.trackingNumber && (
                      <p className="text-xs">Tracking: {o.trackingNumber}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {nexts.map((next) => (
                      <Button
                        key={next}
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={busyId === o.id}
                        onClick={() => void act(o, { action: 'fulfill', next }, `Order moved to ${next}`)}
                      >
                        <PackageCheck className="h-3.5 w-3.5" aria-hidden /> {next === 'SHIPPED' ? 'Mark shipped' : next === 'DELIVERED' ? 'Mark delivered' : 'Start preparing'}
                      </Button>
                    ))}
                    {nexts.includes('SHIPPED') && (
                      <div className="flex items-center gap-1">
                        <Input
                          placeholder="Tracking #"
                          className="h-8 w-32 text-xs"
                          value={tracking[o.id] ?? ''}
                          onChange={(e) => setTracking((t) => ({ ...t, [o.id]: e.target.value }))}
                          aria-label={`Tracking number for ${o.orderNumber}`}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === o.id || !(tracking[o.id] ?? '').trim()}
                          onClick={() => void act(o, { action: 'fulfill', next: 'SHIPPED', trackingNumber: tracking[o.id]?.trim() }, 'Marked shipped with tracking')}
                        >
                          Ship w/ tracking
                        </Button>
                      </div>
                    )}
                    {canCancel && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive gap-1.5"
                        disabled={busyId === o.id}
                        onClick={() => void act(o, { action: 'cancel', restock: true }, 'Order canceled and stock restored')}
                      >
                        <XCircle className="h-3.5 w-3.5" aria-hidden /> Cancel + restock
                      </Button>
                    )}
                    {canRefund && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive gap-1.5"
                        disabled={busyId === o.id}
                        onClick={() => void act(o, { action: 'refund' }, 'Refund issued through the payment provider')}
                      >
                        <Undo2 className="h-3.5 w-3.5" aria-hidden /> Refund
                      </Button>
                    )}
                    {busyId === o.id && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

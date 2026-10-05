'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ScrollText, Search, Wallet } from 'lucide-react'
import type { GiftCard, GiftCardTransaction } from '@prisma/client'

interface Summary {
  soldCount: number
  soldAmount: number
  redeemedCount: number
  redeemedAmount: number
  refundAmount: number
  outstandingLiability: number
  activeCount: number
  pendingCount: number
  depletedCount: number
  expiredCount: number
}

interface CardRow {
  id: string
  code: string
  type: string
  initialValue: number
  remainingBalance: number
  status: string
  purchaserName: string
  recipientName: string | null
  expiresAt: string | null
  createdAt: string
  transactionCount: number
}

const money = (n: number) => `$${(n ?? 0).toFixed(2)}`

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  PENDING: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  DEPLETED: 'bg-zinc-500/15 text-zinc-500 dark:text-zinc-400',
}

export function GiftCardsClient({ enabled }: { enabled: boolean }) {
  const [settings, setSettings] = useState({ enabled, defaultValidityMonths: 12 })
  const [summary, setSummary] = useState<Summary | null>(null)
  const [cards, setCards] = useState<CardRow[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'ACTIVE' | 'DEPLETED'>('ALL')
  const [sellOpen, setSellOpen] = useState(false)
  const [detail, setDetail] = useState<{ giftCard: GiftCard; transactions: GiftCardTransaction[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // sell form
  const [form, setForm] = useState({
    amount: 50, type: 'DIGITAL', purchaserName: '', purchaserEmail: '',
    recipientName: '', recipientEmail: '', message: '', method: 'IN_PERSON',
  })
  const [adjust, setAdjust] = useState({ amount: '', note: '' })

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      if (search.trim()) params.set('search', search.trim())
      const res = await fetch(`/api/dashboard/gift-cards?${params}`)
      if (res.ok) {
        const data = await res.json()
        setCards(data.cards ?? [])
        setSummary(data.summary ?? null)
        setSettings((s) => ({ ...s, enabled: data.enabled }))
      }
    } catch {
      setErr('Could not load gift cards')
    }
  }, [statusFilter, search])

  useEffect(() => { void load() }, [load])

  const patchSettings = async (data: Record<string, unknown>) => {
    setErr(null); setMsg(null)
    const res = await fetch('/api/dashboard/gift-cards/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(json.error ?? 'Update failed'); return }
    setSettings({ enabled: json.enabled, defaultValidityMonths: json.defaultValidityMonths })
    setMsg(json.enabled ? 'Gift cards enabled' : 'Gift cards disabled — existing cards and history are preserved')
    void load()
  }

  const sell = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null); setMsg(null)
    const res = await fetch('/api/dashboard/gift-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, amount: Number(form.amount) }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(json.error ?? 'Sale failed'); return }
    setMsg(`Sold ${json.giftCard.code} for ${money(json.giftCard.initialValue)}`)
    setSellOpen(false)
    setForm({ ...form, purchaserName: '', purchaserEmail: '', recipientName: '', recipientEmail: '', message: '' })
    void load()
  }

  const openDetail = async (id: string) => {
    setErr(null)
    const res = await fetch(`/api/dashboard/gift-cards/${id}`)
    if (res.ok) setDetail(await res.json())
  }

  const applyAdjustment = async () => {
    if (!detail) return
    setErr(null); setMsg(null)
    const res = await fetch(`/api/dashboard/gift-cards/${detail.giftCard.id}/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Number(adjust.amount), note: adjust.note }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(json.error ?? 'Adjustment failed'); return }
    setAdjust({ amount: '', note: '' })
    await openDetail(detail.giftCard.id)
    setMsg('Adjustment applied')
    void load()
  }

  const Stat: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  )

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Wallet className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Gift Cards</h1>
            <p className="text-sm text-muted-foreground">
              Sell, track, and redeem shop gift cards. Owner controlled.
            </p>
          </div>
        </div>
        <Button onClick={() => setSellOpen(true)} disabled={!settings.enabled}>
          <ScrollText className="mr-2 h-4 w-4" /> Sell gift card
        </Button>
      </div>

      {msg ? <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">{msg}</p> : null}
      {err ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{err}</p> : null}

      {/* Owner control */}
      <div className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Label htmlFor="gift-cards-enabled" className="text-base">Gift Cards</Label>
            <p className="text-sm text-muted-foreground">
              OFF hides purchases and redemptions but never deletes history.
            </p>
          </div>
          <Switch
            id="gift-cards-enabled"
            checked={settings.enabled}
            disabled={busy}
            onCheckedChange={async (v) => { setBusy(true); await patchSettings({ enabled: v }); setBusy(false) }}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="validity" className="text-xs text-muted-foreground">Validity (months, 0 = none)</Label>
            <Input
              id="validity" type="number" min={0} max={120} className="mt-1 w-40"
              defaultValue={settings.defaultValidityMonths}
              onBlur={(e) => {
                const v = Number(e.target.value)
                if (v !== settings.defaultValidityMonths) patchSettings({ defaultValidityMonths: v })
              }}
            />
          </div>
        </div>
      </div>

      {/* Reporting summary */}
      {summary ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Sold" value={money(summary.soldAmount)} sub={`${summary.soldCount} cards`} />
          <Stat label="Redeemed" value={money(summary.redeemedAmount)} sub={`${summary.redeemedCount} redemptions`} />
          <Stat label="Outstanding liability" value={money(summary.outstandingLiability)} sub={`${summary.activeCount} active cards`} />
          <Stat label="Pending / depleted / expired" value={`${summary.pendingCount} / ${summary.depletedCount} / ${summary.expiredCount}`} />
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="w-64 pl-8" placeholder="Search code or name"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {(['ALL', 'ACTIVE', 'PENDING', 'DEPLETED'] as const).map((s) => (
          <Button key={s} variant={statusFilter === s ? 'default' : 'outline'} size="sm" onClick={() => setStatusFilter(s)}>
            {s}
          </Button>
        ))}
      </div>

      {/* Cards table */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="p-3">Code</th><th className="p-3">Purchaser</th><th className="p-3">Balance</th>
              <th className="p-3">Status</th><th className="p-3">Expires</th><th className="p-3">Txns</th>
            </tr>
          </thead>
          <tbody>
            {cards.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">
                {settings.enabled ? 'No gift cards yet.' : 'Gift cards are disabled for this shop.'}
              </td></tr>
            ) : cards.map((c) => (
              <tr
                key={c.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/50"
                onClick={() => openDetail(c.id)}
              >
                <td className="p-3 font-mono font-medium">{c.code}</td>
                <td className="p-3">{c.purchaserName}{c.recipientName ? ` → ${c.recipientName}` : ''}</td>
                <td className="p-3">{money(c.remainingBalance)} <span className="text-muted-foreground">of {money(c.initialValue)}</span></td>
                <td className="p-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status] ?? ''}`}>{c.status}</span>
                </td>
                <td className="p-3 text-muted-foreground">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '—'}</td>
                <td className="p-3 text-muted-foreground">{c.transactionCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sell dialog */}
      <Dialog open={sellOpen} onOpenChange={setSellOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>Sell gift card</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={sell}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="amount">Amount ($)</Label>
                <Input id="amount" type="number" min={1} max={5000} required
                  value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
              </div>
              <div>
                <Label htmlFor="type">Type</Label>
                <select id="type" className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="DIGITAL">Digital</option><option value="PHYSICAL">Physical</option>
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="method">Tender</Label>
              <select id="method" className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                <option value="IN_PERSON">Card (terminal)</option><option value="CASH">Cash</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pname">Purchaser name</Label>
                <Input id="pname" required value={form.purchaserName}
                  onChange={(e) => setForm({ ...form, purchaserName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="pemail">Purchaser email</Label>
                <Input id="pemail" type="email" value={form.purchaserEmail}
                  onChange={(e) => setForm({ ...form, purchaserEmail: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="rname">Recipient name</Label>
                <Input id="rname" value={form.recipientName}
                  onChange={(e) => setForm({ ...form, recipientName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="remail">Recipient email</Label>
                <Input id="remail" type="email" value={form.recipientEmail}
                  onChange={(e) => setForm({ ...form, recipientEmail: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="msg">Message</Label>
              <Input id="msg" value={form.message} placeholder="Happy birthday!"
                onChange={(e) => setForm({ ...form, message: e.target.value })} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>Complete sale</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono">{detail.giftCard.code}</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <p>Status: <span className="font-medium">{detail.giftCard.status}</span></p>
                <p>Type: <span className="font-medium">{detail.giftCard.type}</span></p>
                <p>Initial: <span className="font-medium">{money(detail.giftCard.initialValue)}</span></p>
                <p>Remaining: <span className="font-medium">{money(detail.giftCard.remainingBalance)}</span></p>
                <p>Purchaser: <span className="font-medium">{detail.giftCard.purchaserName}</span></p>
                <p>Recipient: <span className="font-medium">{detail.giftCard.recipientName ?? '—'}</span></p>
                <p>Created: <span className="font-medium">{new Date(detail.giftCard.createdAt).toLocaleDateString()}</span></p>
                <p>Expires: <span className="font-medium">{detail.giftCard.expiresAt ? new Date(detail.giftCard.expiresAt).toLocaleDateString() : '—'}</span></p>
              </div>
              {detail.giftCard.message ? (
                <p className="rounded-md bg-muted p-3 text-sm italic">&ldquo;{detail.giftCard.message}&rdquo;</p>
              ) : null}

              <div className="rounded-md border">
                <p className="border-b p-2 text-xs font-semibold uppercase text-muted-foreground">Transaction history</p>
                <ul className="divide-y">
                  {detail.transactions.map((t) => (
                    <li key={t.id} className="flex items-center justify-between p-2 text-sm">
                      <div>
                        <p className="font-medium">{t.type}{t.note ? ` — ${t.note}` : ''}</p>
                        <p className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</p>
                      </div>
                      <p className="text-right">
                        <span className="font-medium">{money(t.amount)}</span>
                        <span className="block text-xs text-muted-foreground">bal {money(t.balanceAfter)}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2 rounded-md border p-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Owner adjustment (audited)</p>
                <div className="flex gap-2">
                  <Input type="number" step="0.01" placeholder="+10 or -5"
                    value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })} />
                  <Input placeholder="Reason" value={adjust.note}
                    onChange={(e) => setAdjust({ ...adjust, note: e.target.value })} />
                  <Button variant="outline" onClick={applyAdjustment}>Apply</Button>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

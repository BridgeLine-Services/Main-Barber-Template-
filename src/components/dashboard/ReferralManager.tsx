'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { Copy, Search, Users } from 'lucide-react'

interface Customer { id: string; firstName: string; lastName: string; email: string | null; phone: string | null }
interface ReferralReport {
  enabled: boolean
  metrics: {
    referredCustomers: number
    converted: number
    completedBookings: number
    conversionRate: number | null
    repeatBookings: number
    referralRevenueCents: number | null
    shareOfRevenuePercent: number | null
    byChannel: Array<{ channel: string; customers: number }>
    byCampaign: Array<{ campaign: string; customers: number }>
    note: string
  }
}
interface SearchResults { customers: Customer[] }

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not load referral data.')
  return data
}

function money(cents: number | null) {
  return cents === null ? 'Unknown' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100)
}

export function ReferralManager({ canManage }: { canManage: boolean }) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selection, setSelection] = useState<Customer | null>(null)
  const [issued, setIssued] = useState<{ code: string; link: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const { data: report, error: reportError, mutate: mutateReport } = useSWR<ReferralReport>('/api/dashboard/referrals', fetchJson)
  const searchKey = debouncedQuery.length >= 2 ? `/api/dashboard/referrals/customers?q=${encodeURIComponent(debouncedQuery)}` : null
  const { data: searchResults, error: searchError } = useSWR<SearchResults>(searchKey, fetchJson)
  const customers = searchResults?.customers ?? []

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const setEnabled = async (enabled: boolean) => {
    if (!enabled && !window.confirm('Turn off the referral program? Existing codes, activity and attribution history will be kept.')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/dashboard/referrals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not update the program.')
      await mutateReport((current) => current ? { ...current, enabled: data.enabled } : current, false)
      setNotice(data.enabled ? 'Referral program is on.' : 'Referral program is off. Existing records were kept.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update the program.') }
    finally { setBusy(false) }
  }

  const createCode = async () => {
    if (!selection) return
    setBusy(true); setError(''); setNotice(''); setIssued(null)
    try {
      const response = await fetch('/api/dashboard/referrals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: selection.id }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not create a referral link.')
      setIssued({ code: data.code, link: data.link })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create a referral link.') }
    finally { setBusy(false) }
  }

  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setNotice(`${label} copied.`) }
    catch { setError('Clipboard access is unavailable. Select and copy the link manually.') }
  }

  const errorMessage = error || reportError?.message || searchError?.message
  if (!report && !reportError) return <p className="p-6 text-sm text-muted-foreground">Loading referral report…</p>
  const metrics = report?.metrics
  const tiles = [
    ['Customers attributed', metrics?.referredCustomers ?? '—', 'People successfully matched to a first-visit referral.'],
    ['Customers converted', metrics?.converted ?? '—', 'Referred customers with at least one completed booking.'],
    ['Completed bookings', metrics?.completedBookings ?? '—', 'Total completed bookings from attributed customers.'],
    ['Conversion', metrics?.conversionRate === null || metrics?.conversionRate === undefined ? 'Unknown' : `${metrics.conversionRate}%`, 'Share of attributed customers who completed a booking.'],
    ['Repeat bookings', metrics?.repeatBookings ?? '—', 'Completed bookings after a referred customer’s first completed visit.'],
    ['Revenue after refunds', money(metrics?.referralRevenueCents ?? null), 'Recorded payment revenue, less recorded refunds. Not profit.'],
  ]

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-7 p-4 sm:p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-sm font-medium text-primary">Business Growth</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Referral program</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">See who came through referrals, which of them completed bookings, and what recorded payments remain after refunds.</p></div>
        {canManage && <label className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium">
          <input aria-label="Referral program enabled" type="checkbox" checked={report?.enabled ?? false} disabled={busy || !report} onChange={(event) => setEnabled(event.target.checked)} className="size-4 accent-primary" />
          Program {report?.enabled ? 'on' : 'off'}
        </label>}
      </header>

      {errorMessage && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{errorMessage}</p>}
      {notice && <p role="status" className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">{notice}</p>}

      <section aria-label="Referral metrics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(([label, value, detail]) => <article key={label} className="rounded-xl border border-border bg-card p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p></article>)}
      </section>
      <p className="text-sm text-muted-foreground">{metrics ? `${metrics.referredCustomers} customers came through referrals. ${metrics.converted} have completed a booking.` : 'Referral counts are unavailable right now.'} Clicks are not counted as customers until attribution succeeds; attribution alone does not mean a booking was completed.</p>
      <p className="text-xs text-muted-foreground">{metrics?.note} Money shown is recorded payment revenue after refunds, not profit. A missing or unverified payment total is shown as unknown.</p>

      <section className={canManage ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]' : 'grid gap-6'}>
        {canManage && <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">Create a customer link</h2><p className="mt-1 text-sm text-muted-foreground">Search within this shop, choose a customer, and create their shareable code.</p>
          <label htmlFor="referral-customer-search" className="mt-4 block text-sm font-medium">Find customer</label>
          <div className="relative mt-2"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input id="referral-customer-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email, or phone" className="w-full rounded-lg border border-input bg-background py-2.5 pl-10 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" autoComplete="off" /></div>
          {query.trim().length < 2 ? <p className="mt-3 text-sm text-muted-foreground">Enter at least two characters to search.</p> : searchError ? <p role="alert" className="mt-3 text-sm text-destructive">Customer search is unavailable.</p> : customers.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No customers found in this shop.</p> : <ul className="mt-2 max-h-56 overflow-auto rounded-lg border border-border" aria-label="Customer search results">{customers.map((customer) => <li key={customer.id}><button type="button" onClick={() => { setSelection(customer); setIssued(null) }} className={`flex w-full items-center gap-3 px-3 py-3 text-left text-sm hover:bg-muted ${selection?.id === customer.id ? 'bg-primary/10' : ''}`}><Users aria-hidden="true" className="size-4 text-muted-foreground" /><span className="min-w-0"><span className="block truncate font-medium">{customer.firstName} {customer.lastName}</span><span className="block truncate text-xs text-muted-foreground">{customer.email || customer.phone || 'No contact detail'}</span></span></button></li>)}</ul>}
          {selection && <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm">Selected: <strong>{selection.firstName} {selection.lastName}</strong></p><button type="button" disabled={busy} onClick={createCode} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? 'Creating…' : 'Create share link'}</button></div>}
          {issued && <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4"><p className="text-sm font-semibold">Code: {issued.code}</p><p className="mt-2 break-all text-xs text-muted-foreground">{issued.link}</p><button type="button" onClick={() => copy(issued.link, 'Referral link')} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><Copy aria-hidden="true" className="size-4" />Copy link</button></div>}
        </div>}
        <div className="rounded-xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Where referrals came from</h2><p className="mt-1 text-sm text-muted-foreground">Counts reflect attributed customers, not link clicks.</p>{metrics?.byChannel.length ? <ul className="mt-4 flex flex-col gap-3">{metrics.byChannel.map((channel) => <li key={channel.channel} className="flex justify-between gap-4 border-b border-border pb-3 text-sm"><span>{channel.channel}</span><span className="font-semibold tabular-nums">{channel.customers}</span></li>)}</ul> : <p className="mt-4 text-sm text-muted-foreground">No referral sources recorded yet.</p>}{metrics?.byCampaign.length ? <div className="mt-5"><h3 className="text-sm font-semibold">Campaigns</h3><ul className="mt-3 flex flex-col gap-3">{metrics.byCampaign.map((campaign) => <li key={campaign.campaign} className="flex justify-between gap-4 border-b border-border pb-3 text-sm"><span className="break-all">{campaign.campaign}</span><span className="font-semibold tabular-nums">{campaign.customers}</span></li>)}</ul></div> : null}{metrics?.shareOfRevenuePercent !== null && metrics?.shareOfRevenuePercent !== undefined && <p className="mt-4 text-xs text-muted-foreground">Recorded referral revenue is {metrics.shareOfRevenuePercent}% of recorded shop revenue.</p>}</div>
      </section>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { describePriceChange, money, statusWords, type PriceRequestRow } from '@/lib/organization/pricing-approvals'

interface TemplateOption {
  id: string
  name: string
  priceCents: number
  priceLabel: string
  active: boolean
}

interface LocationOption {
  businessId: string
  name: string
  status: string
}

interface Payload {
  requests: PriceRequestRow[]
  summary: { headline: string; pending: number; oldestPendingDays: number | null }
  canDecide: boolean
  templates: TemplateOption[]
  locations: LocationOption[]
}

/**
 * Asking for a price, and deciding on one.
 *
 * Every action is two clicks: the first explains what will happen, the second does it. The
 * server re-checks the capability and the scope on each call, so this screen's buttons are
 * convenience, not permission.
 */
export function PricingRequests() {
  const router = useRouter()
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const [templateId, setTemplateId] = useState('')
  const [businessId, setBusinessId] = useState('')
  const [price, setPrice] = useState('')
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard/organization/pricing-requests')
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(typeof body.error === 'string' ? body.error : 'The requests could not be read just now.')
        return
      }
      setData(body as Payload)
      setError(null)
    } catch {
      setError('The connection dropped. Nothing was changed.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function decide(id: string, decision: 'approve' | 'decline' | 'revoke') {
    setBusy(id + decision)
    setError(null)
    try {
      const response = await fetch('/api/dashboard/organization/pricing-requests/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(typeof body.error === 'string' ? body.error : 'That decision could not be saved.')
        return
      }
      setNotice(
        decision === 'approve'
          ? 'Approved. That location now charges the approved price.'
          : decision === 'decline'
            ? 'Declined. The location keeps the standard price.'
            : 'Revoked. The location is back on the standard price.',
      )
      setConfirming(null)
      await load()
      router.refresh()
    } catch {
      setError('The connection dropped. Nothing was changed.')
    } finally {
      setBusy(null)
    }
  }

  async function ask(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    const cents = Math.round(Number(price) * 100)
    if (!templateId || !businessId) {
      setError('Choose the service and the location first.')
      return
    }
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter the price you want to charge, like 22.50.')
      return
    }
    setBusy('ask')
    try {
      const response = await fetch('/api/dashboard/organization/pricing-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, businessId, priceCents: cents, reason }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(typeof body.error === 'string' ? body.error : 'The request could not be sent.')
        return
      }
      setNotice('Sent. Nothing changes until somebody approves it.')
      setPrice('')
      setReason('')
      await load()
    } catch {
      setError('The connection dropped. Nothing was sent.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div role="status" aria-live="polite" className="text-sm">
        {notice && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-foreground">{notice}</p>}
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-foreground">
          {error}
        </p>
      )}

      <section aria-labelledby="ask" className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 sm:p-5">
        <h2 id="ask" className="text-sm font-semibold text-foreground">
          Ask for a different price
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          For a location you are assigned to. Somebody at head office decides, and the reason you write is kept.
        </p>
        <form className="mt-3 space-y-3" onSubmit={ask}>
          <div>
            <Label htmlFor="ask-template">Service</Label>
            <select
              id="ask-template"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 text-base"
            >
              <option value="">Choose a service</option>
              {(data?.templates ?? []).map((template) => (
                <option key={template.id} value={template.id} disabled={!template.active}>
                  {template.name} ({template.priceLabel}{template.active ? '' : ', switched off'})
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="ask-location">Location</Label>
            <select
              id="ask-location"
              value={businessId}
              onChange={(event) => setBusinessId(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 text-base"
            >
              <option value="">Choose a location</option>
              {(data?.locations ?? []).map((location) => (
                <option key={location.businessId} value={location.businessId} disabled={location.status === 'closed'}>
                  {location.name}{location.status === 'closed' ? ' (closed)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="ask-price">Price you want to charge</Label>
            <Input
              id="ask-price"
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="22.50"
              className="mt-1 min-h-11 text-base"
            />
          </div>
          <div>
            <Label htmlFor="ask-reason">Why does this location need a different price?</Label>
            <textarea
              id="ask-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-input bg-background p-2 text-base"
            />
          </div>
          <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={busy !== null}>
            {busy === 'ask' ? 'Sending…' : 'Send the request'}
          </Button>
        </form>
      </section>

      <section aria-labelledby="requests" className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 sm:p-5">
        <h2 id="requests" className="text-sm font-semibold text-foreground">
          Requests
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{data?.summary.headline ?? 'Reading the requests…'}</p>

        {(data?.requests ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing has been asked for yet. When a location asks, it appears here with the reason it gave.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {(data?.requests ?? []).map((row) => (
              <li key={row.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {row.templateName} at {row.locationName}
                  </p>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                    {statusWords(row.status)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-foreground/90">{describePriceChange(row.standardPriceCents, row.requestedPriceCents)}</p>
                {row.reason && <p className="mt-1 text-xs text-muted-foreground">Because {row.reason}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  Asked by {row.requestedByName ?? 'somebody'} on {new Date(row.requestedAt).toLocaleDateString('en-US')}
                  {row.approvedByName ? `, decided by ${row.approvedByName}` : ''}.
                </p>

                {data?.canDecide && row.status === 'PENDING' && (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    {confirming === row.id + 'approve' ? (
                      <>
                        <Button
                          className="min-h-11 w-full sm:w-auto"
                          onClick={() => decide(row.id, 'approve')}
                          disabled={busy !== null}
                        >
                          Yes, approve {money(row.requestedPriceCents)}
                        </Button>
                        <Button className="min-h-11 w-full sm:w-auto" variant="outline" onClick={() => setConfirming(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          className="min-h-11 w-full sm:w-auto"
                          variant="outline"
                          onClick={() => setConfirming(row.id + 'approve')}
                        >
                          Approve
                        </Button>
                        <Button
                          className="min-h-11 w-full sm:w-auto"
                          variant="ghost"
                          onClick={() => decide(row.id, 'decline')}
                          disabled={busy !== null}
                        >
                          Decline
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {data?.canDecide && row.status === 'APPROVED' && (
                  <Button
                    className="mt-2 min-h-11 w-full sm:w-auto"
                    variant="ghost"
                    onClick={() => decide(row.id, 'revoke')}
                    disabled={busy !== null}
                  >
                    Revoke this price
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  regions: string[]
  locations: { businessId: string; name: string; region: string | null; status: string }[]
  managers: { userId: string; name: string; regions: string[] }[]
  canManage: boolean
}

export function RegionsManager({ regions, locations, managers, canManage }: Props) {
  const router = useRouter()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  async function rename() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/dashboard/organization/regions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(typeof data.error === 'string' ? data.error : 'That could not be saved.')
        return
      }
      setNotice('Renamed. ' + (data.affected ?? 0) + ' location(s) moved with it.')
      setFrom('')
      setTo('')
      router.refresh()
    } catch {
      setError('The connection dropped. Nothing was changed.')
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="min-h-5 text-sm text-muted-foreground">{notice}</div>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">{error}</p>
      )}

      {regions.length === 0 ? (
        <p className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 text-sm text-muted-foreground">
          No regions yet. A region appears when you put a location into one, from that location&apos;s page. There is
          nothing to set up here first.
        </p>
      ) : (
        <ul className="space-y-3">
          {regions.map((region) => {
            const inRegion = locations.filter((row) => (row.region ?? '') === region)
            const regionManagerNames = managers
              .filter((person) => person.regions.length === 0 || person.regions.some((item) => item.toLowerCase() === region.toLowerCase()))
              .map((person) => person.name)
            return (
              <li key={region} className="rounded-xl border border-border bg-[var(--dash-surface)] p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                  <h2 className="break-words text-base font-semibold text-foreground">{region}</h2>
                  <p className="text-xs text-muted-foreground">
                    {inRegion.length} location{inRegion.length === 1 ? '' : 's'}
                  </p>
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {inRegion.map((row) => (
                    <li key={row.businessId} className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link href={'/dashboard/organization/locations/' + row.businessId} className="text-foreground underline-offset-4 hover:underline">
                        {row.name}
                      </Link>
                      <span className="text-xs text-muted-foreground">{row.status}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  {regionManagerNames.length > 0
                    ? 'Regional managers: ' + regionManagerNames.join(', ')
                    : 'No regional manager holds this region.'}
                </p>
                <Link
                  href="/dashboard/organization/people"
                  className="mt-2 inline-flex min-h-11 items-center text-xs text-foreground underline-offset-4 hover:underline"
                >
                  Change who looks after regions
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {canManage && regions.length > 0 && (
        <section aria-labelledby="rename-region" className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 sm:p-5">
          <h2 id="rename-region" className="text-sm font-semibold text-foreground">Rename a region</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every location in the region moves to the new name in one step. Nothing else about those locations changes.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="region-from">Current name</Label>
              <select
                id="region-from"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 text-base"
              >
                <option value="">Choose a region</option>
                {regions.map((region) => (
                  <option key={region} value={region}>{region}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="region-to">New name</Label>
              <Input id="region-to" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 min-h-11 text-base" />
            </div>
          </div>
          {confirming ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-foreground">
                Rename {from} to {to}? {locations.filter((row) => (row.region ?? '') === from).length} location(s) will
                move to the new name.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="min-h-11 w-full sm:w-auto" onClick={rename} disabled={busy}>
                  {busy ? 'Renaming…' : 'Yes, rename it'}
                </Button>
                <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setConfirming(false)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="mt-3 min-h-11 w-full sm:w-auto"
              onClick={() => {
                if (!from || !to.trim()) {
                  setError('Choose the region and enter its new name.')
                  return
                }
                setError(null)
                setConfirming(true)
              }}
            >
              Rename the region
            </Button>
          )}
        </section>
      )}
    </div>
  )
}

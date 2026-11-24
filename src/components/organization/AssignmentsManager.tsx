'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface RowView {
  id: string
  userId: string
  businessId: string
  businessName: string
  role: string
  roleWords: string
  effectiveFrom: string
  effectiveTo: string | null
  state: string
  stateWords: string
}

interface Props {
  current: RowView[]
  upcoming: RowView[]
  ended: RowView[]
  locations: { businessId: string; name?: string; status: string }[]
  people: { id: string; name: string; email: string }[]
  canAssign: boolean
}

const ROLES = [
  { value: 'LOCATION_MANAGER', label: 'Location manager' },
  { value: 'BARBER', label: 'Barber' },
  { value: 'ADMIN', label: 'Administrator' },
]

function day(value: string | null): string {
  return value ? value.slice(0, 10) : 'no end date'
}

export function AssignmentsManager({ current, upcoming, ended, locations, people, canAssign }: Props) {
  const router = useRouter()
  const [personId, setPersonId] = useState('')
  const [businessId, setBusinessId] = useState('')
  const [role, setRole] = useState('BARBER')
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10))
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [transferTo, setTransferTo] = useState('')
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10))

  async function send(action: string, url: string, method: string, body?: unknown, success?: string) {
    setBusy(action)
    setError(null)
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(typeof data.error === 'string' ? data.error : 'That could not be saved.')
        return false
      }
      setNotice(typeof data.explanation === 'string' ? data.explanation : success ?? 'Saved.')
      router.refresh()
      return true
    } catch {
      setError('The connection dropped. Nothing was changed.')
      return false
    } finally {
      setBusy(null)
      setConfirming(null)
    }
  }

  async function assign(event: React.FormEvent) {
    event.preventDefault()
    if (!personId || !businessId) {
      setError('Choose a person and a location.')
      return
    }
    const done = await send(
      'assign',
      '/api/dashboard/organization/assignments',
      'POST',
      {
        userId: personId,
        businessId,
        role,
        effectiveFrom: new Date(from + 'T00:00:00').toISOString(),
        effectiveTo: to ? new Date(to + 'T00:00:00').toISOString() : null,
      },
      'Assignment saved.',
    )
    if (done) {
      setPersonId('')
      setBusinessId('')
      setTo('')
    }
  }

  function endAssignment(row: RowView) {
    void send('end-' + row.id, '/api/dashboard/organization/assignments/' + row.id, 'PATCH', undefined, 'Assignment ended. The history stays.')
  }

  function transfer(row: RowView) {
    if (!transferTo) {
      setError('Choose where this person is moving to.')
      return
    }
    void send(
      'transfer-' + row.id,
      '/api/dashboard/organization/assignments/' + row.id,
      'POST',
      { destinationBusinessId: transferTo, effectiveFrom: new Date(transferDate + 'T00:00:00').toISOString() },
    )
  }

  function rows(title: string, list: RowView[], showActions: boolean) {
    if (list.length === 0) return null
    return (
      <section aria-labelledby={'assign-' + title.toLowerCase()} className="space-y-2">
        <h2 id={'assign-' + title.toLowerCase()} className="text-sm font-semibold text-foreground">
          {title} ({list.length})
        </h2>
        <ul className="space-y-2">
          {list.map((row) => (
            <li key={row.id} className="rounded-xl border border-border bg-[var(--dash-surface)] p-3">
              <p className="break-words text-sm font-medium text-foreground">
                {people.find((person) => person.id === row.userId)?.name ?? 'Someone'} · {row.roleWords}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {row.businessName} · {day(row.effectiveFrom)} to {day(row.effectiveTo)} · {row.stateWords}
              </p>
              {showActions && canAssign && (
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  {confirming === 'end-' + row.id ? (
                    <>
                      <p className="text-xs text-foreground">End this assignment now? The person loses access and keeps their history.</p>
                      <Button className="min-h-11 w-full sm:w-auto" onClick={() => endAssignment(row)} disabled={busy !== null}>
                        Yes, end it
                      </Button>
                      <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setConfirming(null)} disabled={busy !== null}>
                        Cancel
                      </Button>
                    </>
                  ) : confirming === 'transfer-' + row.id ? (
                    <div className="w-full space-y-2">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div>
                          <Label htmlFor={'to-' + row.id}>Moving to</Label>
                          <select
                            id={'to-' + row.id}
                            value={transferTo}
                            onChange={(event) => setTransferTo(event.target.value)}
                            className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 text-base"
                          >
                            <option value="">Choose a location</option>
                            {locations
                              .filter((location) => location.businessId !== row.businessId)
                              .map((location) => (
                                <option key={location.businessId} value={location.businessId}>
                                  {location.name ?? 'A location'}
                                </option>
                              ))}
                          </select>
                        </div>
                        <div>
                          <Label htmlFor={'date-' + row.id}>From</Label>
                          <Input id={'date-' + row.id} type="date" value={transferDate} onChange={(event) => setTransferDate(event.target.value)} className="mt-1 min-h-11 text-base" />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        The old assignment ends on that date and a new one starts the same day. Their history at both
                        locations stays.
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button className="min-h-11 w-full sm:w-auto" onClick={() => transfer(row)} disabled={busy !== null}>
                          Confirm transfer
                        </Button>
                        <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setConfirming(null)} disabled={busy !== null}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setConfirming('transfer-' + row.id)}>
                        Move to another location
                      </Button>
                      <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setConfirming('end-' + row.id)}>
                        End assignment
                      </Button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="min-h-5 text-sm text-muted-foreground">{notice}</div>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">{error}</p>
      )}

      {canAssign && (
        <section aria-labelledby="add-assignment" className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 sm:p-5">
          <h2 id="add-assignment" className="text-sm font-semibold text-foreground">Assign somebody to a location</h2>
          <form className="mt-3 space-y-3" onSubmit={assign}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="assign-person">Person</Label>
                <select id="assign-person" value={personId} onChange={(event) => setPersonId(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 text-base">
                  <option value="">Choose a person</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>{person.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="assign-location">Location</Label>
                <select id="assign-location" value={businessId} onChange={(event) => setBusinessId(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 text-base">
                  <option value="">Choose a location</option>
                  {locations.map((location) => (
                    <option key={location.businessId} value={location.businessId}>{location.name ?? 'A location'}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="assign-role">Role there</Label>
                <select id="assign-role" value={role} onChange={(event) => setRole(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 text-base">
                  {ROLES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="assign-from">Starts</Label>
                  <Input id="assign-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 min-h-11 text-base" />
                </div>
                <div>
                  <Label htmlFor="assign-to">Ends (optional)</Label>
                  <Input id="assign-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 min-h-11 text-base" />
                </div>
              </div>
            </div>
            <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={busy !== null}>
              {busy === 'assign' ? 'Saving…' : 'Add the assignment'}
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            You cannot assign yourself, and a location that is closed takes no new assignments.
          </p>
        </section>
      )}

      {rows('In force now', current, true)}
      {rows('Starts later', upcoming, true)}
      {rows('Ended', ended, false)}

      {current.length === 0 && upcoming.length === 0 && ended.length === 0 && (
        <p className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 text-sm text-muted-foreground">
          Nobody is assigned to a location yet. An assignment is what gives somebody access to a shop; without one,
          they see only their own dashboard.
        </p>
      )}
    </div>
  )
}

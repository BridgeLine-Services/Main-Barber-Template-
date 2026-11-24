'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * One location: its details, what still blocks opening it, and the two consequential actions.
 *
 * Nothing here is authorization. The server re-checks the capability, the scope and every
 * prerequisite before writing, so a hidden button or a forged request gets nowhere.
 */

export interface DetailLocation {
  businessId: string
  name: string
  region: string | null
  status: string
  address: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  email: string | null
  phone: string | null
  timezone: string
  readiness: { brandSet: boolean; servicesSet: boolean; managerAssigned: boolean }
}

export interface ChecklistStepView {
  key: string
  title: string
  whatItDoes: string
  whatChanges: string
  whoMayDoIt: string
  canBeUndone: string
  ifSomethingGoesWrong: string
}

export interface ClosureLineView {
  label: string
  value: number | null
  note: string
}

export interface ClosureReviewView {
  allowed: boolean
  reasons: string[]
  headline: string
  lines: ClosureLineView[]
  keeps: string[]
}

interface Props {
  location: DetailLocation
  canManage: boolean
  regions: string[]
  activation: { allowed: boolean; reasons: string[] }
  openingSteps: ChecklistStepView[]
  closingSteps: ChecklistStepView[]
  reopen: { allowed: boolean; message: string }
  closureReview: ClosureReviewView | null
}

export function LocationDetail({ location, canManage, regions, activation, openingSteps, closingSteps, reopen, closureReview }: Props) {
  const router = useRouter()
  const [form, setForm] = useState({
    name: location.name,
    address: location.address ?? '',
    city: location.city ?? '',
    state: location.state ?? '',
    zipCode: location.zipCode ?? '',
    email: location.email ?? '',
    phone: location.phone ?? '',
    timezone: location.timezone,
    region: location.region ?? '',
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [exported, setExported] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [reopenAck, setReopenAck] = useState(false)

  async function call(action: string, run: () => Promise<Response>, success: string) {
    setBusy(action)
    setError(null)
    try {
      const response = await run()
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(typeof data.error === 'string' ? data.error : 'That could not be saved.')
        return false
      }
      setNotice(success)
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

  function saveDetails(event: React.FormEvent) {
    event.preventDefault()
    void call(
      'save',
      () =>
        fetch('/api/dashboard/organization/locations/' + location.businessId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, region: form.region.trim().length > 0 ? form.region : null }),
        }),
      'Saved.',
    )
  }

  function act(action: 'activate' | 'start-closing' | 'close' | 'reopen' | 'prepare-reopening') {
    const words =
      action === 'activate'
        ? 'The location is open and can take bookings.'
        : action === 'start-closing'
          ? 'The location is closing. New bookings stop; existing appointments are untouched.'
          : action === 'close'
            ? 'The location is closed. Its records are kept.'
            : action === 'reopen'
              ? 'Reopening has started. The location cannot take bookings until it is activated.'
              : 'The location is in onboarding. Finish the opening checklist, then activate it.'
    void call(
      action,
      () =>
        fetch('/api/dashboard/organization/locations/' + location.businessId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, recordsExported: exported, reason: reopenReason, acknowledged: reopenAck }),
        }),
      words,
    )
  }

  const steps = location.status === 'onboarding' ? openingSteps : location.status === 'closing' ? closingSteps : []

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {notice}
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">
          {error}
        </p>
      )}

      {location.status === 'onboarding' && (
        <section aria-labelledby="ready" className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 sm:p-5">
          <h2 id="ready" className="text-sm font-semibold text-foreground">Before this location can open</h2>
          <ul className="mt-2 space-y-1 text-sm">
            <li className={location.readiness.brandSet ? 'text-foreground' : 'text-amber-600'}>
              {location.readiness.brandSet ? 'Brand is set.' : 'Brand is not set yet.'}
            </li>
            <li className={location.readiness.servicesSet ? 'text-foreground' : 'text-amber-600'}>
              {location.readiness.servicesSet ? 'Services and prices are in place.' : 'No services yet.'}
            </li>
            <li className={location.readiness.managerAssigned ? 'text-foreground' : 'text-amber-600'}>
              {location.readiness.managerAssigned ? 'A location manager is appointed.' : 'No location manager yet.'}
            </li>
          </ul>
          {!activation.allowed && (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {activation.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {steps.length > 0 && (
        <section aria-labelledby="checklist" className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 sm:p-5">
          <h2 id="checklist" className="text-sm font-semibold text-foreground">
            {location.status === 'closing' ? 'Closing checklist' : 'Opening checklist'}
          </h2>
          <ol className="mt-3 space-y-3">
            {steps.map((step) => (
              <li key={step.key} className="rounded-lg border border-border p-3">
                <h3 className="text-sm font-medium text-foreground">{step.title}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{step.whatItDoes}</p>
                <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div><dt className="inline font-medium text-foreground/80">What changes: </dt><dd className="inline">{step.whatChanges}</dd></div>
                  <div><dt className="inline font-medium text-foreground/80">Who may do it: </dt><dd className="inline">{step.whoMayDoIt}</dd></div>
                  <div><dt className="inline font-medium text-foreground/80">Can it be undone: </dt><dd className="inline">{step.canBeUndone}</dd></div>
                  <div><dt className="inline font-medium text-foreground/80">If something goes wrong: </dt><dd className="inline">{step.ifSomethingGoesWrong}</dd></div>
                </dl>
              </li>
            ))}
          </ol>
        </section>
      )}

      {canManage && location.status === 'onboarding' && (
        <section aria-labelledby="open" className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 sm:p-5">
          <h2 id="open" className="text-sm font-semibold text-foreground">Open this location</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Opening makes the shop live and bookable. It can be undone by starting the closing process.
          </p>
          {confirming === 'activate' ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-foreground">
                Open {location.name} now? Its public page and booking link start working immediately.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="min-h-11 w-full sm:w-auto" onClick={() => act('activate')} disabled={busy !== null || !activation.allowed}>
                  {busy === 'activate' ? 'Opening…' : 'Yes, open it'}
                </Button>
                <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setConfirming(null)} disabled={busy !== null}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button className="mt-3 min-h-11 w-full sm:w-auto" onClick={() => setConfirming('activate')} disabled={!activation.allowed}>
              Open the location
            </Button>
          )}
          {!activation.allowed && (
            <p className="mt-2 text-xs text-muted-foreground">Finish the items above first. The server refuses an early open.</p>
          )}
        </section>
      )}

      {canManage && location.status === 'active' && (
        <section aria-labelledby="closing" className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 sm:p-5">
          <h2 id="closing" className="text-sm font-semibold text-foreground">Start closing this location</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This is the first of two steps. It stops new bookings. Nothing is cancelled, deleted or dismissed, and you
            can come back to closing later.
          </p>
          <Button className="mt-3 min-h-11 w-full sm:w-auto" variant="outline" onClick={() => setConfirming('start-closing')}>
            Start closing
          </Button>
        </section>
      )}

      {canManage && location.status === 'closing' && (
        <section aria-labelledby="close" className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 sm:p-5">
          <h2 id="close" className="text-sm font-semibold text-foreground">Finish closing this location</h2>
          {closureReview ? (
            <>
              <p className="mt-1 text-sm text-foreground/90">{closureReview.headline}</p>
              <dl className="mt-3 space-y-2 text-sm">
                {closureReview.lines.map((line) => (
                  <div key={line.label} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <dt className="text-muted-foreground">{line.label}</dt>
                    <dd className="sm:text-right">
                      <span className="font-medium text-foreground">{line.value === null ? 'Could not be checked' : line.value}</span>
                      <span className="block text-xs text-muted-foreground">{line.note}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {closureReview.keeps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <label className="mt-3 flex items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={exported}
                  onChange={(event) => setExported(event.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                <span>I have exported a copy of this location&apos;s records.</span>
              </label>
              {!closureReview.allowed && (
                <ul className="mt-2 space-y-1 text-xs text-amber-600">
                  {closureReview.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
              {confirming === 'close' ? (
                <div className="mt-3 space-y-2">
                  <p className="text-sm text-foreground">
                    Close {location.name}? It leaves organization totals and stops taking bookings. Its records stay
                    readable, and it cannot be reopened as itself.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button className="min-h-11 w-full sm:w-auto" onClick={() => act('close')} disabled={busy !== null || !closureReview.allowed}>
                      {busy === 'close' ? 'Closing…' : 'Yes, close it'}
                    </Button>
                    <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setConfirming(null)} disabled={busy !== null}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button className="mt-3 min-h-11 w-full sm:w-auto" onClick={() => setConfirming('close')} disabled={!closureReview.allowed}>
                  Finish closing
                </Button>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              The closing details could not be read just now. Nothing has changed.
            </p>
          )}
        </section>
      )}

      {location.status === 'closed' && (
        <section aria-labelledby="closed" className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 sm:p-5">
          <h2 id="closed" className="text-sm font-semibold text-foreground">This location is closed</h2>
          <p className="mt-2 text-sm text-foreground/90">{reopen.message}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Reopening does not create a second shop. This location keeps its name, its appointments and its customer
            records, and it cannot take bookings again until it has been through onboarding and activated.
          </p>
          {canManage && reopen.allowed && (
            <div className="mt-3 space-y-3">
              <div>
                <Label htmlFor="reopen-reason">Why are you reopening it?</Label>
                <textarea
                  id="reopen-reason"
                  value={reopenReason}
                  onChange={(event) => setReopenReason(event.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-md border border-input bg-background p-2 text-base"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Saved with the change, so the history explains itself later.
                </p>
              </div>
              <label className="flex items-start gap-2 text-sm text-foreground/90">
                <input
                  type="checkbox"
                  checked={reopenAck}
                  onChange={(event) => setReopenAck(event.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                <span>I understand this location keeps its existing records and history.</span>
              </label>
              {confirming === 'reopen' ? (
                <div>
                  <p className="text-sm text-foreground/90">
                    Begin reopening now? The location moves to reopening. Nothing is booked, cancelled or deleted.
                  </p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <Button
                      className="min-h-11 w-full sm:w-auto"
                      onClick={() => act('reopen')}
                      disabled={busy !== null || reopenReason.trim().length < 10 || !reopenAck}
                    >
                      {busy === 'reopen' ? 'Starting…' : 'Yes, begin reopening'}
                    </Button>
                    <Button className="min-h-11 w-full sm:w-auto" variant="outline" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button className="min-h-11 w-full sm:w-auto" variant="outline" onClick={() => setConfirming('reopen')}>
                  Reopen this location
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      {location.status === 'reopening' && (
        <section aria-labelledby="reopening" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5">
          <h2 id="reopening" className="text-sm font-semibold text-foreground">Reopening in progress</h2>
          <p className="mt-2 text-sm text-foreground/90">
            Check the people, the services and the opening hours. When you are ready, move it to onboarding to finish the
            opening checklist. It cannot take bookings until it is activated.
          </p>
          {canManage && (
            <Button className="mt-3 min-h-11 w-full sm:w-auto" variant="outline" onClick={() => act('prepare-reopening')} disabled={busy !== null}>
              {busy === 'prepare-reopening' ? 'Moving…' : 'Move to onboarding'}
            </Button>
          )}
        </section>
      )}

      {canManage && (
        <section aria-labelledby="details" className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 sm:p-5">
          <h2 id="details" className="text-sm font-semibold text-foreground">Location details</h2>
          <form className="mt-3 space-y-3" onSubmit={saveDetails}>
            <div>
              <Label htmlFor="detail-name">Shop name</Label>
              <Input id="detail-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 min-h-11 text-base" />
            </div>
            <div>
              <Label htmlFor="detail-address">Street address</Label>
              <Input id="detail-address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className="mt-1 min-h-11 text-base" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="detail-city">City</Label>
                <Input id="detail-city" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} className="mt-1 min-h-11 text-base" />
              </div>
              <div>
                <Label htmlFor="detail-state">State</Label>
                <Input id="detail-state" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} className="mt-1 min-h-11 text-base" />
              </div>
              <div>
                <Label htmlFor="detail-zip">ZIP</Label>
                <Input id="detail-zip" value={form.zipCode} onChange={(event) => setForm({ ...form, zipCode: event.target.value })} className="mt-1 min-h-11 text-base" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="detail-email">Contact email</Label>
                <Input id="detail-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-1 min-h-11 text-base" />
              </div>
              <div>
                <Label htmlFor="detail-phone">Contact phone</Label>
                <Input id="detail-phone" type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="mt-1 min-h-11 text-base" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="detail-timezone">Timezone</Label>
                <Input id="detail-timezone" value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} className="mt-1 min-h-11 text-base" />
              </div>
              <div>
                <Label htmlFor="detail-region">Region</Label>
                <Input id="detail-region" list="known-regions" value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })} className="mt-1 min-h-11 text-base" />
                <datalist id="known-regions">
                  {regions.map((region) => (
                    <option key={region} value={region} />
                  ))}
                </datalist>
              </div>
            </div>
            <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={busy !== null}>
              {busy === 'save' ? 'Saving…' : 'Save changes'}
            </Button>
          </form>
        </section>
      )}
    </div>
  )
}

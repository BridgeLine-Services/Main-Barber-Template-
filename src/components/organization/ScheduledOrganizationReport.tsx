'use client'

import { useState, type FormEvent } from 'react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Frequency = 'daily' | 'weekly' | 'monthly'
type DeliveryState = {
  enabled: boolean
  frequency: Frequency
  periodDays: 7 | 30 | 90
  timeZone: string
  recipientEmail: string
  deliveryMethod: 'EMAIL'
  nextRunAt: string | null
  lastDeliveryStatus: string | null
  lastDeliveryAt: string | null
  lastDeliveryError: string | null
}
type ScheduleResponse = { schedule: DeliveryState }
type EditableSchedule = Pick<DeliveryState, 'enabled' | 'frequency' | 'periodDays' | 'timeZone' | 'recipientEmail' | 'deliveryMethod'>

const defaults: EditableSchedule = {
  enabled: false,
  frequency: 'weekly',
  periodDays: 7,
  timeZone: 'UTC',
  recipientEmail: '',
  deliveryMethod: 'EMAIL',
}

async function fetchSchedule(url: string): Promise<ScheduleResponse> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('Report schedule is unavailable.')
  return response.json()
}

function scheduledTime(value: string | null, timeZone: string): string | null {
  if (!value) return null
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(value))
  } catch {
    return null
  }
}

export function ScheduledOrganizationReport() {
  const { data, error, mutate, isLoading } = useSWR<ScheduleResponse>(
    '/api/dashboard/organization/report/schedule',
    fetchSchedule,
    { revalidateOnFocus: false },
  )
  const [draft, setDraft] = useState<Partial<EditableSchedule>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const current = { ...defaults, ...data?.schedule, ...draft }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    setSaveError('')

    try {
      const response = await fetch('/api/dashboard/organization/report/schedule', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(current),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Report schedule could not be saved.')
      setDraft({})
      await mutate(result, { revalidate: false })
      setMessage('Report schedule saved.')
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Report schedule could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const nextRun = scheduledTime(data?.schedule.nextRunAt ?? null, current.timeZone)
  const status = data?.schedule.lastDeliveryStatus
  const lastRun = status === 'PENDING' ? null : scheduledTime(data?.schedule.lastDeliveryAt ?? null, current.timeZone)
  const statusLabel = status === 'PENDING' ? 'Queued · awaiting delivery' : status

  return (
    <section aria-labelledby="scheduled-report-title" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-[var(--dash-brand)]">Scheduled delivery</p>
        <h2 id="scheduled-report-title" className="mt-2 text-lg font-semibold text-foreground">Organization report</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Email-only summaries contain organization-level totals, never customer identities or appointment histories.
          Reports run at 9:00 AM in the selected time zone (weekly on Monday, monthly on the first).
        </p>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">Loading report schedule…</p>
      ) : error ? (
        <p className="mt-4 rounded-lg border border-border p-3 text-sm text-muted-foreground" role="status">
          Report settings are temporarily unavailable. Try again later; no schedule changes were made.
        </p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">Next scheduled report</dt>
              <dd className="mt-1 text-sm font-medium text-foreground">{current.enabled ? nextRun ?? 'Calculating schedule' : 'Disabled'}</dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">Last delivery outcome</dt>
              <dd className="mt-1 text-sm font-medium text-foreground">
                {statusLabel ? `${statusLabel}${lastRun ? ` · ${lastRun}` : ''}` : 'No delivery attempts yet'}
              </dd>
              {data?.schedule.lastDeliveryError && (
                <dd className="mt-1 text-xs text-muted-foreground">{data.schedule.lastDeliveryError}</dd>
              )}
            </div>
          </dl>

          <form className="mt-5 flex flex-col gap-4" onSubmit={save}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="report-frequency">Frequency</Label>
                <select
                  id="report-frequency"
                  className="min-h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                  value={current.frequency}
                  onChange={(event) => setDraft((state) => ({ ...state, frequency: event.target.value as Frequency }))}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="report-period">Reporting period</Label>
                <select
                  id="report-period"
                  className="min-h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                  value={current.periodDays}
                  onChange={(event) => setDraft((state) => ({ ...state, periodDays: Number(event.target.value) as 7 | 30 | 90 }))}
                >
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                  <option value={90}>Last 90 days</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="report-time-zone">Time zone</Label>
                <Input
                  id="report-time-zone"
                  autoComplete="off"
                  placeholder="America/New_York"
                  value={current.timeZone}
                  onChange={(event) => setDraft((state) => ({ ...state, timeZone: event.target.value }))}
                  aria-describedby="report-time-zone-help"
                />
                <p id="report-time-zone-help" className="text-xs text-muted-foreground">Use an IANA name, such as America/New_York or UTC.</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="report-recipient">Recipient email</Label>
                <Input
                  id="report-recipient"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required={current.enabled}
                  value={current.recipientEmail}
                  onChange={(event) => setDraft((state) => ({ ...state, recipientEmail: event.target.value }))}
                  placeholder="reports@example.com"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="report-delivery-method">Delivery method</Label>
                <select
                  id="report-delivery-method"
                  className="min-h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                  value={current.deliveryMethod}
                  onChange={() => setDraft((state) => ({ ...state, deliveryMethod: 'EMAIL' }))}
                  aria-describedby="report-delivery-help"
                  disabled
                >
                  <option value="EMAIL">Email</option>
                </select>
                <p id="report-delivery-help" className="text-xs text-muted-foreground">Email is the only configured delivery channel for aggregate reports.</p>
              </div>
              <div className="flex items-center gap-3 self-end pb-1">
                <input
                  id="report-enabled"
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={current.enabled}
                  onChange={(event) => setDraft((state) => ({ ...state, enabled: event.target.checked }))}
                />
                <Label htmlFor="report-enabled">Enable scheduled reports</Label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save schedule'}
              </Button>
              <p aria-live="polite" className="text-sm text-muted-foreground">{saveError || message}</p>
            </div>
          </form>
        </>
      )}
    </section>
  )
}

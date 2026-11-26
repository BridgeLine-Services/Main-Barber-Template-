'use client'

/**
 * The organization's standard service list, in plain language.
 *
 * This screen is for a franchise owner or corporate administrator who is not technical. It
 * explains what a template is, what a change affects, and what it deliberately does not
 * affect: a location with an approved local price keeps that price.
 */

import { useState } from 'react'
import { formatCents } from '@/lib/organization/service-templates'

export interface TemplateRowView {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  defaultPriceCents: number
  active: boolean
  locationExceptions: number
}

interface Props {
  initialTemplates: TemplateRowView[]
  canManage: boolean
}

interface FormState {
  id: string | null
  name: string
  description: string
  durationMinutes: string
  price: string
  active: boolean
}

const EMPTY: FormState = { id: null, name: '', description: '', durationMinutes: '', price: '', active: true }

function toForm(t: TemplateRowView): FormState {
  return {
    id: t.id,
    name: t.name,
    description: t.description ?? '',
    durationMinutes: String(t.durationMinutes),
    price: (t.defaultPriceCents / 100).toFixed(2),
    active: t.active,
  }
}

export default function ServiceTemplates({ initialTemplates, canManage }: Props) {
  const [templates, setTemplates] = useState<TemplateRowView[]>(initialTemplates)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const editing = form.id !== null
  const exceptionsOnEdited = editing ? templates.find((t) => t.id === form.id)?.locationExceptions ?? 0 : 0

  async function save() {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const priceCents = Math.round(Number.parseFloat(form.price || '0') * 100)
      const payload = {
        name: form.name,
        description: form.description,
        durationMinutes: Number.parseInt(form.durationMinutes || '0', 10),
        defaultPriceCents: Number.isFinite(priceCents) ? priceCents : 0,
        active: form.active,
      }
      const res = await fetch(
        editing ? `/api/dashboard/organization/service-templates/${form.id}` : '/api/dashboard/organization/service-templates',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'The service could not be saved. Nothing has changed.')
        return
      }
      const saved = data.template as TemplateRowView
      setTemplates((list) => {
        const rest = list.filter((t) => t.id !== saved.id)
        return [...rest, saved].sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active ? -1 : 1))
      })
      setNotice(editing ? `Saved "${saved.name}".` : `Added "${saved.name}" to the standard list.`)
      setForm(EMPTY)
    } catch {
      setError('The service could not be saved. Nothing has changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
        <h2 className="text-lg font-semibold text-foreground">The standard service list</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These are the services your organization offers. A new location starts with this list, so
          nobody has to retype it. Changing a price here does not change a location that has an
          approved local price; it only changes the standard.
        </p>

        {templates.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No standard services yet. Add the first one below, for example &ldquo;Haircut, 30 minutes, $35&rdquo;.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Standard services, their length, price and local price exceptions</caption>
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th scope="col" className="py-2 pr-4">Service</th>
                  <th scope="col" className="py-2 pr-4">Length</th>
                  <th scope="col" className="py-2 pr-4">Standard price</th>
                  <th scope="col" className="py-2 pr-4">Local prices</th>
                  <th scope="col" className="py-2">{canManage ? 'Action' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-t border-border align-top">
                    <th scope="row" className="py-3 pr-4 text-left font-medium text-foreground">
                      {t.name}
                      {t.description ? <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{t.description}</span> : null}
                      {!t.active ? <span className="mt-1 block text-xs font-normal text-muted-foreground">Not offered at the moment</span> : null}
                    </th>
                    <td className="py-3 pr-4 text-muted-foreground">{t.durationMinutes} minutes</td>
                    <td className="py-3 pr-4 text-foreground">{formatCents(t.defaultPriceCents)}</td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {t.locationExceptions === 0
                        ? 'Every location uses the standard price'
                        : `${t.locationExceptions} ${t.locationExceptions === 1 ? 'location has' : 'locations have'} an approved local price`}
                    </td>
                    <td className="py-3">
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => { setForm(toForm(t)); setError(null); setNotice(null) }}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-[var(--dash-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          Change {t.name}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Read only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage ? (
        <section className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <h2 className="text-lg font-semibold text-foreground">{editing ? `Change "${form.name || 'this service'}"` : 'Add a standard service'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {editing
              ? exceptionsOnEdited > 0
                ? `The standard price will change. ${exceptionsOnEdited} ${exceptionsOnEdited === 1 ? 'location keeps its' : 'locations keep their'} approved local price.`
                : 'The standard price will change, and every location that uses it will charge the new price.'
              : 'This becomes the starting list for every new location.'}
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-foreground">Service name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Haircut"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-foreground">How long it takes, in minutes</span>
              <input
                value={form.durationMinutes}
                onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                inputMode="numeric"
                placeholder="30"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-foreground">Standard price</span>
              <input
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                inputMode="decimal"
                placeholder="35.00"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-foreground">Description (optional)</span>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Wash, cut and finish"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
                className="h-4 w-4 rounded border-input"
              />
              <span className="text-foreground">Offer this service. Un-ticking hides it from the list new locations copy.</span>
            </label>
          </div>

          {error ? (
            <p role="alert" className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {notice}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-lg bg-[var(--dash-brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {busy ? 'Saving…' : editing ? 'Save the change' : 'Add the service'}
            </button>
            {editing ? (
              <button
                type="button"
                onClick={() => { setForm(EMPTY); setError(null) }}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-[var(--dash-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Stop changing this service
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          You can see the standard list. Only an organization owner or a corporate administrator can change it.
        </p>
      )}
    </div>
  )
}

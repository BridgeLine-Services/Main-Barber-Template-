'use client'

/**
 * The shared brand, and who may change what.
 *
 * Written for a franchise owner who is not technical. Every field says what it controls and
 * what a location will see. The preview shows the result before it is saved, and the location
 * list answers "why does that shop look like that?".
 */

import { useState } from 'react'
import { auditBrandContrast, summariseContrast } from '@/lib/theme-contrast'

export interface BrandSettingsView {
  logoUrl: string | null
  primaryColor: string | null
  accentColor: string | null
  brandGuidelinesUrl: string | null
  allowedOverrides: string[]
  boundary: string
}

export interface LocationBrandView {
  businessId: string
  name: string
  resolved: Array<{ field: string; value: string | null; source: 'organization' | 'location' | 'cleared' | 'unset' }>
  usesOwnValue: boolean
}

interface Props {
  initialSettings: BrandSettingsView | null
  locations: LocationBrandView[]
  canManage: boolean
}

const FIELD_LABELS: Record<string, string> = {
  logoUrl: 'Logo',
  primaryColor: 'Main colour',
  accentColor: 'Accent colour',
  brandGuidelinesUrl: 'Brand guidelines',
}

export default function BrandEditor({ initialSettings, locations, canManage }: Props) {
  const [logoUrl, setLogoUrl] = useState(initialSettings?.logoUrl ?? '')
  const [primaryColor, setPrimaryColor] = useState(initialSettings?.primaryColor ?? '')
  const [accentColor, setAccentColor] = useState(initialSettings?.accentColor ?? '')
  const [guidelines, setGuidelines] = useState(initialSettings?.brandGuidelinesUrl ?? '')
  const [allowed, setAllowed] = useState<string[]>(initialSettings?.allowedOverrides ?? [])
  const [boundary, setBoundary] = useState(initialSettings?.boundary ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const setFields: Array<{ key: string; label: string; value: string }> = [
    { key: 'logoUrl', label: FIELD_LABELS.logoUrl, value: logoUrl },
    { key: 'primaryColor', label: FIELD_LABELS.primaryColor, value: primaryColor },
    { key: 'accentColor', label: FIELD_LABELS.accentColor, value: accentColor },
    { key: 'brandGuidelinesUrl', label: FIELD_LABELS.brandGuidelinesUrl, value: guidelines },
  ]

  function toggleOverride(key: string) {
    setAllowed((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]))
  }

  async function save() {
    setError(null); setNotice(null); setBusy(true)
    try {
      const res = await fetch('/api/dashboard/organization/branding', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          logoUrl: logoUrl || null,
          primaryColor: primaryColor || null,
          accentColor: accentColor || null,
          brandGuidelinesUrl: guidelines || null,
          allowedOverrides: allowed,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data?.error ?? 'The brand could not be saved. Nothing has changed.'); return }
      setBoundary(data.settings?.boundary ?? '')
      setNotice('Saved. Locations that use the shared brand will show this the next time they load a page.')
    } catch {
      setError('The brand could not be saved. Nothing has changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
        <h2 className="text-lg font-semibold text-foreground">The shared brand</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This is the look every location starts with. Colours are used by the website and the
          customer booking page; the logo appears in the header and on emails.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-foreground">Logo web address</span>
            <input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="Upload the logo, then paste its address here"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Must be an image uploaded through this application. Links to other websites are refused.
            </span>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-foreground">Main colour</span>
            <input
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              placeholder="#1a1a1a"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-foreground">Accent colour</span>
            <input
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              placeholder="#d4a853"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            />
          </label>
          {/* Same rule as the setup wizard: an organization's colours decide whether its own
              text reads, so a failing pairing is named before it reaches a location's site. */}
          <div aria-live="polite" className="rounded-lg border border-border bg-background/60 p-3">
            <p className="text-xs font-medium text-foreground">Contrast check</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {summariseContrast(
                auditBrandContrast({ primaryColor: primaryColor || null, accentColor: accentColor || null }),
              )}
            </p>
            <ul className="mt-2 space-y-1">
              {auditBrandContrast({ primaryColor: primaryColor || null, accentColor: accentColor || null }).map(
                (entry) => (
                  <li key={entry.pair} className={entry.passes ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>
                    {entry.pair}: {entry.ratio === null ? 'cannot be checked' : `${entry.ratio}:1`}
                  </li>
                ),
              )}
            </ul>
          </div>
          <label className="block text-sm">
            <span className="font-medium text-foreground">Brand guidelines address (optional)</span>
            <input
              value={guidelines}
              onChange={(e) => setGuidelines(e.target.value)}
              placeholder="https://…"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            />
          </label>
        </div>

        <div className="mt-5">
          <p className="text-sm font-medium text-foreground">Preview</p>
          <div className="mt-2 rounded-xl border border-border p-4" style={{ background: '#ffffff' }}>
            <div className="flex items-center gap-3">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Logo preview" className="h-10 w-10 rounded object-contain" />
              ) : (
                <div className="h-10 w-10 rounded bg-neutral-200" aria-hidden="true" />
              )}
              <span className="font-semibold" style={{ color: primaryColor || '#1a1a1a' }}>Your organization</span>
            </div>
            <p className="mt-3 text-sm" style={{ color: primaryColor || '#1a1a1a' }}>Book your next appointment</p>
            <span
              className="mt-2 inline-block rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
              style={{ background: accentColor || '#d4a853' }}
            >
              Book now
            </span>
          </div>
        </div>
      </section>

      {canManage ? (
        <section className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <h2 className="text-lg font-semibold text-foreground">What a location may change</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tick a box to let each location use its own value for that field. Anything unticked stays
            shared, and a location cannot change it. A field only appears here once the shared value
            is set. <strong className="text-foreground">Careful:</strong> locations already have a
            colour stored, so ticking a box switches every location that has a different one over to
            its own value straight away. The table below shows exactly which locations would change.
          </p>
          <div className="mt-3 space-y-2">
            {setFields.filter((f) => f.value.trim() !== '').length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Set the shared values above first. There is nothing for a location to override yet.
              </p>
            ) : (
              setFields.filter((f) => f.value.trim() !== '').map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={allowed.includes(f.key)}
                    onChange={() => toggleOverride(f.key)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span className="text-foreground">Let locations use their own {f.label.toLowerCase()}</span>
                </label>
              ))
            )}
          </div>
          {boundary ? <p className="mt-3 text-xs text-muted-foreground">{boundary}</p> : null}

          {error ? (
            <p role="alert" className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
          ) : null}
          {notice ? (
            <p role="status" className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p>
          ) : null}

          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="mt-4 rounded-lg bg-[var(--dash-brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {busy ? 'Saving…' : 'Save the shared brand'}
          </button>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          You can see the shared brand. Only an organization owner or a corporate administrator can change it.
        </p>
      )}

      <section className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
        <h2 className="text-lg font-semibold text-foreground">What each location shows</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          &ldquo;Shared&rdquo; means the location uses the organization brand. &ldquo;Its own&rdquo; means an allowed
          local value is in use.
        </p>
        {locations.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No open locations yet. Once a location is added it appears here with the brand it uses.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Each location and where its brand values come from</caption>
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th scope="col" className="py-2 pr-4">Location</th>
                  <th scope="col" className="py-2 pr-4">Brand</th>
                  <th scope="col" className="py-2">Fields it sets itself</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((l) => (
                  <tr key={l.businessId} className="border-t border-border">
                    <th scope="row" className="py-2 pr-4 text-left font-medium text-foreground">{l.name}</th>
                    <td className="py-2 pr-4 text-muted-foreground">{l.usesOwnValue ? 'Its own values' : 'Shared brand'}</td>
                    <td className="py-2 text-muted-foreground">
                      {l.resolved
                        .filter((f) => f.source === 'location' || f.source === 'cleared')
                        .map((f) => (FIELD_LABELS[f.field] ?? f.field) + (f.source === 'cleared' ? ' (cleared)' : ''))
                        .join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

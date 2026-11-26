'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  NAV_LABEL_MAX,
  NAV_LINK_LIMIT,
  describeNavigation,
  moveNavigationItem,
  normaliseNavigation,
  validateNavigation,
  type NavLink,
} from '@/lib/website-navigation'

/**
 * The menu editor. Order is changed with buttons rather than dragging, so it works with a
 * keyboard and on a phone. Nothing here is trusted: the save endpoint validates the same
 * rules, and a refusal is shown field by field.
 */
export function WebsiteNavigationEditor({ initialLinks }: { initialLinks: NavLink[] }) {
  const router = useRouter()
  const [links, setLinks] = useState<NavLink[]>(initialLinks)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const verdict = validateNavigation(normaliseNavigation(links))

  function update(index: number, patch: Partial<NavLink>) {
    setLinks((current) => current.map((link, position) => (position === index ? { ...link, ...patch } : link)))
    setNotice(null)
  }

  function addLink() {
    if (links.length >= NAV_LINK_LIMIT) return
    setLinks((current) => [...current, { label: '', href: '/', visible: true }])
    setNotice(null)
  }

  function removeLink(index: number) {
    setLinks((current) => current.filter((_, position) => position !== index))
    setNotice(null)
  }

  async function save() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const payload = links.length === 0 ? null : normaliseNavigation(links)
      const res = await fetch('/api/dashboard/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteContent: { navigation: payload } }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'The menu could not be saved.')
        return
      }
      setNotice(
        links.length === 0
          ? 'Cleared. The site is back to its standard menu once you publish.'
          : 'Saved as a draft. The menu appears on your site after you publish from Settings.',
      )
      router.refresh()
    } catch {
      setError('The menu could not be saved. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="menu-editor" className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 sm:p-5">
      <h2 id="menu-editor" className="text-sm font-semibold text-foreground">
        Menu links
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{describeNavigation(links)}</p>

      <p aria-live="polite" className="sr-only">
        {notice ?? error ?? ''}
      </p>

      {links.length === 0 ? (
        <p className="mt-3 text-sm text-foreground/90">
          No menu of your own. The site shows Home, Services, Barbers, About and Contact.
        </p>
      ) : (
        <ol className="mt-3 space-y-4">
          {links.map((link, index) => (
            <li key={index} className="rounded-lg border border-border p-3">
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="flex-1">
                  <Label htmlFor={`nav-label-${index}`}>Name</Label>
                  <Input
                    id={`nav-label-${index}`}
                    value={link.label}
                    maxLength={NAV_LABEL_MAX}
                    onChange={(event) => update(index, { label: event.target.value })}
                    className="mt-1 min-h-11"
                  />
                </div>
                <div className="flex-1">
                  <Label htmlFor={`nav-href-${index}`}>Address</Label>
                  <Input
                    id={`nav-href-${index}`}
                    value={link.href}
                    onChange={(event) => update(index, { href: event.target.value })}
                    className="mt-1 min-h-11"
                    placeholder="/services"
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={link.visible}
                    onChange={(event) => update(index, { visible: event.target.checked })}
                    className="h-4 w-4"
                  />
                  Show this link
                </label>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setLinks((current) => moveNavigationItem(current, index, 'up'))}
                  disabled={index === 0}
                  aria-label={`Move ${link.label || 'link'} up`}
                >
                  Up
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setLinks((current) => moveNavigationItem(current, index, 'down'))}
                  disabled={index === links.length - 1}
                  aria-label={`Move ${link.label || 'link'} down`}
                >
                  Down
                </Button>
                <Button type="button" variant="outline" className="min-h-11" onClick={() => removeLink(index)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {!verdict.valid && (
        <ul role="alert" className="mt-3 space-y-1 text-sm text-destructive">
          {verdict.errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={save} disabled={busy || !verdict.valid}>
          {busy ? 'Saving…' : 'Save menu'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full sm:w-auto"
          onClick={addLink}
          disabled={links.length >= NAV_LINK_LIMIT}
        >
          Add a link
        </Button>
      </div>

      {notice && (
        <p aria-live="polite" className="mt-3 text-sm text-foreground/90">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Links point at a page on this site (starting with /) or a secure https address. At most{' '}
        {NAV_LINK_LIMIT} links.
      </p>
    </section>
  )
}

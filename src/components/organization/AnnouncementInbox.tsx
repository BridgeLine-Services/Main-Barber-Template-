'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * The announcement inbox, and the send form for people allowed to send.
 *
 * Two rules shape this screen. Marking read is one click on one announcement, because it is
 * a private, reversible-looking action with no effect on anybody else. Sending is two
 * clicks, with a sentence in between naming exactly how many open locations will receive
 * it, because it cannot be taken back.
 *
 * Neither action decides anything. The server re-reads the caller's organization and
 * locations from the session, and refuses a send outside the sender's scope or a read mark
 * on an announcement that was not addressed to them. The counts shown here are a courtesy.
 */

export interface AnnouncementItemView {
  id: string
  title: string
  body: string
  senderName: string
  sentOn: string
  sentOnWords: string
  audienceLabel: string
  isNew: boolean
  canMarkRead: boolean
}

export interface ComposeLocation {
  id: string
  name: string
  region: string | null
}

interface Props {
  items: AnnouncementItemView[]
  canSend: boolean
  locations: ComposeLocation[]
  regions: string[]
  emptyCopy: string
}

type AudienceChoice = 'all' | 'region' | 'location'

export function AnnouncementInbox({ items, canSend, locations, regions, emptyCopy }: Props) {
  const router = useRouter()

  // Only the marks made in this visit are tracked locally; the list itself stays the
  // server's, so a refresh can never show a stale "new" badge as permanent truth.
  const [markedHere, setMarkedHere] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [choice, setChoice] = useState<AudienceChoice>('all')
  const [chosenRegions, setChosenRegions] = useState<string[]>([])
  const [chosenLocations, setChosenLocations] = useState<string[]>([])
  const [reviewing, setReviewing] = useState(false)
  const [composeError, setComposeError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const view = useMemo(
    () => items.map((item) => ({ ...item, isNew: item.isNew && !markedHere[item.id] })),
    [items, markedHere],
  )
  const unread = view.filter((item) => item.isNew).length

  const recipients = useMemo(() => {
    if (choice === 'all') return locations
    if (choice === 'region') return locations.filter((location) => location.region && chosenRegions.includes(location.region))
    return locations.filter((location) => chosenLocations.includes(location.id))
  }, [choice, chosenRegions, chosenLocations, locations])

  async function markRead(id: string) {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch(`/api/dashboard/organization/announcements/${id}/read`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'That did not work. It is still marked as new.')
        return
      }
      setMarkedHere((current) => ({ ...current, [id]: true }))
      setNotice('Marked as read.')
      router.refresh()
    } catch {
      setError('The connection dropped. It is still marked as new.')
    } finally {
      setBusy(null)
    }
  }

  function review(event: React.FormEvent) {
    event.preventDefault()
    setComposeError(null)
    setNotice(null)
    if (!title.trim()) {
      setComposeError('An announcement needs a title.')
      return
    }
    if (!message.trim()) {
      setComposeError('An announcement needs a message.')
      return
    }
    if (choice === 'region' && chosenRegions.length === 0) {
      setComposeError('Choose at least one region.')
      return
    }
    if (choice === 'location' && chosenLocations.length === 0) {
      setComposeError('Choose at least one location.')
      return
    }
    if (recipients.length === 0) {
      setComposeError('No open location in your scope matches that audience, so there is nobody to send to.')
      return
    }
    setReviewing(true)
  }

  async function send() {
    setSending(true)
    setComposeError(null)
    try {
      const res = await fetch('/api/dashboard/organization/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: message.trim(),
          audience:
            choice === 'all'
              ? { type: 'all', values: [] }
              : choice === 'region'
                ? { type: 'region', values: chosenRegions }
                : { type: 'location', values: chosenLocations },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setComposeError(typeof data?.error === 'string' ? data.error : 'That did not work. Nothing was sent.')
        return
      }
      const count = typeof data?.deliveredTo === 'number' ? data.deliveredTo : recipients.length
      setNotice(`Sent to ${count} open location${count === 1 ? '' : 's'}. Nobody was emailed or texted.`)
      if (typeof data?.warning === 'string' && data.warning) setError(data.warning)
      setTitle('')
      setMessage('')
      setChoice('all')
      setChosenRegions([])
      setChosenLocations([])
      setReviewing(false)
      router.refresh()
    } catch {
      setComposeError('The connection dropped. Nothing was sent.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div aria-live="polite" role="status" className="min-h-0">
        {notice && (
          <p className="rounded-lg border border-border bg-[var(--dash-surface)] p-3 text-sm text-foreground">{notice}</p>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">
          {error}
        </p>
      )}

      <section aria-labelledby="inbox-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="inbox-heading" className="text-lg font-semibold text-foreground">
            Your announcements
          </h2>
          <p className="text-xs text-muted-foreground">
            {unread === 0 ? 'All read' : `${unread} new`} · {view.length} in your inbox
          </p>
        </div>

        {view.length === 0 ? (
          <div className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
            <p className="text-sm text-muted-foreground">{emptyCopy}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {view.map((item) => (
              <li
                key={item.id}
                className={`rounded-xl border p-4 ${
                  item.isNew ? 'border-[var(--dash-brand)]/40 bg-[var(--dash-surface)]' : 'border-border bg-[var(--dash-surface)]'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="min-w-0 break-words text-base font-semibold text-foreground">
                    {item.isNew && (
                      <span className="mr-2 inline-flex items-center rounded-full border border-[var(--dash-brand)]/50 px-2 py-0.5 align-middle text-[11px] font-medium uppercase tracking-wide text-[var(--dash-brand)]">
                        New
                      </span>
                    )}
                    {item.title}
                  </h3>
                  <time dateTime={item.sentOn || undefined} className="shrink-0 text-xs text-muted-foreground">
                    {item.sentOnWords}
                  </time>
                </div>

                <p className="mt-2 whitespace-pre-line break-words text-sm text-foreground">{item.body}</p>

                <dl className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <div className="flex gap-1">
                    <dt className="font-medium">From</dt>
                    <dd className="min-w-0 break-words">{item.senderName}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="font-medium">Sent to</dt>
                    <dd className="min-w-0 break-words">{item.audienceLabel}</dd>
                  </div>
                </dl>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {item.canMarkRead && item.isNew ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 w-full sm:w-auto"
                      onClick={() => markRead(item.id)}
                      disabled={busy === item.id}
                      aria-label={`Mark “${item.title}” as read`}
                    >
                      {busy === item.id ? 'Saving…' : 'Mark as read'}
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {item.canMarkRead ? 'Read' : 'You cannot mark this one as read.'}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canSend && (
        <section aria-labelledby="send-heading" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <h2 id="send-heading" className="text-lg font-semibold text-foreground">
            Send an announcement
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            It appears in the inbox of people at the open locations you choose. Nobody is emailed or texted, and closed
            locations are never included.
          </p>

          {locations.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              You have no open location to send to yet, so there is nothing to address.
            </p>
          ) : reviewing ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-border p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">About to send</p>
                <p className="mt-1 break-words text-base font-semibold text-foreground">{title.trim()}</p>
                <p className="mt-2 whitespace-pre-line break-words text-sm text-foreground">{message.trim()}</p>
                <p className="mt-3 text-sm text-foreground">
                  To {recipients.length} open location{recipients.length === 1 ? '' : 's'}:{' '}
                  <span className="break-words text-muted-foreground">
                    {choice === 'all' ? 'every location you look after' : recipients.map((location) => location.name).join(', ')}
                  </span>
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  This cannot be unsent. Every recipient can mark it read, and read marks are private to them.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={send} disabled={sending}>
                  {sending ? 'Sending…' : `Send to ${recipients.length} location${recipients.length === 1 ? '' : 's'}`}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 w-full sm:w-auto"
                  onClick={() => setReviewing(false)}
                  disabled={sending}
                >
                  Go back and edit
                </Button>
              </div>
            </div>
          ) : (
            <form className="mt-4 space-y-4" onSubmit={review} noValidate>
              <div className="space-y-1">
                <Label htmlFor="announcement-title">Title</Label>
                <Input
                  id="announcement-title"
                  name="title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                  autoComplete="off"
                  className="min-h-11 text-base"
                  aria-describedby="announcement-title-help"
                />
                <p id="announcement-title-help" className="text-xs text-muted-foreground">
                  One line people can scan in a list.
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="announcement-body">Message</Label>
                <Textarea
                  id="announcement-body"
                  name="body"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={5}
                  maxLength={4000}
                  className="min-h-28 text-base"
                  aria-describedby="announcement-body-help"
                />
                <p id="announcement-body-help" className="text-xs text-muted-foreground">
                  Do not include a customer&apos;s name, contact details or booking details. This is staff-to-staff.
                </p>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-foreground">Who should see it</legend>

                <div className="space-y-2">
                  <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm text-foreground">
                    <input
                      type="radio"
                      name="audience"
                      value="all"
                      checked={choice === 'all'}
                      onChange={() => setChoice('all')}
                      className="h-4 w-4"
                    />
                    Every open location I look after
                  </label>

                  <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm text-foreground">
                    <input
                      type="radio"
                      name="audience"
                      value="region"
                      checked={choice === 'region'}
                      onChange={() => setChoice('region')}
                      className="h-4 w-4"
                      disabled={regions.length === 0}
                    />
                    Regions I look after
                    {regions.length === 0 && <span className="text-xs text-muted-foreground">(no regions set)</span>}
                  </label>

                  {choice === 'region' && (
                    <div className="space-y-1 pl-7">
                      {regions.map((region) => (
                        <label key={region} className="flex min-h-11 items-center gap-3 text-sm text-foreground">
                          <input
                            type="checkbox"
                            value={region}
                            checked={chosenRegions.includes(region)}
                            onChange={(event) =>
                              setChosenRegions((current) =>
                                event.target.checked ? [...current, region] : current.filter((value) => value !== region),
                              )
                            }
                            className="h-4 w-4"
                          />
                          {region}
                        </label>
                      ))}
                    </div>
                  )}

                  <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 text-sm text-foreground">
                    <input
                      type="radio"
                      name="audience"
                      value="location"
                      checked={choice === 'location'}
                      onChange={() => setChoice('location')}
                      className="h-4 w-4"
                    />
                    Chosen locations
                  </label>

                  {choice === 'location' && (
                    <div className="space-y-1 pl-7">
                      {locations.map((location) => (
                        <label key={location.id} className="flex min-h-11 items-center gap-3 text-sm text-foreground">
                          <input
                            type="checkbox"
                            value={location.id}
                            checked={chosenLocations.includes(location.id)}
                            onChange={(event) =>
                              setChosenLocations((current) =>
                                event.target.checked
                                  ? [...current, location.id]
                                  : current.filter((value) => value !== location.id),
                              )
                            }
                            className="h-4 w-4"
                          />
                          <span className="min-w-0 break-words">
                            {location.name}
                            {location.region && <span className="text-xs text-muted-foreground"> · {location.region}</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  {recipients.length} open location{recipients.length === 1 ? '' : 's'} would receive this.
                </p>
              </fieldset>

              {composeError && (
                <p role="alert" className="text-sm text-destructive">
                  {composeError}
                </p>
              )}

              <Button type="submit" className="min-h-11 w-full sm:w-auto">
                Review before sending
              </Button>
            </form>
          )}
        </section>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'

/**
 * Publication status for website content. The editable fields on the settings
 * page are the DRAFT; the unified "Save Changes" action in the page header
 * saves the draft and — for owners — publishes the snapshot in one step
 * (publishing stays owner-only, matching the endpoint's authorization).
 *
 * This card is STATUS ONLY: last published time and whether unpublished
 * draft changes exist. There is deliberately no second publish button — a
 * second control is how the old workflow ended up out of sync.
 */
export function PublishWebsiteCard() {
  const [status, setStatus] = useState<{ publishedAt: string | null; unpublished: boolean } | null>(null)

  async function refresh() {
    try {
      const res = await fetch('/api/dashboard/website-content/publish')
      const data = await res.json()
      if (res.ok) {
        setStatus({ publishedAt: data.publishedAt || null, unpublished: !!data.hasUnpublishedChanges })
      }
    } catch {
      /* status stays unknown; the Save Changes action still works */
    }
  }

  if (status === null) {
    void refresh()
  }

  return (
    <div className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Website publishing</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        One click: <span className="font-medium text-foreground">Save Changes</span> saves your edits and makes them live on
        your website.
      </p>
      <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
        {status === null
          ? 'Checking publication status…'
          : status.publishedAt
            ? `Last published ${new Date(status.publishedAt).toLocaleString()}`
            : 'Never published — your live site currently shows the content as you save it.'}
        {status?.unpublished ? ' · Unpublished draft changes.' : ''}
      </p>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'

/**
 * Draft/publish control for website content. The editable section fields
 * on the settings page are the DRAFT; publishing snapshots them for the
 * public site. Until the first publish the public site shows the live
 * fields (legacy parity).
 */
export function PublishWebsiteCard() {
  const { toast } = useToast()
  const [publishing, setPublishing] = useState(false)
  const [publishedAt, setPublishedAt] = useState<string | null>(null)
  const [unpublished, setUnpublished] = useState(false)
  const [loaded, setLoaded] = useState(false)

  async function refresh() {
    try {
      const res = await fetch('/api/dashboard/website-content/publish')
      const data = await res.json()
      if (res.ok) {
        setPublishedAt(data.publishedAt || null)
        setUnpublished(!!data.hasUnpublishedChanges)
      }
    } catch { /* status stays unknown; publish button still works */ }
    setLoaded(true)
  }

  if (!loaded) {
    void refresh()
    return null
  }

  async function onPublish() {
    setPublishing(true)
    try {
      const res = await fetch('/api/dashboard/website-content/publish', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setPublishedAt(data.publishedAt || new Date().toISOString())
        setUnpublished(false)
        toast({ title: 'Website published', description: 'Your live site now shows the latest content.' })
      } else {
        toast({ title: 'Could not publish', description: data.error || 'Please try again.', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Could not publish', description: 'Network error — please try again.', variant: 'destructive' })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Website publishing</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Section edits above are drafts. Publish to make them live on your website.
      </p>
      <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
        {publishedAt
          ? `Last published ${new Date(publishedAt).toLocaleString()}`
          : 'Never published — your live site currently shows the content as you save it.'}
        {unpublished ? ' · Unpublished draft changes.' : ''}
      </p>
      <div className="mt-3 flex gap-2">
        <Button onClick={onPublish} disabled={publishing} size="sm">
          {publishing ? 'Publishing…' : 'Publish website'}
        </Button>
        <a
          href="/dashboard/website-preview"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          Preview draft
        </a>
      </div>
    </div>
  )
}

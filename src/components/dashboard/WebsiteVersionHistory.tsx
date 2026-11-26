'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface VersionRow {
  id: string
  version: number
  summary: string | null
  publishedAt: string
  description: string
}

/**
 * Published website versions, newest first, with a restore that only ever touches the draft.
 *
 * Restoring is deliberately two steps and says what it will and will not do: the live site
 * keeps showing the current version until the owner publishes, so this is not a destructive
 * one-click rollback.
 */
export function WebsiteVersionHistory() {
  const [state, setState] = useState<{ versions: VersionRow[]; canRestore: boolean } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch('/api/dashboard/website-content/versions')
      const data = await res.json()
      if (res.ok) setState({ versions: data.versions ?? [], canRestore: !!data.canRestore })
      else setState({ versions: [], canRestore: false })
    } catch {
      setState({ versions: [], canRestore: false })
    }
  }

  if (state === null) void load()

  async function restore(id: string, version: number) {
    setBusy(id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/dashboard/website-content/versions/' + id + '/restore', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setNotice(`Version ${version} is now in your draft. Review it, then publish to make it live.`)
        setConfirming(null)
      } else {
        setError(typeof data.error === 'string' ? data.error : 'That version could not be restored.')
      }
    } catch {
      setError('That version could not be restored. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Version history</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Every publish is kept. Restoring an older version puts it back in your draft; your live
        site does not change until you publish again.
      </p>

      {notice && (
        <p className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-foreground" aria-live="polite">
          {notice}
        </p>
      )}
      {error && (
        <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-foreground" role="alert">
          {error}
        </p>
      )}

      {state && state.versions.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Nothing published yet. Your first publish creates version 1.
        </p>
      )}

      {state && state.versions.length > 0 && (
        <ul className="mt-3 space-y-2">
          {state.versions.map((row) => (
            <li key={row.id} className="rounded-md border border-border p-3">
              <p className="text-sm font-medium text-foreground">Version {row.version}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{row.description}</p>
              {state.canRestore && (
                confirming === row.id ? (
                  <div className="mt-2">
                    <p className="text-xs text-foreground/90">
                      Put version {row.version} into your draft? Your live site stays as it is until you publish.
                    </p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <Button className="min-h-11 w-full sm:w-auto" onClick={() => restore(row.id, row.version)} disabled={busy !== null}>
                        {busy === row.id ? 'Restoring…' : 'Yes, restore to draft'}
                      </Button>
                      <Button className="min-h-11 w-full sm:w-auto" variant="outline" onClick={() => setConfirming(null)} disabled={busy !== null}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    className="mt-2 min-h-11 w-full sm:w-auto"
                    variant="outline"
                    onClick={() => setConfirming(row.id)}
                    aria-label={`Restore version ${row.version} into the draft`}
                  >
                    Restore this version
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

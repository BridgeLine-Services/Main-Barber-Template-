'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * Where an invitation link lands.
 *
 * The link carries the token; the person carries the session. This page sends the token
 * to the server, which checks it against the signed-in email, so a forwarded link tells
 * the wrong person that it is not theirs rather than quietly letting them in. Nothing
 * happens until the person presses the button.
 */
export default function AcceptOrganizationInvitationPage() {
  const [token, setToken] = useState('')
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'failed'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('token') ?? ''
    setToken(fromUrl)
    if (!fromUrl) {
      setState('failed')
      setMessage('This link is missing its invitation code. Ask the person who invited you to send it again.')
    }
  }, [])

  async function accept() {
    setState('working')
    setMessage('')
    try {
      const response = await fetch('/api/auth/accept-organization-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        setState('failed')
        setMessage(body.error || 'We could not accept this invitation. It may have expired.')
        return
      }
      setState('done')
      setMessage('You now have access to this organization. Your own shop and its records are unchanged.')
    } catch {
      setState('failed')
      setMessage('We could not reach the server. Check your connection and try again.')
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-2xl font-bold text-foreground">Join an organization</h1>

      {state === 'done' ? (
        <>
          <p className="text-sm text-muted-foreground">{message}</p>
          <Link
            href="/dashboard/organization"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground"
          >
            Open the organization overview
          </Link>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            You are signed in. Press the button to accept, and we will check that this invitation was meant for your
            email address.
          </p>
          <button
            type="button"
            onClick={accept}
            disabled={state === 'working' || !token}
            className="min-h-11 rounded-lg bg-foreground px-4 text-sm font-medium text-background disabled:opacity-60"
          >
            {state === 'working' ? 'Checking…' : 'Accept invitation'}
          </button>
          {message && (
            <p role="status" className="text-sm text-red-400">
              {message}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Not you? <Link href="/login" className="underline">Sign in with the invited address</Link>.
          </p>
        </>
      )}
    </main>
  )
}

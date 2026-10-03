'use client'

import { useEffect, useState, FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'

interface InviteInfo {
  valid: boolean
  reason?: string
  email?: string
  name?: string
  role?: string
  businessName?: string
  // The invited email already has an account (e.g. a customer being invited
  // to become staff) — acceptance happens by signing in with that account,
  // never by creating a duplicate account.
  existingAccount?: boolean
}

const REASON_TEXT: Record<string, string> = {
  invalid: 'This invitation link is not valid. Please ask your manager to send a new one.',
  revoked: 'This invitation was revoked. Please ask your manager to send a new one.',
  'already-used': 'This invitation was already used. Try signing in instead.',
  expired: 'This invitation has expired. Please ask your manager to send a new one.',
  'business-unavailable': 'This business is no longer available.',
}

export function AcceptInvitationForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [linkPassword, setLinkPassword] = useState('')
  const [linking, setLinking] = useState(false)

  useEffect(() => {
    if (!token) { setInvite({ valid: false, reason: 'invalid' }); return }
    fetch(`/api/auth/accept-invitation?token=${encodeURIComponent(token)}`)
      .then(res => res.json())
      .then(setInvite)
      .catch(() => setInvite({ valid: false, reason: 'invalid' }))
  }, [token])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== confirmPassword) { setError('Passwords do not match'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/accept-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to accept invitation'); setLoading(false); return }
      const result = await signIn('credentials', {
        email: invite?.email,
        password,
        redirect: false,
        callbackUrl: '/auth/redirect',
      })
      if (result?.ok) {
        window.location.assign(result.url ?? '/auth/redirect')
      } else {
        setError('Account created! Please sign in now.')
        setLoading(false)
      }
    } catch {
      setError('Failed to connect to the server. Please try again.')
      setLoading(false)
    }
  }

  // Existing account: authenticate as the invited account, then accept.
  // The server re-verifies that the session owns the invited email.
  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLinking(true)
    try {
      const result = await signIn('credentials', {
        email: invite?.email,
        password: linkPassword,
        redirect: false,
      })
      if (!result?.ok) {
        setError('That password didn’t match this account. Please try again.')
        setLinking(false)
        return
      }
      const res = await fetch('/api/auth/accept-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to accept invitation')
        setLinking(false)
        return
      }
      // The account was just promoted to staff, but the session token still
      // carries the old CUSTOMER role (JWTs are minted at sign-in). Sign in
      // again so the session reflects the new role before routing.
      const refreshed = await signIn('credentials', {
        email: invite?.email,
        password: linkPassword,
        redirect: false,
      })
      if (!refreshed?.ok) {
        // Linking succeeded — route anyway; the next regular sign-in gets the
        // correct role. Do not show a confusing error here.
      }
      router.push('/auth/redirect')
    } catch {
      setError('Failed to connect to the server. Please try again.')
      setLinking(false)
    }
  }

  const inputCls = "w-full px-4 py-3 rounded-lg bg-zinc-800/50 border border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
  const labelCls = "block text-xs font-medium text-zinc-400 mb-2"

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col justify-center items-center p-4 text-zinc-100">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight font-serif">You&apos;re invited</h1>
          <p className="text-sm text-zinc-400 mt-1">Join your team at {invite?.businessName || 'the shop'}</p>
        </div>

        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
          {invite === null ? (
            <p className="text-sm text-zinc-400 text-center py-6">Checking your invitation…</p>
          ) : invite.valid ? (
            <>
              {error && (
                <div className="mb-6 p-3.5 rounded-lg bg-red-950/50 border border-red-800/50 text-red-300 text-sm">{error}</div>
              )}
              <div className="mb-6 p-3.5 rounded-lg bg-zinc-800/40 border border-zinc-700/60 text-sm space-y-1">
                {invite.existingAccount ? null : <p><span className="text-zinc-400">Name:</span> {invite.name}</p>}
                <p><span className="text-zinc-400">Email:</span> {invite.email}</p>
                <p><span className="text-zinc-400">Role:</span> <span className="capitalize">{invite.role?.toLowerCase().replace('_', ' ')}</span></p>
              </div>
              {invite.existingAccount ? (
                <form onSubmit={handleLink} className="space-y-5">
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    You already have an account with this email. Enter its password to accept the invitation
                    {' '}— your existing account will be linked to this team, and your password stays the same.
                  </p>
                  <div>
                    <label htmlFor="link-password" className={labelCls}>Password for your existing account</label>
                    <input
                      id="link-password"
                      type="password"
                      className={inputCls}
                      value={linkPassword}
                      onChange={e => setLinkPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      placeholder="Your existing password"
                    />
                  </div>
                  <button type="submit" disabled={linking || !linkPassword}
                    className="w-full py-3 rounded-lg bg-amber-500 text-zinc-950 font-bold text-sm hover:bg-amber-400 transition-colors disabled:opacity-50">
                    {linking ? 'Accepting…' : 'Login & Accept Invitation'}
                  </button>
                </form>
              ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="password" className={labelCls}>Choose a password</label>
                  <input id="password" type="password" className={inputCls} value={password} onChange={e => setPassword(e.target.value)} required minLength={8} placeholder="At least 8 characters" />
                </div>
                <div>
                  <label htmlFor="confirm" className={labelCls}>Confirm password</label>
                  <input id="confirm" type="password" className={inputCls} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} />
                </div>
                <button type="submit" disabled={loading || !password || !confirmPassword}
                  className="w-full py-3 rounded-lg bg-amber-500 text-zinc-950 font-bold text-sm hover:bg-amber-400 transition-colors disabled:opacity-50">
                  {loading ? 'Creating your account…' : 'Accept invitation'}
                </button>
              </form>
              )}
            </>
          ) : (
            <div className="text-center space-y-4">
              <p className="text-sm text-red-300">{REASON_TEXT[invite.reason || 'invalid']}</p>
              <Link href="/login" className="inline-block text-xs text-zinc-400 hover:text-amber-400 transition-colors">Go to Login</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

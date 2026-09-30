'use client'

// ============================================================================
// CUSTOMER SIGNUP — the public self-service account page. Always creates a
// CUSTOMER account (role decided server-side by /api/auth/register). The
// owner-onboarding signup lives at /login; staff accounts are created only
// via the invitation lifecycle.
// ============================================================================

import { useState, FormEvent } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'

export function RegisterForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Registration failed')
        setLoading(false)
        return
      }
      // Auto-login, then the server routes by role (/auth/redirect → /portal)
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl: '/auth/redirect',
      })
      if (result?.ok) {
        window.location.assign(result.url ?? '/auth/redirect')
      } else {
        setError('Account created! Please sign in.')
        setLoading(false)
      }
    } catch {
      setError('Failed to connect to the server. Please try again.')
      setLoading(false)
    }
  }

  const inputCls = "w-full px-4 py-3 rounded-lg bg-zinc-800/50 border border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
  const labelCls = "block text-xs font-medium text-zinc-400 mb-2"

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col justify-center items-center p-4 text-zinc-100">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight font-serif">Create your account</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Book faster, see your appointment history, and manage your visits.
          </p>
        </div>

        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
          {error && (
            <div className="mb-6 p-3.5 rounded-lg bg-red-950/50 border border-red-800/50 text-red-300 text-sm">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="name" className={labelCls}>Full name</label>
              <input id="name" className={inputCls} value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={100} placeholder="Alex Johnson" />
            </div>
            <div>
              <label htmlFor="email" className={labelCls}>Email</label>
              <input id="email" type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" />
            </div>
            <div>
              <label htmlFor="password" className={labelCls}>Password</label>
              <input id="password" type="password" className={inputCls} value={password} onChange={e => setPassword(e.target.value)} required minLength={8} placeholder="At least 8 characters" />
            </div>
            <div>
              <label htmlFor="confirmPassword" className={labelCls}>Confirm password</label>
              <input id="confirmPassword" type="password" className={inputCls} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} />
            </div>
            <button
              type="submit"
              disabled={loading || !name || !email || !password || !confirmPassword}
              className="w-full py-3 rounded-lg bg-amber-500 text-zinc-950 font-bold text-sm hover:bg-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
          <div className="mt-6 pt-5 border-t border-zinc-800/60 text-center">
            <Link href="/login" className="text-xs text-zinc-400 hover:text-amber-400 transition-colors">
              Already have an account? Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

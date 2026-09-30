'use client'

// ============================================================================
// CUSTOMER SIGNUP — the public self-service account page. Always creates a
// CUSTOMER account (role decided server-side by /api/auth/register). The
// owner-onboarding signup lives at /login; staff accounts are created only
// via the invitation lifecycle.
//
// Design: the companion panel to the redesigned login — the same editorial
// brand/auth split, theme tokens, spacing, form language, focus/error/
// loading states, and responsive behavior. Login and signup read as two
// states of one authentication experience. All registration logic is
// unchanged.
// ============================================================================

import { useState, FormEvent } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { ArrowRight, ArrowLeft, Mail, Lock, User, AlertCircle } from 'lucide-react'

export function RegisterForm({ businessName }: { businessName?: string | null }) {
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

  const shopName = businessName?.trim() || 'The Barbershop'

  const inputCls =
    'w-full h-11 pl-10 rounded-md bg-background border-input text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring'
  const labelCls = 'eyebrow block mb-2'

  return (
    <div className="min-h-screen bg-background text-foreground grid lg:grid-cols-[55%_45%]">
      {/* ─── Brand panel (desktop) — same composition and tokens as login */}
      <aside className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden border-r border-border/60">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-accent/[0.05]" />
          <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-primary/[0.05] blur-3xl" />
        </div>

        <Link href="/" className="relative z-10 flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors duration-micro">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to website
        </Link>

        <div className="relative z-10 max-w-md">
          <p className="eyebrow-accent mb-5">Customer access</p>
          <h1 className="display-heading text-display-1 text-foreground">
            Your chair, your history.
          </h1>
          <p className="mt-6 text-large text-muted-foreground leading-relaxed">
            Create an account to book faster at {shopName}, see your appointment history, and
            manage upcoming visits.
          </p>
        </div>

        <div className="relative z-10 hairline pt-6 text-xs text-muted-foreground">
          {shopName} · Online booking, scheduling, and customer management
        </div>
      </aside>

      {/* ─── Signup panel */}
      <main className="flex flex-col justify-center px-5 py-10 sm:px-10 lg:px-14">
        {/* Compact brand intro for mobile */}
        <div className="lg:hidden mb-10">
          <p className="eyebrow-accent mb-3">Customer access</p>
          <h1 className="display-heading text-display-3 text-foreground">Create your account.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Book faster and manage your visits at {shopName}.
          </p>
        </div>

        <div className="w-full max-w-md mx-auto lg:mx-0">
          {/* Desktop heading (mobile has its own above) */}
          <div className="hidden lg:block mb-8">
            <h2 className="display-heading text-display-3 text-foreground">Create your account.</h2>
            <p className="mt-2 text-sm text-muted-foreground">Registration takes less than a minute.</p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-6 p-3.5 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm flex items-start gap-3"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="name" className={labelCls}>Full name</label>
              <div className="relative">
                <User className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70" aria-hidden="true" />
                <input id="name" className={inputCls} value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={100} placeholder="Alex Johnson" autoComplete="name" />
              </div>
            </div>
            <div>
              <label htmlFor="email" className={labelCls}>Email</label>
              <div className="relative">
                <Mail className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70" aria-hidden="true" />
                <input id="email" type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" autoComplete="email" />
              </div>
            </div>
            <div>
              <label htmlFor="password" className={labelCls}>Password</label>
              <div className="relative">
                <Lock className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70" aria-hidden="true" />
                <input id="password" type="password" className={inputCls} value={password} onChange={e => setPassword(e.target.value)} required minLength={8} placeholder="At least 8 characters" autoComplete="new-password" />
              </div>
            </div>
            <div>
              <label htmlFor="confirmPassword" className={labelCls}>Confirm password</label>
              <div className="relative">
                <Lock className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70" aria-hidden="true" />
                <input id="confirmPassword" type="password" className={inputCls} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !name || !email || !password || !confirmPassword}
              className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-sm transition-all duration-micro focus-ring disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" aria-hidden="true" />
                  Creating account…
                </>
              ) : (
                <>
                  <span>Create account</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 hairline pt-5 text-center">
            <Link href="/login" className="text-sm text-muted-foreground hover:text-primary transition-colors duration-micro">
              Already have an account? <span className="text-primary font-medium">Sign in</span>
            </Link>
          </div>

          {/* Mobile-only return link (desktop has it in the brand panel) */}
          <div className="mt-8 text-center lg:hidden">
            <Link href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors duration-micro">
              ← Back to website
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}

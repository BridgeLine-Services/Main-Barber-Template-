'use client'

// Login + owner registration form. The registration UI adapts to the
// deployment's OWNER_REGISTRATION_MODE (read server-side in page.tsx):
//   onboarding  → full sign-up flow (default)
//   invite_only → unified public Sign-Up (CUSTOMER); staff accounts
//                          are created only by owner invitation
//   disabled    → sign-up hidden entirely, existing users only
//
// Design: editorial split layout (Sections 8/9). The left panel carries the
// shop's brand (name, display typography, accent, theme colors injected by
// ThemeStyle in page.tsx); the right panel is the authentication surface.
// Everything renders from theme tokens — background, foreground, card,
// primary, muted, border — so each shop's branding provides the voice and
// the template provides the grammar. All auth logic is unchanged.

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Lock, Mail, AlertCircle, ArrowRight, ArrowLeft, User } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface RegistrationModeProps {
  registrationMode: 'onboarding' | 'invite_only' | 'disabled'
  /** Resolved shop name for the brand panel (server-provided). */
  businessName?: string | null
}

export default function LoginForm({ registrationMode, businessName }: RegistrationModeProps) {
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<'login' | 'register'>('login') // register only reachable when openRegistration
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const errorParam = searchParams.get('error')
    if (errorParam) {
      setError('Authentication error. Please try again.')
    }
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (mode === 'register') {
        // OWNER_REGISTRATION_MODE=onboarding keeps the register tab as the
        // controlled owner-provisioning flow (gated server-side by the mode).
        // Every other state is the unified public Sign-Up: the server always
        // assigns CUSTOMER (/api/auth/register accepts no role field), and
        // staff roles come only from the invitation lifecycle.
        const isOwnerOnboarding = registrationMode === 'onboarding'
        const res = await fetch(isOwnerOnboarding ? '/api/auth/register-owner' : '/api/auth/register', {
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
        // Auto-login after registration
        const result = await signIn('credentials', {
          email,
          password,
          redirect: false,
          callbackUrl: '/auth/redirect',
        })
        if (result?.ok) {
          window.location.assign(result.url ?? '/auth/redirect')
        } else {
          // Registration worked but auto-login failed — switch to login mode
          setMode('login')
          setError('Account created! Please sign in with your credentials.')
          setLoading(false)
        }
      } else {
        // Login
        // Unified login: the server routes by role at /auth/redirect
        // (CUSTOMER → /portal, staff/owner → /dashboard or onboarding).
        const result = await signIn('credentials', {
          email,
          password,
          redirect: false,
          callbackUrl: '/auth/redirect',
        })

        if (result?.error) {
          if (result.error === 'Configuration') {
            setError('Server configuration error. The database may not be connected. Please contact the site administrator.')
          } else {
            setError('Invalid email or password. Please try again.')
          }
          setLoading(false)
        } else if (result?.ok) {
          window.location.assign(result.url ?? '/dashboard')
        } else {
          setError('An unexpected error occurred. Please try again.')
          setLoading(false)
        }
      }
    } catch (_err) {
      setError('Failed to connect to the server. Please try again.')
      setLoading(false)
    }
  }

  const openRegistration = registrationMode !== 'disabled'
  const shopName = businessName?.trim() || 'The Barbershop'

  const switchMode = () => {
    setMode(m => (m === 'login' ? 'register' : 'login'))
    setError(null)
  }

  return (
    <div className="min-h-screen bg-background text-foreground grid lg:grid-cols-[55%_45%]">
      {/* ─── Brand panel (desktop) ────────────────────────────────────────
           Photographic/editorial brand area. Uses theme colors only, so it
           adapts to every shop's palette (dark luxury, light modern, gold,
           warm neutral, colorful contemporary). Hidden on mobile, where a
           compact brand intro renders above the form instead. */}
      <aside className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden border-r border-border/60">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {/* Subtle tonal texture built from theme tokens — no image dependency */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-accent/[0.05]" />
          <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-primary/[0.05] blur-3xl" />
        </div>

        <Link href="/" className="relative z-10 flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors duration-micro">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to website
        </Link>

        <div className="relative z-10 max-w-md">
          <h1 className="display-heading text-display-1 text-foreground">
            {mode === 'login' ? 'Login' : 'Sign Up'}
          </h1>
          <p className="mt-6 text-large text-muted-foreground leading-relaxed">
            {mode === 'login'
              ? 'Sign in to continue.'
              : registrationMode === 'onboarding'
                ? `Create your owner account and set up ${shopName} in minutes.`
                : `Create an account to book faster at ${shopName}.`}
          </p>
        </div>

        <div className="relative z-10 hairline pt-6 text-xs text-muted-foreground">
          {shopName} · Online booking, scheduling, and customer management
        </div>
      </aside>

      {/* ─── Authentication panel ───────────────────────────────────────── */}
      <main className="flex flex-col justify-center px-5 py-10 sm:px-10 lg:px-14">
        {/* Compact brand intro for mobile */}
        <div className="lg:hidden mb-10">
          <h1 className="display-heading text-display-3 text-foreground">
            {mode === 'login' ? 'Login' : 'Sign Up'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === 'login'
              ? 'Sign in to continue.'
              : registrationMode === 'onboarding'
                ? `Set up ${shopName} in minutes.`
                : `Book faster at ${shopName}.`}
          </p>
        </div>

        <div className="w-full max-w-md mx-auto lg:mx-0">
          {/* Desktop heading (mobile has its own above) */}
          <div className="hidden lg:block mb-8">
            <h2 className="display-heading text-display-3 text-foreground">
              {mode === 'login' ? 'Welcome back.' : 'Create your account.'}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {mode === 'login'
                ? 'Sign in to continue.'
                : registrationMode === 'onboarding'
                  ? 'Registration takes less than a minute.'
                  : 'Create an account to manage your appointments and bookings.'}
            </p>
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

          <form onSubmit={handleSubmit} className="space-y-5" noValidate={false}>
            {mode === 'register' && (
              <div className="space-y-2">
                <Label htmlFor="name" className="eyebrow">
                  Your name
                </Label>
                <div className="relative">
                  <User className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70" aria-hidden="true" />
                  <Input
                    id="name"
                    type="text"
                    placeholder="John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoComplete="name"
                    className="pl-10 h-11 bg-background border-input text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-ring/30"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="eyebrow">
                Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" aria-hidden="true" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="pl-10 h-11 bg-background border-input text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-ring/30"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="password" className="eyebrow">
                  Password
                </Label>
                {mode === 'login' && (
                  <Link
                    href="/forgot-password"
                    className="text-xs text-muted-foreground hover:text-primary transition-colors duration-micro"
                  >
                    Forgot password?
                  </Link>
                )}
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" aria-hidden="true" />
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pl-10 h-11 bg-background border-input text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-ring/30"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold transition-all duration-micro focus-ring disabled:opacity-50 disabled:cursor-not-allowed group"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span
                    className="h-4 w-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin"
                    aria-hidden="true"
                  />
                  <span>{mode === 'login' ? 'Signing in…' : 'Creating account…'}</span>
                </span>
              ) : (
                <>
                  <span>{mode === 'login' ? 'Sign In' : 'Create Account'}</span>
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-micro group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </>
              )}
            </Button>
          </form>

          {/* Registration switch — adapts to OWNER_REGISTRATION_MODE */}
          {openRegistration ? (
            <div className="mt-8 hairline pt-5 text-center">
              <button
                onClick={switchMode}
                className="text-sm text-muted-foreground hover:text-primary transition-colors duration-micro focus-ring rounded-sm px-2 py-1"
              >
                {mode === 'login' ? (
                  <>Don&apos;t have an account? <span className="text-primary font-medium">Create one</span></>
                ) : (
                  <>Already have an account? <span className="text-primary font-medium">Sign in</span></>
                )}
              </button>
              {registrationMode === 'invite_only' && mode === 'login' && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Staff accounts are created by invitation only.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-8 hairline pt-5 text-center">
              <p className="text-sm text-muted-foreground">
                Registration is currently closed. Contact your administrator if you need access.
              </p>
            </div>
          )}

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

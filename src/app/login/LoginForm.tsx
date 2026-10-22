'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Lock, Mail, AlertCircle, ArrowRight, ArrowLeft, User, CheckCircle2, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { OwnerRegistrationMode } from '@/lib/owner-registration'

export interface LoginFormProps {
  /** Resolved shop name for the brand panel (server-provided). */
  businessName?: string | null
  ownerRegistrationMode?: OwnerRegistrationMode
  ownerRegistrationOpen?: boolean
  customerRegistrationOpen?: boolean
}

type FormMode = 'login' | 'owner' | 'customer'

const OWNER_REGISTRATION_CLOSED_HINT =
  'An owner account already exists for this shop. Owner registration is closed — sign in as the owner, or create a customer account below.'

export default function LoginForm({
  businessName,
  ownerRegistrationMode = 'onboarding',
  ownerRegistrationOpen = true,
  customerRegistrationOpen = false,
}: LoginFormProps) {
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<FormMode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const ownerOnboardingOpen = ownerRegistrationMode === 'onboarding' && ownerRegistrationOpen
  // Server-driven guard: the owner form can only ever render while the server
  // said first-owner registration is open. When an owner exists the affordance
  // disappears entirely and a clear explanation is shown instead.
  const effectiveMode: FormMode =
    mode === 'owner' && !ownerOnboardingOpen
      ? 'login'
      : mode === 'customer' && !customerRegistrationOpen
        ? 'login'
        : mode
  const authError = searchParams.get('error') ? 'Authentication error. Please try again.' : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)

    if (effectiveMode === 'owner' && confirmPassword !== password) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    try {
      if (effectiveMode !== 'login') {
        // Registration: the client states only which flow it is (owner or
        // customer). The SERVER decides the role — /api/auth/register accepts
        // no role field, and an owner request is rejected (never silently
        // downgraded to a customer) once an owner exists.
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email,
            password,
            intent: effectiveMode === 'owner' ? 'owner' : 'customer',
            ...(effectiveMode === 'owner' ? { confirmPassword } : {}),
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          if (data?.code === 'OWNER_REGISTRATION_CLOSED') {
            // Someone claimed the owner slot between page load and submit.
            setError(data.error || 'Owner registration is closed.')
            setMode('login')
          } else {
            setError(data.error || 'Registration failed')
          }
          setLoading(false)
          return
        }
        // Auto-login after registration; the server routes by role at
        // /auth/redirect (OWNER → /dashboard → onboarding, CUSTOMER → /portal).
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

  const shopName = businessName?.trim() || 'The Barbershop'

  const switchMode = (next: FormMode) => {
    setMode(next)
    setError(null)
    setNotice(null)
  }

  const visibleError = error ?? authError
  const visibleNotice = notice
  const passwordChanged = searchParams.get('passwordChanged') === '1'

  const heading = effectiveMode === 'login' ? 'Login' : effectiveMode === 'owner' ? 'Create Owner Account' : 'Create Customer Account'

  const introCopy =
    effectiveMode === 'login'
      ? ownerOnboardingOpen
        ? 'Create the first owner account or sign in to resume setup.'
        : customerRegistrationOpen
          ? 'Sign in to your account, or create a customer account to book faster.'
          : 'Sign in to continue your account access.'
      : effectiveMode === 'owner'
        ? 'Create the owner account for this shop and continue into the onboarding wizard.'
        : 'Create your customer account to book and manage appointments online.'

  return (
    <div className="min-h-screen bg-background text-foreground grid lg:grid-cols-[55%_45%]">
      {/* ─── Brand panel (desktop) ────────────────────────────────────────
           Photographic/editorial brand area. Uses theme colors only, so it
           adapts to every shop's palette (dark luxury, light modern, gold,
           warm neutral, colorful contemporary). Hidden on mobile, where a
           compact brand intro renders above the form instead. */}
      <aside className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden">
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
            {heading}
          </h1>
          <p className="mt-6 text-large text-muted-foreground leading-relaxed">
            {introCopy}
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
            {heading}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{introCopy}</p>
        </div>

        <div className="w-full max-w-md mx-auto lg:mx-0">
          {/* Desktop heading (mobile has its own above) */}
          <div className="hidden lg:block mb-8">
            <h2 className="display-heading text-display-3 text-foreground">
              {heading}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{introCopy}</p>
          </div>

          {passwordChanged && (
            <div
              role="status"
              className="mb-6 p-3.5 rounded-md border border-border bg-muted text-foreground text-sm flex items-start gap-3"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-primary" aria-hidden="true" />
              <span>Password updated. Sign in with your new password.</span>
            </div>
          )}
          {effectiveMode === 'login' && !ownerOnboardingOpen && ownerRegistrationMode === 'onboarding' && (
            <div
              role="status"
              className="mb-6 p-3.5 rounded-md border border-border bg-muted text-foreground text-sm flex items-start gap-3"
            >
              <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-primary" aria-hidden="true" />
              <span>{OWNER_REGISTRATION_CLOSED_HINT}</span>
            </div>
          )}
          {visibleNotice && (
            <div
              role="status"
              className="mb-6 p-3.5 rounded-md border border-border bg-muted text-foreground text-sm flex items-start gap-3"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-primary" aria-hidden="true" />
              <span>{visibleNotice}</span>
            </div>
          )}
          {visibleError && (
            <div
              role="alert"
              className="mb-6 p-3.5 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm flex items-start gap-3"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" aria-hidden="true" />
              <span>{visibleError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate={false}>
            {effectiveMode !== 'login' && (
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
                {effectiveMode === 'login' && (
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
                  autoComplete={effectiveMode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  aria-describedby={effectiveMode !== 'login' ? 'password-requirements' : undefined}
                  className="pl-10 h-11 bg-background border-input text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-ring/30"
                />
              </div>
              {effectiveMode !== 'login' && (
                <p id="password-requirements" className="text-xs text-muted-foreground">
                  At least 10 characters with an uppercase letter, a lowercase letter, and a number.
                </p>
              )}
            </div>

            {effectiveMode === 'owner' && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="eyebrow">
                  Confirm password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" aria-hidden="true" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="pl-10 h-11 bg-background border-input text-foreground placeholder:text-muted-foreground/60 focus-visible:ring-ring/30"
                  />
                </div>
              </div>
            )}

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
                  <span>
                    {effectiveMode === 'login' ? 'Logging in…' : effectiveMode === 'owner' ? 'Creating owner account…' : 'Creating account…'}
                  </span>
                </span>
              ) : (
                <>
                  <span>{heading}</span>
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-micro group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </>
              )}
            </Button>
          </form>

          {effectiveMode === 'login' ? (
            <div className="mt-8 hairline pt-5 space-y-3 text-center">
              {ownerOnboardingOpen && (
                <button
                  type="button"
                  onClick={() => switchMode('owner')}
                  className="w-full text-sm text-muted-foreground hover:text-primary transition-colors duration-micro focus-ring rounded-sm px-2 py-1"
                >
                  Setting up this shop?{' '}
                  <span className="text-primary font-medium">Create Owner Account</span>
                </button>
              )}
              {customerRegistrationOpen && (
                <button
                  type="button"
                  onClick={() => switchMode('customer')}
                  className="w-full text-sm text-muted-foreground hover:text-primary transition-colors duration-micro focus-ring rounded-sm px-2 py-1"
                >
                  Booking an appointment?{' '}
                  <span className="text-primary font-medium">Create Customer Account</span>
                </button>
              )}
              {!ownerOnboardingOpen && !customerRegistrationOpen && (
                ownerRegistrationMode === 'invite_only' ? (
                  <div className="text-sm text-muted-foreground">
                    Account creation is currently by invitation. Existing owners and invited staff can sign in above.
                  </div>
                ) : null
              )}
            </div>
          ) : (
            <div className="mt-8 hairline pt-5 text-center space-y-3">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-sm text-muted-foreground hover:text-primary transition-colors duration-micro focus-ring rounded-sm px-2 py-1"
              >
                Already have an account? <span className="text-primary font-medium">Sign In</span>
              </button>
              {effectiveMode === 'owner' && customerRegistrationOpen && (
                <button
                  type="button"
                  onClick={() => switchMode('customer')}
                  className="block w-full text-sm text-muted-foreground hover:text-primary transition-colors duration-micro focus-ring rounded-sm px-2 py-1"
                >
                  Want to book instead? <span className="text-primary font-medium">Create Customer Account</span>
                </button>
              )}
              {effectiveMode === 'customer' && ownerOnboardingOpen && (
                <button
                  type="button"
                  onClick={() => switchMode('owner')}
                  className="block w-full text-sm text-muted-foreground hover:text-primary transition-colors duration-micro focus-ring rounded-sm px-2 py-1"
                >
                  Setting up this shop? <span className="text-primary font-medium">Create Owner Account</span>
                </button>
              )}
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

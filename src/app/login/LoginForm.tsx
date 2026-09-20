'use client'

// Login + owner registration form. The registration UI adapts to the
// deployment's OWNER_REGISTRATION_MODE (read server-side in page.tsx):
//   onboarding  → full sign-up flow (default)
//   invite_only → sign-up hidden, invitation notice shown
//   disabled    → sign-up hidden entirely, existing users only

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Scissors, Lock, Mail, AlertCircle, ArrowRight, User } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface RegistrationModeProps {
  registrationMode: 'onboarding' | 'invite_only' | 'disabled'
}

export default function LoginForm({ registrationMode }: RegistrationModeProps) {
  const router = useRouter()
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
        // Register new owner account
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
        // Auto-login after registration
        const result = await signIn('credentials', {
          email,
          password,
          redirect: false,
        })
        if (result?.ok) {
          router.push('/dashboard')
        } else {
          // Registration worked but auto-login failed — switch to login mode
          setMode('login')
          setError('Account created! Please sign in with your credentials.')
          setLoading(false)
        }
      } else {
        // Login
        const result = await signIn('credentials', {
          email,
          password,
          redirect: false,
        })

        if (result?.error) {
          if (result.error === 'Configuration') {
            setError('Server configuration error. The database may not be connected. Please contact the site administrator.')
          } else {
            setError('Invalid email or password. Please try again.')
          }
          setLoading(false)
        } else if (result?.ok) {
          router.push('/dashboard')
        } else {
          setError('An unexpected error occurred. Please try again.')
          setLoading(false)
        }
      }
    } catch (err) {
      setError('Failed to connect to the server. Please try again.')
      setLoading(false)
    }
  }

  const openRegistration = registrationMode === 'onboarding'

  const switchMode = () => {
    setMode(m => m === 'login' ? 'register' : 'login')
    setError(null)
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col justify-center items-center p-4 text-zinc-100">
      {/* Background Subtle Gradient */}

      <div className="w-full max-w-md relative z-10">
        {/* Header Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-500 mb-4 shadow-lg shadow-amber-500/5">
            <Scissors className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100 font-serif">
            Barber Dashboard
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            {mode === 'login' ? 'Sign in to manage your shop' : 'Create your owner account'}
          </p>
        </div>

        {/* Card Form */}
        <div className="bg-zinc-900/90 border border-zinc-800 backdrop-blur-md rounded-2xl p-6 sm:p-8 shadow-2xl">
          {error && (
            <div className="mb-6 p-3.5 rounded-lg bg-red-950/50 border border-red-800/50 text-red-300 text-sm flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === 'register' && (
              <div className="space-y-2">
                <Label htmlFor="name" className="text-zinc-300 text-xs font-medium uppercase tracking-wider">
                  Your Name
                </Label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <Input
                    id="name"
                    type="text"
                    placeholder="John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="pl-10 bg-zinc-950/60 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:ring-amber-500/20 h-11"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-zinc-300 text-sm font-medium">
                Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <Input
                  id="email"
                  type="email"
                  placeholder="owner@shop.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-zinc-950/50 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/50 focus:ring-amber-500/20 pl-10"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-zinc-300 text-xs font-medium uppercase tracking-wider">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-zinc-950/50 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/50 focus:ring-amber-500/20 pl-10"
                />
              </div>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-500 text-zinc-950 hover:bg-amber-400 font-bold py-2.5 text-base shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : (
                <>
                  <span>{mode === 'login' ? 'Sign In' : 'Create Account'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </form>

          {/* Forgot password — only meaningful in login mode */}
          {mode === 'login' && (
            <div className="text-right">
              <Link
                href="/forgot-password"
                className="text-xs text-zinc-500 hover:text-amber-400 transition-colors"
              >
                Forgot your password?
              </Link>
            </div>
          )}

          {/* Registration switch — adapts to OWNER_REGISTRATION_MODE */}
          {openRegistration ? (
            <div className="mt-6 pt-5 border-t border-zinc-800/60 text-center">
              <button
                onClick={switchMode}
                className="text-xs text-zinc-400 hover:text-amber-400 transition-colors"
              >
                {mode === 'login'
                  ? "Don't have an account? Create one"
                  : 'Already have an account? Sign in'}
              </button>
            </div>
          ) : (
            <div className="mt-6 pt-5 border-t border-zinc-800/60 text-center">
              {registrationMode === 'invite_only' ? (
                <p className="text-xs text-zinc-500">
                  New accounts are created by invitation only. Please contact your administrator
                  for access.
                </p>
              ) : (
                <p className="text-xs text-zinc-500">
                  Registration is currently closed. Contact your administrator if you need access.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="text-center text-xs text-zinc-600 mt-8 space-y-2">
          <a href="/" className="text-zinc-500 hover:text-amber-400 transition-colors">
            ← Back to Website
          </a>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Mail, ArrowLeft, CheckCircle, Loader2 } from 'lucide-react'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [resetUrl, setResetUrl] = useState('')
  // SMTP not configured in production — the server refuses to pretend an
  // email was sent; surface that honestly instead of a fake success screen.
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await res.json()

      if (data.code === 'RESET_EMAIL_UNAVAILABLE') {
        setUnavailable(true)
        return
      }

      if (data.resetUrl) {
        // Development only — show the link directly
        setResetUrl(data.resetUrl)
      }

      setSuccess(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (unavailable) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-amber-500/20 mx-auto">
            <Mail className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Password Reset Unavailable</h1>
            <p className="text-gray-400 text-sm mt-2">
              Password reset email delivery is not configured on this server. Please contact your
              administrator for help with your account.
            </p>
          </div>
          <Link href="/login" className="inline-flex items-center text-sm text-gray-400 hover:text-primary transition-colors">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mx-auto">
            <CheckCircle className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Check Your Email</h1>
            <p className="text-gray-400 text-sm mt-2">
              If an account exists for {email}, a password reset link has been sent.
            </p>
          </div>
          {resetUrl && (
            <div className="rounded-lg border border-amber-500/20 bg-primary/5 p-4 text-left">
              <p className="text-xs text-amber-300 mb-2">Development only — your reset link:</p>
              <Link
                href={resetUrl}
                className="text-sm text-primary hover:underline break-all"
              >
                {resetUrl}
              </Link>
            </div>
          )}
          <Link href="/login">
            <Button variant="outline" className="border-input text-foreground/80 hover:bg-secondary">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Login
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-amber-500/20 mx-auto mb-4">
            <Mail className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold">Forgot Password?</h1>
          <p className="text-gray-400 text-sm mt-2">
            Enter your email and we'll send you a link to reset your password.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="bg-card border-input text-white placeholder-zinc-500 focus:border-ring"
            />
          </div>
          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-black hover:bg-primary/90"
          >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Send Reset Link
          </Button>
        </form>

        <div className="text-center">
          <Link href="/login" className="text-sm text-gray-500 hover:text-primary transition-colors">
            <ArrowLeft className="w-4 h-4 inline mr-1" /> Back to Login
          </Link>
        </div>
      </div>
    </div>
  )
}

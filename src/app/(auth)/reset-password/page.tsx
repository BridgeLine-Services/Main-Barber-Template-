'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Lock, ArrowLeft, CheckCircle, Loader2, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 10 characters')
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to reset password')
        return
      }

      setSuccess(true)
      setTimeout(() => router.push('/login'), 3000)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mx-auto">
            <CheckCircle className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Password Reset</h1>
            <p className="text-gray-400 text-sm mt-2">
              Your password has been updated. Redirecting to login...
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10 text-red-400 border border-red-500/20 mx-auto">
            <AlertCircle className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Invalid Reset Link</h1>
            <p className="text-gray-400 text-sm mt-2">
              No reset token found. Please request a new password reset link.
            </p>
          </div>
          <Link href="/forgot-password">
            <Button variant="outline" className="border-input text-foreground/80 hover:bg-secondary">
              Request New Link
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
            <Lock className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold">Set New Password</h1>
          <p className="text-gray-400 text-sm mt-2">Enter your new password below.</p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (min 8 chars)"
              className="bg-card border-input text-white placeholder-zinc-500 focus:border-ring"
            />
          </div>
          <div>
            <Input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              className="bg-card border-input text-white placeholder-zinc-500 focus:border-ring"
            />
          </div>
          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-black hover:bg-primary/90"
          >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Reset Password
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

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { KeyRound, Loader2, AlertCircle } from 'lucide-react'

/**
 * Forced password-change page — the redirect target for users whose
 * `mustChangePassword` flag is set (e.g. seeded/generated credentials).
 * Priority 2 in the dashboard access chain; dashboard access is blocked
 * server-side until the flag is cleared here.
 */
export default function ChangePasswordPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { data: session } = useSession()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (form.newPassword !== form.confirmPassword) {
      setError('New passwords do not match')
      return
    }
    if (form.newPassword.length < 10) {
      setError('New password must be at least 10 characters')
      return
    }
    if (!/[A-Z]/.test(form.newPassword) || !/[a-z]/.test(form.newPassword) || !/[0-9]/.test(form.newPassword)) {
      setError('New password needs an uppercase letter, a lowercase letter, and a number')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
          confirmPassword: form.confirmPassword,
        }),
      })
      const data = await res.json()

      if (res.ok && data.success) {
        toast({ title: 'Password updated', description: 'Your dashboard is now unlocked.' })
        // Server decides the destination: onboarding wizard if setup is
        // unfinished, otherwise the dashboard.
        router.push(data.redirectTo || '/dashboard')
        router.refresh()
      } else {
        setError(data.error || 'Failed to change password')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Card className="bg-card/90 border-border shadow-xl">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 border border-amber-500/30 flex items-center justify-center mb-2">
              <KeyRound className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-xl text-foreground">Change Your Password</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              For security, you must set a new password before continuing
              {session?.user ? ` (signed in as ${session.user.email ?? 'your account'})` : ''}.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword" className="text-foreground text-xs font-semibold">
                  Current Password <span className="text-primary">*</span>
                </Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={form.currentPassword}
                  onChange={(e) => handleChange('currentPassword', e.target.value)}
                  className="bg-background border-border text-foreground"
                  autoComplete="current-password"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="newPassword" className="text-foreground text-xs font-semibold">
                  New Password <span className="text-primary">*</span>
                </Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={form.newPassword}
                  onChange={(e) => handleChange('newPassword', e.target.value)}
                  className="bg-background border-border text-foreground"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <p className="text-[11px] text-muted-foreground">Minimum 10 characters with an uppercase letter, a lowercase letter, and a number.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-foreground text-xs font-semibold">
                  Confirm New Password <span className="text-primary">*</span>
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={form.confirmPassword}
                  onChange={(e) => handleChange('confirmPassword', e.target.value)}
                  className="bg-background border-border text-foreground"
                  autoComplete="new-password"
                  required
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md p-3">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={submitting}
                className="w-full bg-primary hover:bg-primary/90 text-zinc-950 font-semibold"
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Updating…</>
                ) : (
                  'Update Password'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

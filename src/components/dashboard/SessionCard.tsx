'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle, CheckCircle2, Loader2, LogOut } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// SessionCard — "sign out of all devices".
//
// Owners hand their phone to a barber, sign in on a shared laptop, or get a
// password they suspect is known. This is the control that ends every other
// session at once, explained without jargon.
// ─────────────────────────────────────────────────────────────────────────────

export function SessionCard() {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function revoke() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch('/api/dashboard/security/sessions/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Something went wrong. Please try again.')
        return
      }
      setPassword('')
      setNotice(
        typeof data?.message === 'string'
          ? data.message
          : 'Every device has been signed out. Please sign in again.',
      )
      // This device is signed out too, so send the owner somewhere useful
      // instead of leaving them on a page that will 401 on the next click.
      setTimeout(() => {
        window.location.assign('/login?signout=1')
      }, 1500)
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <LogOut className="h-5 w-5" /> Signed-in devices
        </CardTitle>
        <CardDescription>
                      If you signed in somewhere you no longer trust, or you are not sure whether you signed
            out on an old phone, sign out everywhere at once. You will need to sign in again here.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}
        {notice && (
          <p role="status" className="flex items-start gap-2 rounded-md border border-border bg-muted p-3 text-sm text-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="revoke-password">Your password</Label>
          <Input
            id="revoke-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="max-w-[280px]"
            disabled={busy}
          />
        </div>

        <Button variant="outline" onClick={revoke} disabled={busy || !password}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Sign out everywhere
        </Button>

        <p className="text-xs text-muted-foreground">
          Anyone signed out has to enter their password again. This does not change your password —
          use your account settings if you want to do that as well.
        </p>
      </CardContent>
    </Card>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, CheckCircle2, Copy, Loader2, ShieldCheck } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// TwoFactorCard — owner-facing two-factor setup for their OWN account.
//
// Written for someone who has never used an authenticator app: every step says
// what to do next, and the recovery codes are shown exactly once with a plain
// warning. Nothing here reveals a stored secret; the only secret shown is the
// new one being enrolled, before it is confirmed.
// ─────────────────────────────────────────────────────────────────────────────

type Status = {
  enabled: boolean
  enabledAt: string | null
  setupStarted: boolean
  recoveryCodesRemaining: number
}

type Stage = 'idle' | 'setup' | 'codes' | 'disabling'

export function TwoFactorCard() {
  const [status, setStatus] = useState<Status | null>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [secret, setSecret] = useState('')
  const [otpauth, setOtpauth] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/security/2fa', { cache: 'no-store' })
      if (!res.ok) throw new Error('status')
      setStatus(await res.json())
    } catch {
      setError("We couldn't check your security settings. Please refresh the page.")
    }
  }, [])

  useEffect(() => {
    // Fire-and-forget fetch with an unmount guard: the card must not write
    // state after it has been replaced (tab switch), and awaiting inside the
    // effect body would delay the first paint.
    let alive = true
    void (async () => {
      try {
        const res = await fetch('/api/dashboard/security/2fa', { cache: 'no-store' })
        if (!alive) return
        if (!res.ok) throw new Error('status')
        const data = await res.json()
        if (alive) setStatus(data)
      } catch {
        if (alive) setError("We couldn't check your security settings. Please refresh the page.")
      }
    })()
    return () => { alive = false }
  }, [])

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch(`/api/dashboard/security/2fa/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Something went wrong. Please try again.')
        return null
      }
      return data
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.")
      return null
    } finally {
      setBusy(false)
    }
  }

  async function startSetup() {
    const data = await post('start', {})
    if (!data) return
    setSecret(data.secret)
    setOtpauth(data.otpauthUrl)
    setCode('')
    setStage('setup')
  }

  async function confirmSetup() {
    const data = await post('confirm', { code: code.trim() })
    if (!data) return
    setRecoveryCodes(Array.isArray(data.recoveryCodes) ? data.recoveryCodes : [])
    setStage('codes')
    setNotice('Two-factor authentication is on.')
    await loadStatus()
  }

  async function disable() {
    const data = await post('disable', { password, code: code.trim() })
    if (!data) return
    setPassword('')
    setCode('')
    setRecoveryCodes([])
    setStage('idle')
    setNotice('Two-factor authentication is off.')
    await loadStatus()
  }

  function copyCodes() {
    const text = recoveryCodes.join('\n')
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => setNotice('Recovery codes copied. Store them somewhere safe.'),
        () => setError('Copying did not work. Please write the codes down instead.')
      )
    } else {
      setError('Copying is not available here. Please write the codes down instead.')
    }
  }

  if (!status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="h-5 w-5" /> Two-factor authentication</CardTitle>
          <CardDescription>{error || 'Checking your security settings...'}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const grouped = secret ? secret.replace(/(.{4})/g, '$1 ').trim() : ''

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="h-5 w-5" /> Two-factor authentication
          {status.enabled ? <Badge variant="secondary">On</Badge> : <Badge variant="outline">Off</Badge>}
        </CardTitle>
        <CardDescription>
          Adds a second step when you sign in: your password, then a 6-digit code from an app on your phone.
          This protects your shop even if someone learns your password.
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

        {/* ── Off: start ─────────────────────────────────────────────── */}
        {stage === 'idle' && !status.enabled && (
          <>
            <p className="text-sm text-muted-foreground">
              You will need an authenticator app such as Google Authenticator, Authy or 1Password.
              Install one on your phone first, then come back to this page.
            </p>
            {status.setupStarted && (
              <p className="text-sm text-muted-foreground">
                You started setting this up before but did not finish, so it is still off. Starting again replaces the old setup.
              </p>
            )}
            <Button onClick={startSetup} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Turn on two-factor authentication
            </Button>
          </>
        )}

        {/* ── Setup: secret + code ───────────────────────────────────── */}
        {stage === 'setup' && (
          <div className="space-y-4">
            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
              <p className="text-sm font-semibold text-foreground">1. Add this account to your app</p>
              <p className="text-sm text-muted-foreground">
                In your authenticator app choose &ldquo;Add account&rdquo; and &ldquo;Enter a setup key&rdquo;, then type this key:
              </p>
              <p className="select-all break-all rounded bg-background px-3 py-2 font-mono text-sm tracking-wider text-foreground">{grouped}</p>
              {otpauth && (
                <a href={otpauth} className="break-all text-xs text-muted-foreground underline">
                  Open directly in an authenticator app on this device
                </a>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="two-factor-code">2. Enter the 6-digit code your app shows</Label>
              <Input
                id="two-factor-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="max-w-[180px] font-mono tracking-widest"
                disabled={busy}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={confirmSetup} disabled={busy || code.length !== 6}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Turn on and show recovery codes
              </Button>
              <Button variant="ghost" onClick={() => { setStage('idle'); setSecret(''); setOtpauth(''); setCode('') }} disabled={busy}>
                Cancel
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Nothing changes until the code is confirmed, so you cannot lock yourself out by starting this.
            </p>
          </div>
        )}

        {/* ── Recovery codes, shown once ─────────────────────────────── */}
        {stage === 'codes' && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-foreground">Save these recovery codes now</p>
            <p className="text-sm text-muted-foreground">
              Each code works once, and only to sign in or turn two-factor off. This is the only time they are shown.
              Keep them somewhere your phone cannot be lost with.
            </p>
            <ul className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/40 p-3 font-mono text-sm text-foreground">
              {recoveryCodes.map((c) => <li key={c} className="select-all">{c}</li>)}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={copyCodes}><Copy className="mr-2 h-4 w-4" /> Copy codes</Button>
              <Button onClick={() => { setStage('idle'); setRecoveryCodes([]) }}>I have saved them</Button>
            </div>
          </div>
        )}

        {/* ── On: status + turn off ──────────────────────────────────── */}
        {stage === 'idle' && status.enabled && (
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              Two-factor authentication is on{status.enabledAt ? ` since ${new Date(status.enabledAt).toLocaleDateString()}` : ''}.
              {' '}You have <strong>{status.recoveryCodesRemaining}</strong> unused recovery code{status.recoveryCodesRemaining === 1 ? '' : 's'}.
            </p>
            {status.recoveryCodesRemaining === 0 && (
              <p className="text-sm text-muted-foreground">
                You have no recovery codes left. Turn two-factor off and on again to get a new set.
              </p>
            )}
            <Button variant="outline" onClick={() => { setStage('disabling'); setPassword(''); setCode('') }}>
              Turn off two-factor authentication
            </Button>
          </div>
        )}

        {stage === 'disabling' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Turning this off makes your account less protected. Confirm it is you: enter your password and either a current code or one recovery code.
            </p>
            <div className="space-y-2">
              <Label htmlFor="two-factor-password">Your password</Label>
              <Input id="two-factor-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="max-w-[280px]" disabled={busy} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="two-factor-disable-code">Code from your app, or a recovery code</Label>
              <Input id="two-factor-disable-code" value={code} onChange={(e) => setCode(e.target.value)} className="max-w-[280px] font-mono" disabled={busy} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" onClick={disable} disabled={busy || !password || !code.trim()}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Turn off two-factor
              </Button>
              <Button variant="ghost" onClick={() => setStage('idle')} disabled={busy}>Cancel</Button>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Lost your phone? Use a recovery code to sign in, then turn two-factor off here and set it up again.
          If you have lost both your phone and your codes, contact your shop owner.
        </p>
      </CardContent>
    </Card>
  )
}

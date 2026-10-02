'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { Power, PowerOff, Loader2 } from 'lucide-react'

/**
 * Soft deactivation card for the owner settings page (danger zone).
 * Deactivating blocks staff sign-ins and public bookings while keeping
 * every record intact. Owners keep access for data export and can
 * reactivate the shop at any time.
 */
export function DeactivateShopCard() {
  const [deactivatedAt, setDeactivatedAt] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    fetch('/api/dashboard/business/deactivate')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDeactivatedAt(d?.deactivatedAt ?? null))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const call = async (path: string, confirm: string) => {
    setBusy(true)
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: 'Action failed', description: data.error || 'Something went wrong', variant: 'destructive' })
        return false
      }
      return true
    } catch {
      toast({ title: 'Action failed', description: 'Network error — nothing was changed', variant: 'destructive' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const handleDeactivate = async () => {
    if (confirmText !== 'DEACTIVATE' || busy) return
    if (await call('/api/dashboard/business/deactivate', confirmText)) {
      setDeactivatedAt(new Date().toISOString())
      setConfirmText('')
      toast({ title: 'Shop deactivated', description: 'Staff sign-ins and public bookings are blocked. All data is preserved.' })
    }
  }

  const handleReactivate = async () => {
    if (busy) return
    if (await call('/api/dashboard/business/reactivate', 'REACTIVATE')) {
      setDeactivatedAt(null)
      toast({ title: 'Shop reactivated', description: 'Staff sign-ins and public bookings are restored.' })
    }
  }

  if (!loaded) return null

  if (deactivatedAt) {
    return (
      <Card className="border-amber-900/50 bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-amber-400">
            <PowerOff className="h-5 w-5" /> Shop Deactivated
          </CardTitle>
          <CardDescription>
            Staff cannot sign in and the public site is not accepting bookings. All data is preserved — export anything you need.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleReactivate} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />} Reactivate shop
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-amber-900/50 bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg text-amber-400">
          <PowerOff className="h-5 w-5" /> Deactivate shop
        </CardTitle>
        <CardDescription>
          Temporarily or permanently close this shop. Staff sign-ins and public bookings are blocked; customers, appointments and
          every other record are preserved. Owners keep access and can reactivate at any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder='Type "DEACTIVATE" to confirm'
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="sm:max-w-xs"
        />
        <Button
          variant="destructive"
          disabled={confirmText !== 'DEACTIVATE' || busy}
          onClick={handleDeactivate}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PowerOff className="h-4 w-4" />} Deactivate shop
        </Button>
      </CardContent>
    </Card>
  )
}

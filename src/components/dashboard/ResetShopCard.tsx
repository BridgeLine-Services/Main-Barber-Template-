'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { AlertTriangle, RotateCcw, Loader2 } from 'lucide-react'

/**
 * Danger-zone card for the owner settings page.
 * Resets the configurable content of THIS shop only — never touches
 * customers, appointments, financial records or login accounts.
 */
export function ResetShopCard() {
  const [confirmText, setConfirmText] = useState('')
  const [resetting, setResetting] = useState(false)
  const [result, setResult] = useState<any>(null)
  const { toast } = useToast()
  const router = useRouter()

  const isConfirmed = confirmText === 'RESET'

  const handleReset = async () => {
    if (!isConfirmed || resetting) return
    setResetting(true)
    try {
      const res = await fetch('/api/dashboard/settings/reset-shop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: confirmText }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: 'Reset failed', description: data.error || 'Something went wrong', variant: 'destructive' })
        return
      }
      setResult(data)
      toast({ title: 'Shop reset', description: data.message })
      // The shop is now back at onboarding — send the owner there
      setTimeout(() => router.push('/dashboard/onboarding'), 1500)
    } catch {
      toast({ title: 'Reset failed', description: 'Network error — nothing was changed', variant: 'destructive' })
    } finally {
      setResetting(false)
    }
  }

  if (result) {
    const s = result.summary || {}
    return (
      <Card className="border-red-900/50 bg-zinc-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-red-400">
            <RotateCcw className="h-5 w-5" /> Shop Reset Complete
          </CardTitle>
          <CardDescription>
            Taking you to the onboarding wizard… You can configure services, barbers and branding from scratch now.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-zinc-400">
          <div className="grid gap-1 sm:grid-cols-2">
            <span>Barbers deleted: <strong className="text-zinc-200">{s.barbersDeleted ?? 0}</strong></span>
            <span>Barbers deactivated (had history): <strong className="text-zinc-200">{s.barbersDeactivated ?? 0}</strong></span>
            <span>Services deleted: <strong className="text-zinc-200">{s.servicesDeleted ?? 0}</strong></span>
            <span>Services deactivated (had history): <strong className="text-zinc-200">{s.servicesDeactivated ?? 0}</strong></span>
            <span>Gallery images removed: <strong className="text-zinc-200">{s.mediaDeleted ?? 0}</strong></span>
            <span>Reviews deleted: <strong className="text-zinc-200">{s.reviewsDeleted ?? 0}</strong></span>
          </div>
          {result.warning && <p className="text-amber-400">{result.warning}</p>}
          <p className="text-xs text-zinc-500">Customers, appointments, financial records and login accounts were preserved.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-red-900/50 bg-zinc-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg text-red-400">
          <AlertTriangle className="h-5 w-5" /> Danger Zone: Reset Shop Configuration
        </CardTitle>
        <CardDescription>
          Clears this shop&apos;s configurable content so it can be set up again from scratch: services, barber
          profiles, gallery, reviews, FAQs, marketing campaigns, loyalty programs, inventory, closures, website
          content, policies, branding and booking questions.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
          <p className="mb-2 font-medium text-zinc-300">This will keep:</p>
          <ul className="mb-3 list-inside list-disc space-y-1">
            <li>Customers and their appointment history</li>
            <li>Financial records, sales reports and audit logs</li>
            <li>Login accounts (owners and staff)</li>
            <li>The database schema itself</li>
          </ul>
          <p className="mb-2 font-medium text-zinc-300">Barbers or services with past appointments are deactivated, not deleted, so history stays intact.</p>
          <p className="text-xs text-zinc-500">This action cannot be undone. It is recorded in the audit log.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            placeholder='Type "RESET" to confirm'
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="sm:max-w-xs"
            aria-label="Type RESET to confirm"
          />
          <Button
            variant="destructive"
            onClick={handleReset}
            disabled={!isConfirmed || resetting}
            className="gap-2"
          >
            {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            {resetting ? 'Resetting…' : 'Reset Shop Configuration'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

'use client'

/**
 * Optional features, explained honestly.
 *
 * The feature map has existed and been enforced server-side for a while, but it
 * had no interface: an owner could not see what the switches did, let alone set
 * them. This is that interface.
 *
 * Two rules shaped the wording, and they matter more than the styling:
 *
 *  1. Say what actually happens. A feature that stops a public endpoint from
 *     accepting a write is described as refusing the action; a feature that only
 *     governs what the website shows is described as showing. Nothing here claims
 *     to remove data, because turning a feature off never deletes anything.
 *  2. Say when an outside service is required. Texting, online payments, email
 *     and the installable app all depend on a provider being configured. If it is
 *     not, the feature stays off rather than half-working, and the copy says so.
 *
 * The API is unchanged: GET returns the resolved map, PUT merges partial booleans
 * for the owner's own business only.
 */

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'

type FeatureKey =
  | 'onlineBooking' | 'customerPortal' | 'reviews' | 'gallery' | 'loyalty'
  | 'waitlist' | 'queue' | 'inventory' | 'marketing' | 'analytics'
  | 'multipleBarbers' | 'barberProfiles' | 'deposits' | 'pwa'
  | 'emailNotifications' | 'smsNotifications' | 'onlinePayments'
  | 'memberships' | 'ecommerce' | 'reviewRequests'

type Copy = { label: string; on: string; needs?: string }

const COPY: Record<FeatureKey, Copy> = {
  onlineBooking: {
    label: 'Online booking',
    on: 'Customers can book from your website. Turn this off and the website stops accepting new online bookings; you can still add appointments yourself.',
  },
  customerPortal: {
    label: 'Customer portal',
    on: 'Customers can open a link to see and manage their own appointments. Turning it off closes that link; their appointments are untouched.',
  },
  reviews: {
    label: 'Reviews',
    on: 'Customers can leave reviews and read them on your website.',
  },
  gallery: {
    label: 'Photo gallery',
    on: 'Your gallery appears on the website. Your photos stay saved if you turn this off.',
  },
  loyalty: {
    label: 'Loyalty and rewards',
    on: 'Customers collect points or visit rewards. Existing points stay saved.',
  },
  waitlist: {
    label: 'Waitlist',
    on: 'Customers can join a waitlist on days that are full.',
  },
  queue: {
    label: 'Walk-in queue',
    on: 'Walk-in customers can join a queue and see their place.',
  },
  inventory: { label: 'Inventory', on: 'Track stock for the products you sell.' },
  marketing: { label: 'Marketing tools', on: 'Campaign and outreach tools in your dashboard.' },
  analytics: { label: 'Reports and charts', on: 'Charts about bookings, takings and customers.' },
  multipleBarbers: {
    label: 'More than one barber',
    on: 'Add several people to your team. With this off, the shop runs as a single chair.',
  },
  barberProfiles: {
    label: 'Barber profile pages',
    on: 'Each barber gets their own page on your website.',
  },
  deposits: {
    label: 'Deposits',
    on: 'Take a deposit when someone books, to reduce no-shows.',
  },
  pwa: {
    label: 'Installable on a phone',
    on: 'Customers can add your site to their home screen and it opens like an app.',
  },
  emailNotifications: {
    label: 'Email notifications',
    on: 'Email customers about their appointments, and yourself about new bookings.',
    needs: 'Sending needs an email service connected for your shop. Without one, nothing is sent and you will see the booking only in your dashboard.',
  },
  smsNotifications: {
    label: 'Text message reminders',
    on: 'Text customers about their appointments.',
    needs: 'Sending needs a texting service connected for your shop. Without one, no texts go out and nothing is charged.',
  },
  onlinePayments: {
    label: 'Take payment online',
    on: 'Customers pay while booking instead of in the chair.',
    needs: 'Needs a payment provider connected. Until then it stays off, so nobody is ever asked to pay through a checkout that cannot take money.',
  },
  memberships: { label: 'Memberships', on: 'Sell repeating plans, such as a monthly cut.' },
  ecommerce: { label: 'Sell products', on: 'Sell products on your website alongside appointments.' },
  reviewRequests: {
    label: 'Automatic review requests',
    on: 'After a visit, the shop asks the customer for a review without you chasing them.',
    needs: 'Needs email or text notifications working, because that is how the request is delivered.',
  },
}

const GROUPS: { title: string; note: string; keys: FeatureKey[] }[] = [
  {
    title: 'How customers book and pay',
    note: 'These change what a customer can do on your website.',
    keys: ['onlineBooking', 'customerPortal', 'deposits', 'onlinePayments', 'waitlist', 'queue'],
  },
  {
    title: 'What your website shows',
    note: 'These change what people see when they visit your site.',
    keys: ['gallery', 'reviews', 'barberProfiles', 'pwa'],
  },
  {
    title: 'Running the shop',
    note: 'Tools for you and your team.',
    keys: ['multipleBarbers', 'analytics', 'marketing', 'inventory', 'memberships', 'ecommerce', 'loyalty'],
  },
  {
    title: 'Messages to customers',
    note: 'Nothing is sent unless the outside service is connected.',
    keys: ['emailNotifications', 'smsNotifications', 'reviewRequests'],
  },
]

export function FeaturesTab() {
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard/features', { cache: 'no-store' })
      if (!response.ok) throw new Error('load')
      const data = await response.json()
      setFeatures(data.features ?? {})
    } catch {
      setError('We could not read your feature settings just now. Refresh the page and try again.')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function toggle(key: FeatureKey, next: boolean) {
    if (!features) return
    const previous = features[key]
    setFeatures({ ...features, [key]: next })
    setSaving(key)
    setError(null)
    setSaved(null)
    try {
      const response = await fetch('/api/dashboard/features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: next }),
      })
      if (!response.ok) throw new Error('save')
      setSaved(COPY[key].label)
    } catch {
      // Put the switch back the way the server still has it, rather than leaving
      // a control that says one thing while the shop does another.
      setFeatures({ ...features, [key]: previous })
      setError(`We could not save "${COPY[key].label}". Nothing changed. Please try again.`)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg text-foreground">Optional features</CardTitle>
          <CardDescription>
            Turn parts of the system on or off to suit your shop. Switching something off never
            deletes anything: appointments, photos, memberships and customer details stay exactly
            where they are, and switching it back on brings it back.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Some features need an outside service, such as a payment provider or a texting service.
            If that service is not connected, the feature stays off rather than half-working, so a
            customer is never asked to do something that cannot complete.
          </p>
          <p aria-live="polite">
            {saving ? 'Saving…' : saved ? `Saved. ${saved} is now updated.` : ''}
          </p>
          {error && (
            <p className="flex items-start gap-2 text-destructive" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {!features && !error && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your features…
        </p>
      )}

      {features && GROUPS.map((group) => (
        <Card key={group.title} className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base text-foreground">{group.title}</CardTitle>
            <CardDescription>{group.note}</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border/60">
            {group.keys.map((key) => {
              const copy = COPY[key]
              const enabled = features[key] === true
              const busy = saving === key
              return (
                <div key={key} className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <label htmlFor={`feature-${key}`} className="font-medium text-foreground">
                      {copy.label}
                    </label>
                    <p className="mt-1 text-sm text-muted-foreground">{copy.on}</p>
                    {copy.needs && (
                      <p className="mt-1 text-xs text-muted-foreground">{copy.needs}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {enabled ? 'Currently on.' : 'Currently off.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
                    <Switch
                      id={`feature-${key}`}
                      checked={enabled}
                      disabled={busy}
                      onCheckedChange={(checked) => void toggle(key, checked)}
                      aria-label={`${copy.label}: ${enabled ? 'on' : 'off'}`}
                    />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ))}

      {error && (
        <Button variant="outline" onClick={() => { setError(null); void load() }}>
          Try again
        </Button>
      )}

      <p className="text-xs text-muted-foreground flex items-center gap-2">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        Changes take effect straight away, including for customers already on your website.
      </p>
    </div>
  )
}

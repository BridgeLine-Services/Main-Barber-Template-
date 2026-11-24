'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * The guided setup for a new shop.
 *
 * The steps follow OPENING_STEPS: create the shop, set the region, apply the shared brand,
 * choose services, appoint a manager, review, then open. Nothing here decides anything: the
 * server re-checks the permission, the duplicate name and the timezone, and creates the
 * location in onboarding whatever the browser says.
 */

const STEPS = [
  { key: 'basics', title: 'The shop', blurb: 'Its name, where it is, and how customers reach it.' },
  { key: 'region', title: 'Region', blurb: 'Group shops together if you run more than a few.' },
  { key: 'brand', title: 'Brand', blurb: 'The shared look applies automatically.' },
  { key: 'services', title: 'Services', blurb: 'The organization service list is copied in at standard prices.' },
  { key: 'manager', title: 'Manager', blurb: 'Appoint somebody after the shop exists.' },
  { key: 'review', title: 'Review', blurb: 'Check everything before it is created.' },
] as const

const TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'Europe/London',
  'Europe/Berlin',
  'Australia/Sydney',
]

interface Props {
  regions: string[]
  existingNames: string[]
  defaultTimezone: string
}

export function LocationWizard({ regions, existingNames, defaultTimezone }: Props) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [timezone, setTimezone] = useState(defaultTimezone)
  const [region, setRegion] = useState('')
  const [newRegion, setNewRegion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const chosenRegion = (region === '__new' ? newRegion : region).trim()

  const duplicate = useMemo(() => {
    const wanted = name.trim().toLowerCase()
    if (wanted.length === 0) return null
    return existingNames.find((row) => row.trim().toLowerCase() === wanted) ?? null
  }, [name, existingNames])

  const basicsReady = name.trim().length >= 2 && timezone.trim().length > 0 && duplicate === null

  function next() {
    setError(null)
    if (step === 0 && !basicsReady) {
      setError(duplicate ? 'There is already a location with that name.' : 'Enter the shop name and choose a timezone.')
      return
    }
    setStep((current) => Math.min(STEPS.length - 1, current + 1))
    setNotice('Step ' + Math.min(STEPS.length, step + 2) + ' of ' + STEPS.length + '.')
  }

  function back() {
    setError(null)
    setStep((current) => Math.max(0, current - 1))
  }

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/dashboard/organization/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          address,
          city,
          state,
          zipCode,
          email,
          phone,
          timezone,
          region: chosenRegion.length > 0 ? chosenRegion : null,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(typeof data.error === 'string' ? data.error : 'The location could not be saved.')
        return
      }
      const businessId = data?.location?.businessId
      router.push(businessId ? '/dashboard/organization/locations/' + businessId : '/dashboard/organization/locations')
    } catch {
      setError('The connection dropped. Nothing was created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {STEPS.map((item, index) => (
          <li
            key={item.key}
            aria-current={index === step ? 'step' : undefined}
            className={
              'rounded-full border px-3 py-1 ' +
              (index === step ? 'border-[var(--dash-brand-border)] bg-[var(--dash-brand-soft)] text-foreground' : 'border-border')
            }
          >
            {index + 1}. {item.title}
          </li>
        ))}
      </ol>

      <div className="rounded-xl border border-border bg-[var(--dash-surface)] p-4 sm:p-5">
        <h2 className="text-base font-semibold text-foreground">{STEPS[step].title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{STEPS[step].blurb}</p>

        {step === 0 && (
          <div className="mt-4 space-y-3">
            <div>
              <Label htmlFor="shop-name">Shop name</Label>
              <Input id="shop-name" value={name} onChange={(event) => setName(event.target.value)} className="mt-1 min-h-11 text-base" autoComplete="organization" />
              {duplicate && <p className="mt-1 text-xs text-amber-600">There is already a location called {duplicate}.</p>}
            </div>
            <div>
              <Label htmlFor="shop-address">Street address</Label>
              <Input id="shop-address" value={address} onChange={(event) => setAddress(event.target.value)} className="mt-1 min-h-11 text-base" autoComplete="street-address" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="shop-city">City</Label>
                <Input id="shop-city" value={city} onChange={(event) => setCity(event.target.value)} className="mt-1 min-h-11 text-base" />
              </div>
              <div>
                <Label htmlFor="shop-state">State</Label>
                <Input id="shop-state" value={state} onChange={(event) => setState(event.target.value)} className="mt-1 min-h-11 text-base" />
              </div>
              <div>
                <Label htmlFor="shop-zip">ZIP</Label>
                <Input id="shop-zip" value={zipCode} onChange={(event) => setZipCode(event.target.value)} className="mt-1 min-h-11 text-base" inputMode="numeric" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="shop-email">Contact email</Label>
                <Input id="shop-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 min-h-11 text-base" />
              </div>
              <div>
                <Label htmlFor="shop-phone">Contact phone</Label>
                <Input id="shop-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 min-h-11 text-base" />
              </div>
            </div>
            <div>
              <Label htmlFor="shop-timezone">Timezone</Label>
              <select
                id="shop-timezone"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 text-base"
              >
                {Array.from(new Set([timezone, ...TIMEZONES])).map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">Appointment times are shown to customers in this timezone.</p>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="mt-4 space-y-3">
            <div>
              <Label htmlFor="shop-region">Region</Label>
              <select
                id="shop-region"
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 text-base"
              >
                <option value="">No region</option>
                {regions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
                <option value="__new">Add a new region</option>
              </select>
            </div>
            {region === '__new' && (
              <div>
                <Label htmlFor="shop-new-region">New region name</Label>
                <Input id="shop-new-region" value={newRegion} onChange={(event) => setNewRegion(event.target.value)} className="mt-1 min-h-11 text-base" />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              A region is just a name shops share. You can rename it later and every shop in it moves with it.
            </p>
          </div>
        )}

        {step === 2 && (
          <p className="mt-4 text-sm text-foreground/90">
            The shared brand applies as soon as the shop exists. A location-specific exception can be requested
            afterwards, and only the fields corporate allows may be changed.
          </p>
        )}

        {step === 3 && (
          <p className="mt-4 text-sm text-foreground/90">
            The organization service list is copied into this shop at standard prices. You can change a price here
            later without touching other shops, and changing a template never overwrites a price this shop already has.
          </p>
        )}

        {step === 4 && (
          <p className="mt-4 text-sm text-foreground/90">
            A location manager is appointed from Employees and assignments after the shop exists. The shop cannot be
            opened until somebody is responsible for it.
          </p>
        )}

        {step === 5 && (
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium text-foreground">{name.trim() || 'Not set'}</dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
              <dt className="text-muted-foreground">Where</dt>
              <dd className="text-foreground">{[address, city, state, zipCode].filter(Boolean).join(', ') || 'Not set'}</dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
              <dt className="text-muted-foreground">Contact</dt>
              <dd className="text-foreground">{[email, phone].filter(Boolean).join(' · ') || 'Not set'}</dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
              <dt className="text-muted-foreground">Timezone</dt>
              <dd className="text-foreground">{timezone}</dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
              <dt className="text-muted-foreground">Region</dt>
              <dd className="text-foreground">{chosenRegion || 'No region'}</dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
              <dt className="text-muted-foreground">Status after creating</dt>
              <dd className="text-foreground">Onboarding. It will not take bookings until you open it.</dd>
            </div>
          </dl>
        )}

        <div aria-live="polite" className="mt-3 min-h-5 text-sm text-muted-foreground">
          {notice}
        </div>
        {error && (
          <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground" role="alert">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={back} disabled={step === 0 || busy}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={next}>
              Continue
            </Button>
          ) : (
            <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={create} disabled={busy || !basicsReady}>
              {busy ? 'Creating…' : 'Create the location'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

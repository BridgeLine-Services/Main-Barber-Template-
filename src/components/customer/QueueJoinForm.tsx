'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, Loader2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ServiceOption {
  id: string
  name: string
  duration: number
}
interface BarberOption {
  id: string
  name: string
}

interface JoinResult {
  success: boolean
  position?: number
  estimatedWaitMinutes?: number | null
  statusUrl?: string
  error?: string
}

export default function QueueJoinForm({
  services,
  barbers,
}: {
  services: ServiceOption[]
  barbers: BarberOption[]
}) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<JoinResult | null>(null)
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    serviceId: services[0]?.id ?? '',
    barberId: '',
    notes: '',
  })

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch('/api/public/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          phone: form.phone,
          email: form.email || undefined,
          serviceId: form.serviceId,
          barberId: form.barberId || null,
          notes: form.notes || null,
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setResult(data)
      } else {
        setResult({ success: false, error: data.error || 'Could not join the queue. Please try again.' })
      }
    } catch {
      setResult({ success: false, error: 'Could not join the queue. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  if (result?.success) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Users className="size-7" aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-2xl font-bold text-foreground">
          You&apos;re #{result.position} in line
        </h2>
        {typeof result.estimatedWaitMinutes === 'number' ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Estimated wait: about {result.estimatedWaitMinutes} minutes. We&apos;ll call or text you
            when it&apos;s your turn.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            We&apos;ll call or text you when it&apos;s your turn.
          </p>
        )}
        {result.statusUrl && (
          <Button
            className="mt-6 w-full"
            onClick={() => router.push(result.statusUrl as string)}
          >
            <Clock className="size-4" aria-hidden="true" /> Check my spot
          </Button>
        )}
      </div>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8"
      aria-label="Join the walk-in queue"
    >
      {result && !result.success && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {result.error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-foreground">First name</span>
          <input
            required
            maxLength={50}
            value={form.firstName}
            onChange={(e) => set('firstName', e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-foreground">Last name</span>
          <input
            required
            maxLength={50}
            value={form.lastName}
            onChange={(e) => set('lastName', e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-foreground">Phone</span>
        <input
          required
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={20}
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          placeholder="We&apos;ll text you when it&apos;s your turn"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-foreground">
          Email <span className="text-muted-foreground">(optional)</span>
        </span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={120}
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-foreground">Service</span>
        <select
          required
          value={form.serviceId}
          onChange={(e) => set('serviceId', e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.duration} min
            </option>
          ))}
        </select>
      </label>

      {barbers.length > 0 && (
        <label className="block">
          <span className="text-sm font-medium text-foreground">
            Barber preference <span className="text-muted-foreground">(optional — any barber is fastest)</span>
          </span>
          <select
            value={form.barberId}
            onChange={(e) => set('barberId', e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">Any barber</option>
            {barbers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block">
        <span className="text-sm font-medium text-foreground">
          Notes <span className="text-muted-foreground">(optional)</span>
        </span>
        <textarea
          maxLength={500}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          className="mt-1 min-h-[64px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          placeholder="Anything we should know?"
        />
      </label>

      <Button type="submit" disabled={submitting} className="w-full font-bold">
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Joining…
          </>
        ) : (
          'Join the walk-in queue'
        )}
      </Button>
    </form>
  )
}

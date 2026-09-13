'use client'

// Onboarding Step — Review & Complete.
// Shows the owner a summary of everything they configured, the authoritative
// server-side requirements check, and the final Complete Setup action.
//
// Every section links back to its wizard step, so the owner can jump straight
// to whatever needs fixing. Completion itself is enforced server-side — this
// page only displays the same requirement list the API uses.

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Pencil,
  Scissors,
  UserRound,
} from 'lucide-react'

type EditableStep = 'business' | 'branding' | 'services' | 'team' | 'booking'

interface ReviewData {
  business: {
    name: string
    slug: string
    timezone: string
    phone: string | null
    email: string | null
    logo: string | null
    primaryColor: string
    accentColor: string
    secondaryColor: string | null
    themeMode: string
    fontFamily: string | null
    walkInsWelcome: boolean
    firstAvailableBookingEnabled: boolean
    paymentInPerson: boolean
    customerRescheduleEnabled: boolean
    customerRescheduleMinNoticeHours: number
    customerRescheduleWindowDays: number | null
    bookingPolicy: string | null
    cancellationPolicy: string | null
    latePolicy: string | null
    noShowPolicyText: string | null
  }
  services: { id: string; name: string; duration: number; price: number; description: string | null }[]
  barbers: {
    id: string
    name: string
    slug: string | null
    specialty: string | null
    photo: string | null
    schedules: { dayOfWeek: number; isOff: boolean; startTime: string; endTime: string }[]
  }[]
  requirements: {
    ok: boolean
    missing: { code: string; label: string; hint: string; step: EditableStep }[]
  }
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface ReviewStepProps {
  completing: boolean
  serverError: string | null
  onEditStep: (step: EditableStep) => void
  onComplete: () => void
  onBack: () => void
}

export function ReviewStep({ completing, serverError, onEditStep, onComplete, onBack }: ReviewStepProps) {
  const [data, setData] = useState<ReviewData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/dashboard/onboarding/review')
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(json.error || 'Failed to load your summary.')
        setData(json)
      } catch (err: any) {
        if (!cancelled) setLoadError(err.message || 'Failed to load your summary.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (loadError) {
    return (
      <Card className="border-zinc-800 bg-zinc-900/60 max-w-2xl mx-auto">
        <CardContent className="py-10 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-red-400" />
          <p className="mt-3 text-sm text-zinc-300">{loadError}</p>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-400">
        <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
        <span className="ml-2.5 text-sm">Loading your setup summary…</span>
      </div>
    )
  }

  const b = data.business
  const missingByStep = new Map<EditableStep, string[]>()
  for (const m of data.requirements.missing) {
    const list = missingByStep.get(m.step) || []
    list.push(m.label)
    missingByStep.set(m.step, list)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardHeader>
          <CardTitle className="text-zinc-100">Review &amp; Complete Setup</CardTitle>
          <CardDescription>
            A final look at {b.name || 'your shop'} before going live. Click any section to go back
            and change it — nothing is locked after setup.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Missing requirements banner */}
          {!data.requirements.ok ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div className="w-full">
                  <p className="text-sm font-semibold text-amber-200">
                    Before you can complete setup, these are still missing:
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {data.requirements.missing.map((m) => (
                      <li key={m.code}>
                        <button
                          type="button"
                          onClick={() => onEditStep(m.step)}
                          className="group flex w-full items-start gap-2 text-left"
                        >
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                          <span className="text-sm text-amber-100/90 group-hover:text-amber-50 group-hover:underline">
                            {m.label}
                            <span className="ml-1.5 text-xs text-amber-200/60 group-hover:text-amber-200/90">
                              {m.hint}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <p className="text-sm text-emerald-200">
                All requirements are met — your shop is ready to go live.
              </p>
            </div>
          )}

          {/* Section: Business Information */}
          <ReviewSection
            title="Business Information"
            step="business"
            missing={missingByStep.get('business')}
            onEdit={onEditStep}
          >
            <SummaryRow label="Name" value={b.name || '—'} />
            <SummaryRow label="Web address" value={b.slug ? `${b.slug}` : '—'} />
            <SummaryRow label="Timezone" value={b.timezone || '—'} />
            <SummaryRow label="Phone" value={b.phone || '—'} />
            <SummaryRow label="Email" value={b.email || '—'} />
          </ReviewSection>

          {/* Section: Branding */}
          <ReviewSection title="Branding" step="branding" onEdit={onEditStep}>
            <div className="flex items-center gap-3">
              {b.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={b.logo}
                  alt="Shop logo"
                  className="h-10 w-10 rounded-md border border-zinc-800 object-contain"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-600">
                  <Scissors className="h-4 w-4" />
                </div>
              )}
              <div className="flex items-center gap-1.5">
                {[b.primaryColor, b.accentColor, b.secondaryColor || b.primaryColor].map((color, i) => (
                  <span
                    key={i}
                    className="h-6 w-6 rounded-md border border-zinc-700"
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
              <span className="text-sm text-zinc-400">
                {b.themeMode === 'light' ? 'Light' : 'Dark'} theme
              </span>
            </div>
          </ReviewSection>

          {/* Section: Services */}
          <ReviewSection
            title="Services"
            step="services"
            missing={missingByStep.get('services')}
            onEdit={onEditStep}
          >
            {data.services.length === 0 ? (
              <p className="text-sm text-zinc-500">No active services yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-800/70">
                {data.services.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-zinc-200">{s.name}</span>
                    <span className="text-xs text-zinc-500">
                      {s.duration} min · ${s.price}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ReviewSection>

          {/* Section: Barbers & Schedules */}
          <ReviewSection
            title="Barbers & Schedules"
            step="team"
            missing={missingByStep.get('team')}
            onEdit={onEditStep}
          >
            {data.barbers.length === 0 ? (
              <p className="text-sm text-zinc-500">No active barbers yet.</p>
            ) : (
              <ul className="space-y-3">
                {data.barbers.map((barber) => {
                  const working = barber.schedules.filter((s) => !s.isOff)
                  const hours =
                    working.length > 0 && working.every((s) => s.startTime === working[0].startTime && s.endTime === working[0].endTime)
                      ? `${working[0].startTime}–${working[0].endTime}` // same hours every day — compact
                      : null
                  return (
                    <li key={barber.id} className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-3">
                      <div className="flex items-center gap-2.5">
                        {barber.photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={barber.photo}
                            alt={barber.name}
                            className="h-8 w-8 rounded-full border border-zinc-800 object-cover"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-500">
                            <UserRound className="h-4 w-4" />
                          </div>
                        )}
                        <span className="text-sm font-medium text-zinc-200">{barber.name}</span>
                        {barber.specialty && (
                          <span className="text-xs text-zinc-500">{barber.specialty}</span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                        {working.length === 0 ? (
                          <span className="text-xs text-red-400">No working hours set</span>
                        ) : hours ? (
                          <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                            <Clock className="h-3 w-3" />
                            {working.map((s) => DAY_LABELS[s.dayOfWeek]).join(', ')} · {hours}
                          </span>
                        ) : (
                          working.map((s) => (
                            <span key={s.dayOfWeek} className="text-xs text-zinc-400">
                              {DAY_LABELS[s.dayOfWeek]} {s.startTime}–{s.endTime}
                            </span>
                          ))
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </ReviewSection>

          {/* Section: Booking Settings */}
          <ReviewSection title="Booking Settings" step="booking" onEdit={onEditStep}>
            <div className="space-y-1.5">
              <SummaryRow label="Walk-ins" value={b.walkInsWelcome ? 'Welcome' : 'By appointment only'} />
              <SummaryRow label="First available" value={b.firstAvailableBookingEnabled === false ? 'Off (barber-first booking)' : 'On'} />
              <SummaryRow
                label="Customer reschedule/cancel"
                value={
                  b.customerRescheduleEnabled
                    ? `Allowed with ${b.customerRescheduleMinNoticeHours}h notice` +
                      (b.customerRescheduleWindowDays ? ` (within ${b.customerRescheduleWindowDays} days)` : '')
                    : 'Not allowed'
                }
              />
              <SummaryRow label="Payment" value={b.paymentInPerson ? 'Collected in person' : '—'} />
              {b.bookingPolicy && <SummaryRow label="Booking policy" value={b.bookingPolicy} />}
              {b.cancellationPolicy && <SummaryRow label="Cancellation policy" value={b.cancellationPolicy} />}
              {b.latePolicy && <SummaryRow label="Late policy" value={b.latePolicy} />}
              {b.noShowPolicyText && <SummaryRow label="No-show policy" value={b.noShowPolicyText} />}
            </div>
            {b.paymentInPerson && (
              <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
                <Banknote className="h-3.5 w-3.5" />
                Payment is collected in person — no online payments in this product.
              </div>
            )}
          </ReviewSection>

          {serverError && <p className="text-sm text-red-400">{serverError}</p>}

          {/* Actions */}
          <div className="flex flex-col gap-3 border-t border-zinc-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="outline" onClick={onBack} disabled={completing}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
            </Button>
            <Button
              type="button"
              onClick={onComplete}
              disabled={completing || !data.requirements.ok}
              className="bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {completing ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Completing…
                </>
              ) : (
                <>
                  <Check className="mr-1.5 h-4 w-4" /> Complete Setup
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

function ReviewSection({
  title,
  step,
  missing,
  onEdit,
  children,
}: {
  title: string
  step: EditableStep
  missing?: string[]
  onEdit: (step: EditableStep) => void
  children: React.ReactNode
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        missing && missing.length > 0
          ? 'border-amber-500/40 bg-amber-500/[0.03]'
          : 'border-zinc-800 bg-zinc-950/40'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2.5 text-xs text-zinc-400 hover:text-zinc-100"
          onClick={() => onEdit(step)}
        >
          <Pencil className="mr-1 h-3 w-3" /> Edit
        </Button>
      </div>
      {missing && missing.length > 0 && (
        <p className="mb-2 mt-1 text-xs text-amber-300/90">
          Missing: {missing.join(', ')}
        </p>
      )}
      <div className="mt-2">{children}</div>
    </div>
  )
}

// ─── Summary row ─────────────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className="shrink-0 text-xs text-zinc-500">{label}</span>
      <span className="text-right text-sm text-zinc-200">{value}</span>
    </div>
  )
}

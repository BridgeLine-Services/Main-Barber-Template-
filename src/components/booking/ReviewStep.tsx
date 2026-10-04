'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { formatFullDate, formatDuration, formatPrice } from '@/lib/utils'
import { PAYMENT_DISCLAIMER } from '@/lib/constants'
import { AlertCircle, Loader2, CreditCard } from 'lucide-react'

interface ReviewStepProps {
  service: { name: string; duration: number; price: number } | null
  barber: { name: string; specialty?: string | null } | null
  date: Date | null
  time: string | null
  customerInfo: {
    firstName: string
    lastName: string
    phone: string
    email: string
    notes?: string
    smsConsent?: boolean
  }
  policies: { booking?: string | null; cancellation?: string | null; late?: string | null; noShow?: string | null }
  policyAccepted: boolean
  onPolicyAcceptedChange: (accepted: boolean) => void
  onConfirm: () => void
  isSubmitting: boolean
  error: string | null
  onBackToTime?: () => void
  /** Edit paths — the review step is never a dead end. Each returns the
   *  customer to that step while the page preserves the other selections. */
  onEditService?: () => void
  onEditBarber?: () => void
  onEditDate?: () => void
  onEditTime?: () => void
  onEditInfo?: () => void
}


/**
 * Small secondary "Edit" control for review rows — visible but quiet, so it
 * never competes with the primary Confirm action.
 */
function EditLink({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return null
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-8 items-center rounded-md border border-input bg-card px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground hover:bg-secondary focus-ring shrink-0"
      aria-label={`Edit ${label}`}
    >
      Edit
    </button>
  )
}

// Final stage: a polished appointment summary — the service leads with
// display typography, details follow as quiet definition rows across
// hairlines, and the confirm action reads as the confident end of the
// booking. All logic (policy acceptance, submission, error handling)
// is unchanged.
export function ReviewStep({
  service,
  barber,
  date,
  time,
  customerInfo,
  policies,
  policyAccepted,
  onPolicyAcceptedChange,
  onConfirm,
  isSubmitting,
  error,
  onBackToTime,
  onEditService,
  onEditBarber,
  onEditDate,
  onEditTime,
  onEditInfo,
}: ReviewStepProps) {
  return (
    <div className="max-w-xl">
      <div className="mb-8">
        <p className="eyebrow-accent mb-3">Almost There</p>
        <h2 className="display-heading text-display-3 text-foreground">Review & Confirm</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Please review your appointment details before confirming.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 p-4 rounded-md border border-destructive/40 bg-destructive/10 space-y-2"
        >
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <h4 className="font-semibold text-sm">Booking Error</h4>
          </div>
          <p className="text-xs text-destructive/90 leading-relaxed">{error}</p>
          {onBackToTime && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onBackToTime}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              Select a Different Time Slot
            </Button>
          )}
        </div>
      )}

      {/* The appointment — service leads as the headline */}
      <div className="pb-6 border-b border-border/60">
        <p className="eyebrow mb-3">Your Appointment</p>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="display-heading text-display-2 text-foreground">
            {service?.name || 'Selected Service'}
          </h3>
          <span className="shrink-0 font-display text-xl font-bold text-foreground tabular-nums">
            {service ? formatPrice(service.price) : ''}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {service ? `${formatDuration(service.duration)} in the chair` : ''}
        </p>
        {onEditService && (
          <div className="mt-3">
            <EditLink label="service" onClick={onEditService} />
          </div>
        )}
      </div>

      {/* Details as quiet definition rows across hairlines */}
      <dl className="divide-y divide-border/60">
        <div className="py-4 flex items-baseline justify-between gap-4">
          <dt className="eyebrow">Barber</dt>
          <dd className="flex items-center gap-3 text-sm font-semibold text-foreground text-right">
            <span>
              {barber?.name || 'Any Available Barber'}
              {barber?.specialty ? (
                <span className="block text-xs font-normal text-muted-foreground">{barber.specialty}</span>
              ) : null}
            </span>
            <EditLink label="barber" onClick={onEditBarber} />
          </dd>
        </div>
        <div className="py-4 flex items-baseline justify-between gap-4">
          <dt className="eyebrow">Date</dt>
          <dd className="flex items-center gap-3 text-sm font-semibold text-foreground">
            <span>{date ? formatFullDate(date) : '-'}</span>
            <EditLink label="date" onClick={onEditDate} />
          </dd>
        </div>
        <div className="py-4 flex items-baseline justify-between gap-4">
          <dt className="eyebrow">Time</dt>
          <dd className="flex items-center gap-3 font-display text-lg font-semibold text-foreground tabular-nums">
            <span>{time || '-'}</span>
            <EditLink label="time" onClick={onEditTime} />
          </dd>
        </div>
        <div className="py-4 flex items-baseline justify-between gap-4">
          <dt className="eyebrow">Name</dt>
          <dd className="flex items-center gap-3 text-sm font-semibold text-foreground">
            <span>
              {customerInfo.firstName} {customerInfo.lastName}
            </span>
            <EditLink label="customer information" onClick={onEditInfo} />
          </dd>
        </div>
        <div className="py-4 flex items-baseline justify-between gap-4">
          <dt className="eyebrow">Phone</dt>
          <dd className="text-sm font-semibold text-foreground">{customerInfo.phone}</dd>
        </div>
        <div className="py-4 flex items-baseline justify-between gap-4">
          <dt className="eyebrow">Email</dt>
          <dd className="text-sm font-semibold text-foreground truncate">{customerInfo.email}</dd>
        </div>
        {customerInfo.notes && (
          <div className="py-4">
            <dt className="eyebrow mb-1.5">Notes</dt>
            <dd className="text-sm text-muted-foreground italic">{customerInfo.notes}</dd>
          </div>
        )}
      </dl>

      {/* Payment & Disclaimer — quiet informational band */}
      <div className="mt-6 p-4 rounded-md border border-primary/20 bg-primary/[0.04] space-y-2">
        <div className="flex items-center gap-2 text-primary">
          <CreditCard className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wider">Payment</span>
        </div>
        <p className="text-sm font-medium text-foreground/80">
          Pay in person at the barbershop.
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{PAYMENT_DISCLAIMER}</p>
      </div>

      {Object.values(policies).some(Boolean) && (
        <label className="mt-5 flex items-start gap-3 rounded-md border border-border bg-card/50 p-4 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={policyAccepted}
            onChange={(event) => onPolicyAcceptedChange(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-primary focus-ring"
          />
          <span>
            I have read and agree to the booking, cancellation, late, and no-show policies.
            <span className="mt-1 block text-muted-foreground/70">
              Please review the business policies before confirming.
            </span>
          </span>
        </label>
      )}

      {/* Full edit path — the customer is never trapped here. Quiet
          secondary controls; the Confirm button below stays primary. */}
      {(onEditService || onEditBarber || onEditDate || onEditTime || onEditInfo) && (
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border/60 pt-5">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Need a change?
          </span>
          {onEditService && (
            <button type="button" onClick={onEditService} className="inline-flex min-h-9 items-center rounded-md border border-input bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-secondary focus-ring">
              Edit Service
            </button>
          )}
          {onEditBarber && (
            <button type="button" onClick={onEditBarber} className="inline-flex min-h-9 items-center rounded-md border border-input bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-secondary focus-ring">
              Edit Barber
            </button>
          )}
          {onEditDate && (
            <button type="button" onClick={onEditDate} className="inline-flex min-h-9 items-center rounded-md border border-input bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-secondary focus-ring">
              Edit Date
            </button>
          )}
          {onEditTime && (
            <button type="button" onClick={onEditTime} className="inline-flex min-h-9 items-center rounded-md border border-input bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-secondary focus-ring">
              Edit Time
            </button>
          )}
          {onEditInfo && (
            <button type="button" onClick={onEditInfo} className="inline-flex min-h-9 items-center rounded-md border border-input bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-secondary focus-ring">
              Edit Information
            </button>
          )}
        </div>
      )}

      {/* Confirm — the confident end of the flow */}
      <div className="mt-8">
        <Button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting}
          className="w-full h-14 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-base transition-all duration-micro focus-ring disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              <span>Creating Appointment…</span>
            </span>
          ) : (
            <span>Confirm Appointment</span>
          )}
        </Button>
      </div>
    </div>
  )
}

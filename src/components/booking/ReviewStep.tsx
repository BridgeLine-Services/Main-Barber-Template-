'use client'

import React from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatFullDate, formatDuration, formatPrice } from '@/lib/utils'
import { PAYMENT_DISCLAIMER } from '@/lib/constants'
import {
  Scissors,
  User,
  Calendar,
  Clock,
  Mail,
  Phone,
  FileText,
  AlertCircle,
  Loader2,
  CheckCircle,
  CreditCard,
  ShieldAlert,
} from 'lucide-react'

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
}

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
}: ReviewStepProps) {
  return (
    <div className="space-y-4 max-w-xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Review & Confirm</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Please review your booking details before confirming your appointment.
        </p>
      </div>

      {error && (
        <Card className="p-4 bg-red-950/40 border-red-800 text-red-200 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <h4 className="font-semibold text-sm">Booking Error</h4>
          </div>
          <p className="text-xs text-red-300 leading-relaxed">{error}</p>
          {onBackToTime && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onBackToTime}
              className="mt-1 self-start border-red-800 text-red-200 hover:bg-red-900/50"
            >
              Select a Different Time Slot
            </Button>
          )}
        </Card>
      )}

      <Card className="p-6 bg-card/80 border-border shadow-xl shadow-black/10 space-y-6">
        {/* Service & Barber Details */}
        <div className="space-y-3 pb-5 border-b border-border">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-accent/30 flex items-center justify-center text-accent shrink-0">
                <Scissors className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">
                  {service?.name || 'Selected Service'}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {service ? `${formatDuration(service.duration)}` : ''}
                </p>
              </div>
            </div>
            <span className="text-lg font-bold text-accent">
              {service ? formatPrice(service.price) : ''}
            </span>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <div className="w-10 h-10 rounded-lg bg-secondary border border-border flex items-center justify-center text-foreground/70 shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Barber</p>
              <p className="text-sm font-semibold text-foreground/80">
                {barber?.name || 'Any Available Barber'}
              </p>
            </div>
          </div>
        </div>

        {/* Date & Time */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-secondary/80 border border-border/80 flex items-center justify-center text-accent shrink-0">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Date</p>
              <p className="text-sm font-semibold text-foreground/80">
                {date ? formatFullDate(date) : '-'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-secondary/80 border border-border/80 flex items-center justify-center text-accent shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Time</p>
              <p className="text-sm font-semibold text-foreground/80">{time || '-'}</p>
            </div>
          </div>
        </div>

        {/* Customer Information */}
        <div className="space-y-3 pb-5 border-b border-border">
          <h4 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
            Customer Information
          </h4>
          <div className="bg-background/80 p-4 rounded-lg border border-border space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Name:</span>
              <span className="font-semibold text-foreground/80">
                {customerInfo.firstName} {customerInfo.lastName}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Phone:</span>
              <span className="font-semibold text-foreground/80">{customerInfo.phone}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Email:</span>
              <span className="font-semibold text-foreground/80">{customerInfo.email}</span>
            </div>
            {customerInfo.notes && (
              <div className="pt-2 border-t border-border">
                <span className="text-muted-foreground block mb-1">Notes:</span>
                <p className="text-foreground/70 italic">{customerInfo.notes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Payment & Disclaimer */}
        <div className="space-y-3 bg-accent/5 border border-amber-500/20 p-4 rounded-lg">
          <div className="flex items-center gap-2 text-accent font-semibold text-xs">
            <CreditCard className="w-4 h-4" />
            <span>Payment Information</span>
          </div>
          <p className="text-xs font-medium text-amber-200/90">
            Payment: Pay in person at the barbershop.
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{PAYMENT_DISCLAIMER}</p>
        </div>

        {Object.values(policies).some(Boolean) && (
          <label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={policyAccepted}
              onChange={(event) => onPolicyAcceptedChange(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-amber-500"
            />
            <span>
              I have read and agree to the configured booking, cancellation, late, and no-show policies.
              <span className="mt-1 block text-zinc-500">Please review the business policies before confirming.</span>
            </span>
          </label>
        )}

        {/* Confirm Action */}
        <div className="pt-2">
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="w-full bg-amber-500 hover:brightness-110 text-zinc-950 font-extrabold h-14 text-base transition-all shadow-lg shadow-amber-500/20 disabled:opacity-50"
          >
            {isSubmitting ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Creating Appointment...</span>
              </div>
            ) : (
              <span>Confirm Appointment</span>
            )}
          </Button>
        </div>
      </Card>
    </div>
  )
}

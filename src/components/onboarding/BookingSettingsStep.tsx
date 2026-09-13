'use client'

// Onboarding Step — Booking Settings.
// Configures how customers book: walk-ins, rescheduling, and shop policies.
// All values persist on the authenticated owner's Business record.
//
// PAYMENT IN PERSON IS FIXED: there is no online payment processing in this
// product. The step displays this as a locked setting, never as a choice.

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ArrowLeft, Banknote, Check, Loader2, Lock } from 'lucide-react'

export interface BookingSettingsForm {
  walkInsWelcome: boolean
  firstAvailableBookingEnabled: boolean
  customerRescheduleEnabled: boolean
  customerRescheduleMinNoticeHours: string
  customerRescheduleWindowDays: string // '' = no limit
  bookingPolicy: string
  cancellationPolicy: string
  latePolicy: string
  noShowPolicyText: string
}

interface BookingSettingsStepProps {
  initial: BookingSettingsForm
  businessName: string
  submitting: boolean
  serverError: string | null
  onFinish: (settings: BookingSettingsForm) => void
  onSaveForLater: (settings: BookingSettingsForm) => void
  onBack: () => void
}

// Generic example placeholders — intentionally NOT pre-filled values, so no
// template text is silently stored as the shop's permanent policy.
const PLACEHOLDERS = {
  bookingPolicy: 'e.g. Appointments can be booked online up to 30 days in advance.',
  cancellationPolicy: 'e.g. Please cancel or reschedule at least 2 hours before your appointment.',
  latePolicy: 'e.g. Arriving more than 10 minutes late may shorten your service.',
  noShowPolicyText: 'e.g. Missed appointments without notice may require prepayment next time.',
}

export function BookingSettingsStep({
  initial,
  businessName,
  submitting,
  serverError,
  onFinish,
  onSaveForLater,
  onBack,
}: BookingSettingsStepProps) {
  const [form, setForm] = useState<BookingSettingsForm>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})

  function validate(): Record<string, string> {
    const e: Record<string, string> = {}
    const notice = Number(form.customerRescheduleMinNoticeHours)
    if (form.customerRescheduleMinNoticeHours === '' || Number.isNaN(notice) || notice < 0) {
      e.notice = 'Enter 0 or more hours'
    } else if (notice > 720) {
      e.notice = 'Maximum 720 hours (30 days)'
    }
    if (!Number.isInteger(notice)) e.notice = 'Whole hours only'
    if (form.customerRescheduleWindowDays !== '') {
      const w = Number(form.customerRescheduleWindowDays)
      if (Number.isNaN(w) || w < 1) e.window = 'Enter at least 1 day, or leave blank for no limit'
      else if (w > 3650) e.window = 'That window is too long'
      else if (!Number.isInteger(w)) e.window = 'Whole days only'
    }
    return e
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const v = validate()
    setErrors(v)
    if (Object.keys(v).length > 0) return
    onFinish(form)
  }

  return (
    <Card className="border-zinc-800 bg-zinc-900/60 max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-zinc-100">Booking Settings</CardTitle>
        <CardDescription>
          How customers book at {businessName}. You can change all of this later in Settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Payment in person — fixed, not configurable */}
          <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="text-sm">
              <p className="font-medium text-amber-200">Payment is collected in person</p>
              <p className="mt-0.5 text-xs text-amber-200/70">
                Online payments are not part of this product. Customers pay at the shop after their
                service — prices shown on your site are for display only.
              </p>
            </div>
            <Lock className="ml-auto h-3.5 w-3.5 shrink-0 text-amber-400/60" />
          </div>

          {/* Toggles */}
          <div className="space-y-3">
            <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
              <span>
                <span className="block text-sm font-medium text-zinc-200">Walk-ins welcome</span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  Show a &ldquo;walk-ins welcome&rdquo; note on your booking page
                </span>
              </span>
              <input
                type="checkbox"
                checked={form.walkInsWelcome}
                onChange={(e) => setForm({ ...form, walkInsWelcome: e.target.checked })}
                className="h-5 w-5 rounded border-zinc-700"
              />
            </label>

            <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
              <span>
                <span className="block text-sm font-medium text-zinc-200">&ldquo;First available&rdquo; booking</span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  Let customers book the earliest open slot with any eligible barber, or keep barber-first booking only
                </span>
              </span>
              <input
                type="checkbox"
                checked={form.firstAvailableBookingEnabled}
                onChange={(e) => setForm({ ...form, firstAvailableBookingEnabled: e.target.checked })}
                className="h-5 w-5 rounded border-zinc-700"
              />
            </label>

            <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
              <span>
                <span className="block text-sm font-medium text-zinc-200">
                  Customers can reschedule or cancel themselves
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  Let customers manage their own appointments from their confirmation link
                </span>
              </span>
              <input
                type="checkbox"
                checked={form.customerRescheduleEnabled}
                onChange={(e) => setForm({ ...form, customerRescheduleEnabled: e.target.checked })}
                className="h-5 w-5 rounded border-zinc-700"
              />
            </label>
          </div>

          {/* Numeric settings */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-zinc-300">Minimum notice to reschedule (hours)</Label>
              <Input
                type="number"
                min={0}
                max={720}
                step={1}
                className="mt-1.5"
                value={form.customerRescheduleMinNoticeHours}
                onChange={(e) =>
                  setForm({ ...form, customerRescheduleMinNoticeHours: e.target.value })
                }
              />
              {errors.notice && <p className="mt-1 text-xs text-red-400">{errors.notice}</p>}
            </div>
            <div>
              <Label className="text-zinc-300">Rescheduling window (days)</Label>
              <Input
                type="number"
                min={1}
                max={3650}
                step={1}
                className="mt-1.5"
                value={form.customerRescheduleWindowDays}
                onChange={(e) =>
                  setForm({ ...form, customerRescheduleWindowDays: e.target.value })
                }
                placeholder="No limit"
              />
              {errors.window && <p className="mt-1 text-xs text-red-400">{errors.window}</p>}
            </div>
          </div>

          {/* Policies */}
          <div className="space-y-4">
            <div>
              <Label className="text-zinc-300">Booking policy</Label>
              <Textarea
                className="mt-1.5"
                rows={2}
                value={form.bookingPolicy}
                onChange={(e) => setForm({ ...form, bookingPolicy: e.target.value })}
                placeholder={PLACEHOLDERS.bookingPolicy}
              />
            </div>
            <div>
              <Label className="text-zinc-300">Cancellation policy</Label>
              <Textarea
                className="mt-1.5"
                rows={2}
                value={form.cancellationPolicy}
                onChange={(e) => setForm({ ...form, cancellationPolicy: e.target.value })}
                placeholder={PLACEHOLDERS.cancellationPolicy}
              />
            </div>
            <div>
              <Label className="text-zinc-300">Late policy</Label>
              <Textarea
                className="mt-1.5"
                rows={2}
                value={form.latePolicy}
                onChange={(e) => setForm({ ...form, latePolicy: e.target.value })}
                placeholder={PLACEHOLDERS.latePolicy}
              />
            </div>
            <div>
              <Label className="text-zinc-300">No-show policy</Label>
              <Textarea
                className="mt-1.5"
                rows={2}
                value={form.noShowPolicyText}
                onChange={(e) => setForm({ ...form, noShowPolicyText: e.target.value })}
                placeholder={PLACEHOLDERS.noShowPolicyText}
              />
            </div>
            <p className="text-xs text-zinc-500">
              Leave any policy blank for now — nothing is stored until you write your own text.
            </p>
          </div>

          {serverError && <p className="text-sm text-red-400">{serverError}</p>}

          {/* Navigation */}
          <div className="flex flex-col gap-3 border-t border-zinc-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="outline" onClick={onBack} disabled={submitting}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
            </Button>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const v = validate()
                  setErrors(v)
                  if (Object.keys(v).length === 0) onSaveForLater(form)
                }}
                disabled={submitting}
              >
                Save &amp; finish later
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Check className="mr-1.5 h-4 w-4" /> Continue to Review
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

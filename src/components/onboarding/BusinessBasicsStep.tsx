'use client'

// Onboarding Step 2 — Business Basics.
// Collects: business name, slug, timezone, phone, email.
// No hardcoded customer values — everything entered here is saved to the
// authenticated owner's Business record via the onboarding API.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { TimezoneSelect } from './TimezoneSelect'
import {
  slugify,
  validateSlug,
  detectTimezone,
} from '@/lib/onboarding-constants'
import { isValidEmail, isValidPhone, formatPhoneInput } from '@/lib/utils'
import { ArrowLeft, ArrowRight, Check, Loader2, X, Link2 } from 'lucide-react'

export interface BasicsForm {
  businessName: string
  slug: string
  timezone: string | null
  phone: string
  email: string
}

interface BusinessBasicsStepProps {
  initial: BasicsForm
  mode: 'create' | 'update' // create = no business yet; update = editing existing record
  submitting: boolean
  serverError: string | null
  slugServerError?: string | null
  onSubmit: (data: BasicsForm) => void
  onBack: () => void
}

type SlugStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'unavailable'

export function BusinessBasicsStep({
  initial,
  mode,
  submitting,
  serverError,
  slugServerError,
  onSubmit,
  onBack,
}: BusinessBasicsStepProps) {
  const [form, setForm] = useState<BasicsForm>(() => ({
    businessName: initial.businessName || '',
    slug: initial.slug || '',
    // Detect the user's timezone from their browser — never hardcoded.
    timezone: initial.timezone || detectTimezone(),
    phone: initial.phone || '',
    email: initial.email || '',
  }))
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(mode === 'update')
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle')
  const [slugRetry, setSlugRetry] = useState(0)
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── Field updates ───────────────────────────────────────────────────────
  const setName = (name: string) => {
    setForm((f) => {
      const next = { ...f, businessName: name }
      // Auto-generate slug from name until the user edits it directly
      if (!slugManuallyEdited) next.slug = slugify(name)
      return next
    })
  }

  const setSlug = (slug: string) => {
    setSlugManuallyEdited(true)
    // Force lowercase, convert spaces to hyphens as they type
    setForm((f) => ({ ...f, slug: slug.toLowerCase().replace(/\s+/g, '-') }))
  }

  const setPhone = (phone: string) => {
    setForm((f) => ({ ...f, phone: formatPhoneInput(phone) }))
  }

  // ─── Validation ──────────────────────────────────────────────────────────
  const errors = useMemo(() => {
    const e: Partial<Record<keyof BasicsForm, string | null>> = {}
    if (!form.businessName.trim()) e.businessName = 'Business name is required'
    else if (form.businessName.trim().length < 2) e.businessName = 'Business name must be at least 2 characters'

    const slugError = form.slug ? validateSlug(form.slug) : 'Slug is required'
    e.slug = slugError

    if (!form.timezone) e.timezone = 'Please select your timezone'

    if (!form.phone.trim()) e.phone = 'Business phone is required'
    else if (!isValidPhone(form.phone)) e.phone = 'Enter a valid phone number (10 digits)'

    if (!form.email.trim()) e.email = 'Business email is required'
    else if (!isValidEmail(form.email)) e.email = 'Enter a valid email address'

    return e
  }, [form])

  const isValid = Object.values(errors).every((v) => !v)

  // ─── Live slug availability check (debounced) ────────────────────────────
  useEffect(() => {
    if (checkTimer.current) clearTimeout(checkTimer.current)
    const slugError = form.slug ? validateSlug(form.slug) : 'empty'
    if (!form.slug || slugError) {
      setSlugStatus(form.slug && slugError ? 'invalid' : 'idle')
      return
    }
    // In update mode, no need to re-check the unchanged slug
    if (mode === 'update' && form.slug === initial.slug) {
      setSlugStatus('idle')
      return
    }
    setSlugStatus('checking')
    checkTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/dashboard/onboarding?checkSlug=${encodeURIComponent(form.slug)}`)
        if (!res.ok) {
          // Server-side failure (auth, database, etc.) — NOT proof the slug is taken.
          setSlugStatus('unavailable')
          return
        }
        const data = await res.json()
        // Only a definitive boolean answer counts. Anything else is unknown.
        setSlugStatus(
          data.slugAvailable === true ? 'available'
          : data.slugAvailable === false ? 'taken'
          : 'unavailable'
        )
      } catch {
        // Network failure — availability is genuinely unknown, never "taken".
        setSlugStatus('unavailable')
      }
    }, 450)
    return () => {
      if (checkTimer.current) clearTimeout(checkTimer.current)
    }
  }, [form.slug, mode, initial.slug, slugRetry])

  const showSlugError = touched.slug || !!slugServerError
  const slugTaken = slugStatus === 'taken' || !!slugServerError
  const canSubmit =
    isValid &&
    !submitting &&
    slugStatus !== 'invalid' &&
    slugStatus !== 'taken' &&
    slugStatus !== 'checking' &&
    slugStatus !== 'unavailable' &&
    !slugServerError

  const markTouched = (field: string) => setTouched((t) => ({ ...t, [field]: true }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Show all validation errors on submit attempt
    setTouched({ businessName: true, slug: true, timezone: true, phone: true, email: true })
    if (!canSubmit) return
    onSubmit({
      businessName: form.businessName.trim(),
      slug: form.slug,
      timezone: form.timezone!,
      phone: form.phone,
      email: form.email.trim(),
    })
  }

  const inputClass = (field: keyof BasicsForm) =>
    `bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-amber-500/50 ${
      (touched[field] && errors[field]) || (field === 'slug' && showSlugError && slugTaken)
        ? 'border-red-500/70'
        : 'border-zinc-700'
    }`

  return (
    <Card className="border-zinc-800 bg-zinc-900/60 max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-zinc-100">Business Basics</CardTitle>
        <CardDescription>
          {mode === 'create'
            ? 'Tell customers who you are. This creates your shop record — you can change anything later in Settings.'
            : 'Update your shop details. Changes save to your business record.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {serverError && (
            <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
              <X className="h-4 w-4 shrink-0" />
              {serverError}
            </div>
          )}

          {/* Business name */}
          <div>
            <div className="text-sm font-medium text-zinc-200 mb-1.5">
              Business Name <span className="text-red-400">*</span>
            </div>
            <Input
              value={form.businessName}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => markTouched('businessName')}
              placeholder="e.g. Iron & Oak Barbershop"
              maxLength={100}
              className={inputClass('businessName')}
              disabled={submitting}
            />
            {touched.businessName && errors.businessName && (
              <p className="mt-1.5 text-xs text-red-400">{errors.businessName}</p>
            )}
          </div>

          {/* Slug */}
          <div>
            <div className="text-sm font-medium text-zinc-200 mb-1.5">
              Web Address (Slug) <span className="text-red-400">*</span>
            </div>
            <div className="flex items-stretch">
              <span className="inline-flex items-center rounded-l-md border border-r-0 border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-500">
                <Link2 className="h-4 w-4" />
              </span>
              <Input
                value={form.slug}
                onChange={(e) => {
                  setSlug(e.target.value)
                  markTouched('slug')
                }}
                placeholder="your-shop-name"
                maxLength={80}
                className={`rounded-l-none ${inputClass('slug')}`}
                disabled={submitting}
                autoComplete="off"
              />
            </div>
            <div className="mt-1.5 min-h-[1rem] text-xs">
              {showSlugError && slugTaken ? (
                <p className="text-red-400">{slugServerError || 'That slug is already taken — try another.'}</p>
              ) : slugStatus === 'invalid' && touched.slug ? (
                <p className="text-red-400">{errors.slug}</p>
              ) : slugStatus === 'unavailable' ? (
                <p className="text-amber-400 flex items-center gap-1.5">
                  <X className="h-3 w-3" /> Couldn't check availability — the server didn't answer.{' '}
                  <button type="button" className="underline underline-offset-2" onClick={() => setSlugRetry((n) => n + 1)}>
                    Retry
                  </button>
                </p>
              ) : slugStatus === 'checking' ? (
                <p className="text-zinc-500 flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> Checking availability…
                </p>
              ) : slugStatus === 'available' ? (
                <p className="text-emerald-400 flex items-center gap-1.5">
                  <Check className="h-3 w-3" /> Available
                </p>
              ) : (
                <p className="text-zinc-500">
                  Lowercase letters, numbers, and hyphens. Auto-generated from your name — edit if you like.
                </p>
              )}
            </div>
          </div>

          {/* Timezone */}
          <TimezoneSelect
            value={form.timezone}
            onChange={(tz) => {
              setForm((f) => ({ ...f, timezone: tz }))
              setTouched((t) => ({ ...t, timezone: true }))
            }}
            error={touched.timezone && errors.timezone ? errors.timezone : null}
          />

          {/* Phone + Email */}
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <div className="text-sm font-medium text-zinc-200 mb-1.5">
                Business Phone <span className="text-red-400">*</span>
              </div>
              <Input
                value={form.phone}
                onChange={(e) => {
                  setPhone(e.target.value)
                  markTouched('phone')
                }}
                placeholder="(555) 123-4567"
                inputMode="tel"
                maxLength={16}
                className={inputClass('phone')}
                disabled={submitting}
              />
              {touched.phone && errors.phone && <p className="mt-1.5 text-xs text-red-400">{errors.phone}</p>}
            </div>
            <div>
              <div className="text-sm font-medium text-zinc-200 mb-1.5">
                Business Email <span className="text-red-400">*</span>
              </div>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => {
                  setForm((f) => ({ ...f, email: e.target.value }))
                  markTouched('email')
                }}
                placeholder="hello@yourshop.com"
                inputMode="email"
                maxLength={255}
                className={inputClass('email')}
                disabled={submitting}
              />
              {touched.email && errors.email && <p className="mt-1.5 text-xs text-red-400">{errors.email}</p>}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              disabled={submitting}
              className="text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800"
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  Continue <ArrowRight className="h-4 w-4 ml-1.5" />
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

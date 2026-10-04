'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { BookingProgress } from '@/components/booking/BookingProgress'
import { ServiceStep } from '@/components/booking/ServiceStep'
import { BarberStep, type EarliestSlot } from '@/components/booking/BarberStep'
import { DateStep } from '@/components/booking/DateStep'
import { TimeStep } from '@/components/booking/TimeStep'
import { CustomerInfoStep } from '@/components/booking/CustomerInfoStep'
import { ReviewStep } from '@/components/booking/ReviewStep'
import { ArrowLeft, ArrowRight, Scissors, AlertCircle, Info, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  applyServiceChange,
  applyBarberChange,
  applyDateChange,
} from '@/lib/booking-flow'

interface Service {
  id: string
  name: string
  description: string | null
  duration: number
  price: number
}

interface Barber {
  id: string
  name: string
  photo: string | null
  specialty: string | null
  bio: string | null
  services?: { serviceId: string }[]
}

interface CustomerInfo {
  firstName: string
  lastName: string
  phone: string
  email: string
  notes?: string
  smsConsent?: boolean
  answers?: Record<string, string | boolean | string[]>
}


function BookingFlow() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [services, setServices] = useState<Service[]>([])
  const [barbers, setBarbers] = useState<Barber[]>([])
  const [selectedServiceId, setSelectedServiceId] = useState<string>('')
  const [selectedBarberId, setSelectedBarberId] = useState<string>('')
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedTime, setSelectedTime] = useState<string>('')
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    firstName: '', lastName: '', phone: '', email: '', notes: '', smsConsent: false,
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [bookingError, setBookingError] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  // Track the resolved barber name for the review step when 'any' or 'first-available' resolves to a specific barber
  const [resolvedBarberName, setResolvedBarberName] = useState<string>('')
  const [policies, setPolicies] = useState<{ booking?: string | null; cancellation?: string | null; late?: string | null; noShow?: string | null }>({})
  // Owner-configurable: when false, the "First available" option is hidden
  // (defaults to true for businesses that haven't set it).
  const [firstAvailableEnabled, setFirstAvailableEnabled] = useState(true)
  const [policyVersion, setPolicyVersion] = useState<string | null>(null)
  const [policyAccepted, setPolicyAccepted] = useState(false)
  // Customer-facing explanations (invalidated selections, hand-offs from
  // quick booking). Never used to justify a silent selection change.
  const [notice, setNotice] = useState('')

  // ─── State persistence (localStorage) ─────────────────────────────
  // Saves booking progress so a page refresh doesn't lose selections.
  const STORAGE_KEY = 'barber-booking-progress'

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        if (data.step) setStep(data.step)
        if (data.selectedServiceId) setSelectedServiceId(data.selectedServiceId)
        if (data.selectedBarberId) setSelectedBarberId(data.selectedBarberId)
        if (data.selectedDate) setSelectedDate(new Date(data.selectedDate))
        if (data.selectedTime) setSelectedTime(data.selectedTime)
        // Deliberately do NOT restore customerInfo (PII) from localStorage
        // to protect customer privacy on shared devices.
      }
    } catch {
      // Ignore corrupted storage
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        step,
        selectedServiceId,
        selectedBarberId,
        selectedDate: selectedDate?.toISOString() || null,
        selectedTime,
        // Deliberately excluded: customerInfo (name, phone, email, notes)
        // to prevent PII leakage on shared devices.
      }))
    } catch {
      // Storage full or unavailable — non-critical
    }
  }, [step, selectedServiceId, selectedBarberId, selectedDate, selectedTime])

  // Pre-fill from URL params (service/barber from service menus and barber
  // cards; date from the homepage quick-booking finder; time from a quick-
  // booking slot). Everything stays editable — preselecting is a convenience,
  // never a lock-in.
  useEffect(() => {
    const serviceParam = searchParams.get('serviceId')
    const barberParam = searchParams.get('barberId')
    const dateParam = searchParams.get('date')
    const timeParam = searchParams.get('time')
    if (serviceParam) setSelectedServiceId(serviceParam)
    if (barberParam) setSelectedBarberId(barberParam)
    let parsedDate: Date | null = null
    if (dateParam) {
      // Strict YYYY-MM-DD parse — anything else is ignored, never guessed.
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateParam)
      if (m) {
        const parsed = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
        if (!Number.isNaN(parsed.getTime())) {
          parsedDate = parsed
          setSelectedDate(parsed)
        }
      }
    }
    // Quick-booking handoff: a full service/barber/date/time selection lands
    // on the Time step so the customer SEES the chosen time preselected and
    // can change it before continuing. Never auto-advances past it.
    if (serviceParam && parsedDate && timeParam) {
      setSelectedTime(timeParam)
      setStep(4)
      setNotice(
        `${timeParam} is preselected from your search. Change it below if you'd like — nothing is booked yet.`
      )
    }
  }, [searchParams])

  // Fetch services and barbers on mount
  useEffect(() => {
    Promise.all([
      fetch('/api/services').then(r => r.json()),
      fetch('/api/barbers').then(r => r.json()),
      fetch('/api/public/policies').then(r => r.json()).catch(() => ({ policies: {}, version: null })),
    ]).then(([s, b, policyData]) => {
      // APIs return { services: [...] }, { barbers: [...] }, and optional policies.
      const loadedServices = s.services || []
      const loadedBarbers = b.barbers || []
      setServices(loadedServices)
      setBarbers(loadedBarbers)
      setPolicies(policyData.policies || {})
      if (policyData.booking?.firstAvailableEnabled === false) setFirstAvailableEnabled(false)
      setPolicyVersion(policyData.version || null)
      // Deep-link preselects (e.g. "Book your usual") are only kept when the
      // service/barber still exists and is offered — otherwise fall back to
      // the normal flow instead of preselecting a dead id.
      setSelectedServiceId(prev => loadedServices.some(svc => svc.id === prev) ? prev : '')
      setSelectedBarberId(prev => loadedBarbers.some(bb => bb.id === prev) ? prev : '')
      setLoading(false)
    }).catch(() => {
      setLoadError(true)
      setLoading(false)
    })
  }, [])

  const selectedService = services.find(s => s.id === selectedServiceId) ?? null
  const selectedBarber = barbers.find(b => b.id === selectedBarberId) ?? null
  // For the review step, use the resolved barber name if we have one and the selected barber is 'any'/'first-available'
  const displayBarber = (selectedBarberId === 'any' || selectedBarberId === 'first-available')
    ? (resolvedBarberName ? { name: resolvedBarberName } : null)
    : selectedBarber

  const canProceed = () => {
    switch (step) {
      case 1: return !!selectedServiceId
      case 2: return !!selectedBarberId
      case 3: return !!selectedDate
      case 4: return !!selectedTime
      case 5: return !!customerInfo.firstName && !!customerInfo.lastName && !!customerInfo.phone && !!customerInfo.email
      default: return true
    }
  }

  // ─── "First Available" — a suggestion the customer explicitly accepts ──────
  // The barber/date/time are prefilled ONLY when the customer clicks
  // "Use This Appointment". Even then everything stays editable: the flow
  // continues through the normal wizard, and the Review step exposes an
  // Edit control for every selection.
  const handleUseFirstAvailable = (slot: EarliestSlot) => {
    setSelectedBarberId(slot.barberId)
    setResolvedBarberName(slot.barberName)
    setSelectedDate(new Date(slot.date + 'T00:00:00'))
    setSelectedTime(slot.time)
    setStep(5) // Continue the normal flow at Customer Information
    setNotice(
      `Suggested appointment preselected: ${slot.barberName}, ${slot.time}. You can change any of it before confirming.`
    )
  }

  // "Choose Another Date" from the suggestion: keep the customer in 'any
  // barber' mode (no barber chosen for them) and let them pick a date; the
  // Time step will show every barber's open times for that date.
  const handleFirstAvailableOtherDate = (slot: EarliestSlot) => {
    setSelectedBarberId('any')
    setResolvedBarberName('')
    setSelectedDate(new Date(slot.date + 'T00:00:00'))
    setSelectedTime('')
    setStep(3)
    setNotice(
      'Pick any date — we’ll show open times across the whole team for the day you choose.'
    )
  }

  // ─── Time selection — marks the choice, never auto-advances ─────────────────
  // Under "Any Available Barber" the chosen slot resolves to a specific
  // barber; we capture that id so the review shows the real barber.
  const handleTimeSelect = (time: string, specificBarberId?: string) => {
    if (time === '') {
      // "Change Time" — deselect only; the customer stays on this step.
      setSelectedTime('')
      return
    }
    if (specificBarberId && specificBarberId !== selectedBarberId) {
      // Resolve the barber name for the review step
      const barber = barbers.find(b => b.id === specificBarberId)
      if (barber) setResolvedBarberName(barber.name)
      setSelectedBarberId(specificBarberId)
    }
    setSelectedTime(time)
    // No setStep here — the customer reviews their choice and presses
    // Continue when ready.
  }

  // A preselected time that no longer exists in the live slot list is
  // cleared (never silently replaced with another time) and explained.
  const handleClearInvalidTime = (reason: string) => {
    setSelectedTime('')
    setNotice(reason)
  }

  // ─── Selection changes with invalidation ────────────────────────────────
  // When a change invalidates a later selection, clear ONLY the invalid part
  // and explain why (booking-flow.ts holds the pure rules, unit-tested).

  const handleServiceSelect = (id: string) => {
    const result = applyServiceChange(
      {
        serviceId: selectedServiceId,
        barberId: selectedBarberId,
        dateISO: selectedDate ? selectedDate.toISOString().split('T')[0] : null,
        time: selectedTime,
      },
      id,
      barbers
    )
    setSelectedServiceId(result.selections.serviceId)
    if (result.selections.barberId !== selectedBarberId) setSelectedBarberId(result.selections.barberId)
    setSelectedTime(result.selections.time)
    if (result.selections.barberId === '') setResolvedBarberName('')
    setNotice(result.notice ?? '')
    setStep(2)
  }

  const handleBarberSelect = (id: string) => {
    const result = applyBarberChange(
      {
        serviceId: selectedServiceId,
        barberId: selectedBarberId,
        dateISO: selectedDate ? selectedDate.toISOString().split('T')[0] : null,
        time: selectedTime,
      },
      id
    )
    setSelectedBarberId(result.selections.barberId)
    setSelectedTime(result.selections.time)
    setResolvedBarberName('')
    setNotice('')
    setStep(3)
  }

  const handleDateSelect = (d: Date) => {
    const result = applyDateChange(
      {
        serviceId: selectedServiceId,
        barberId: selectedBarberId,
        dateISO: selectedDate ? selectedDate.toISOString().split('T')[0] : null,
        time: selectedTime,
      },
      d.toISOString().split('T')[0]
    )
    setSelectedDate(d)
    setSelectedTime(result.selections.time)
    setNotice('')
    setStep(4)
  }

  const handleConfirm = async () => {
    setIsSubmitting(true)
    setBookingError('')

    try {
      const dateStr = selectedDate!.toISOString().split('T')[0]

      // Sanitize barberId before sending to API
      // 'first-available' is a UI-only concept — the specific barber was already
      // resolved when the user selected their time slot. If somehow still
      // 'first-available' or 'any', the backend will resolve it.
      let apiBarberId = selectedBarberId
      if (apiBarberId === 'first-available') {
        apiBarberId = 'any'
      }

      const policiesRequired = Object.values(policies).some(Boolean)
      if (policiesRequired && !policyAccepted) {
        setBookingError('Please acknowledge the booking policies before confirming your appointment.')
        setIsSubmitting(false)
        return
      }

      const res = await fetch('/api/public/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barberId: apiBarberId,
          serviceId: selectedServiceId,
          date: dateStr,
          time: selectedTime,
          customer: {
            firstName: customerInfo.firstName,
            lastName: customerInfo.lastName,
            phone: customerInfo.phone,
            email: customerInfo.email,
            notes: customerInfo.notes || undefined,
            smsConsent: customerInfo.smsConsent,
            answers: customerInfo.answers,
          },
          policiesAcceptedAt: policyAccepted ? new Date().toISOString() : undefined,
          policyVersion: policyAccepted ? policyVersion : undefined,
        }),
      })

      const data = await res.json()

      if (data.success) {
        // Clear booking progress from localStorage after successful booking
        try { localStorage.removeItem('barber-booking-progress') } catch {}
        router.push(`/appointment/${data.confirmationNumber}?token=${data.customerAccessToken}`)
      } else {
        setBookingError(data.error || 'Booking failed. Please try again.')
      }
    } catch (_err) {
      setBookingError('An error occurred. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <Scissors className="mx-auto mb-4 h-12 w-12 animate-pulse text-accent" />
          <p className="text-muted-foreground">Loading booking system...</p>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="max-w-md space-y-4 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
            <AlertCircle className="h-8 w-8" />
          </div>
          <h2 className="font-display text-xl font-semibold text-foreground">Booking System Unavailable</h2>
          <p className="text-sm text-muted-foreground">
            We are experiencing a temporary issue with our booking system. Please try again later or call us to schedule your appointment.
          </p>
          <a href="/contact">
            <Button className="bg-accent text-accent-foreground hover:brightness-110 font-semibold">
              Contact Us
            </Button>
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Header — editorial, left-aligned, no badge box */}
        <div className="mb-8">
          <p className="eyebrow-accent mb-3">Reserve Your Chair</p>
          <h1 className="display-heading text-display-2 text-foreground">Book an Appointment</h1>
          <p className="mt-2 text-sm text-muted-foreground">Pay in person — no online payment required.</p>
        </div>

        {/* Progress */}
        <BookingProgress currentStep={step} totalSteps={6} />

        {/* Step content — animated transitions between steps.
            All step logic, preselection, and state handling is unchanged. */}
        {/* Step surface — editorial: hairline top, generous padding, no
            card-in-card chrome. Steps carry their own internal structure. */}
        <div className="mt-8 border-t-2 border-primary/60 pt-8 sm:pt-10">
              {notice && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mb-6 flex items-start gap-3 rounded-md border border-primary/30 bg-primary/[0.05] px-4 py-3"
                >
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <p className="text-sm text-foreground/90">{notice}</p>
                  <button
                    type="button"
                    onClick={() => setNotice('')}
                    aria-label="Dismiss message"
                    className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-ring"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}
              <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.28, ease: [0.21, 0.47, 0.32, 0.98] }}
              >
              {step === 1 && (
                <ServiceStep
                  services={services}
                  selectedId={selectedServiceId}
                  onSelect={handleServiceSelect}
                />
              )}

              {step === 2 && (
                <BarberStep
                  barbers={barbers}
                  selectedId={selectedBarberId}
                  onSelect={handleBarberSelect}
                  onUseFirstAvailable={firstAvailableEnabled ? handleUseFirstAvailable : undefined}
                  onChooseAnotherDate={firstAvailableEnabled ? handleFirstAvailableOtherDate : undefined}
                  serviceId={selectedServiceId}
                  serviceName={services.find(svc => svc.id === selectedServiceId)?.name ?? null}
                />
              )}

              {step === 3 && (
                <DateStep
                  selectedDate={selectedDate}
                  onSelect={handleDateSelect}
                  serviceId={selectedServiceId}
                  barberId={selectedBarberId}
                />
              )}

              {step === 4 && (
                <TimeStep
                  barberId={selectedBarberId}
                  serviceId={selectedServiceId}
                  selectedDate={selectedDate}
                  selectedTime={selectedTime}
                  onSelect={handleTimeSelect}
                  onClearInvalidTime={handleClearInvalidTime}
                />
              )}

              {step === 5 && (
          <CustomerInfoStep
            customerInfo={customerInfo}
            onChange={setCustomerInfo}
            onNext={() => setStep(6)}
          />
              )}

              {step === 6 && (
                <ReviewStep
                  service={selectedService}
                  barber={displayBarber}
                  date={selectedDate}
                  time={selectedTime}
                  customerInfo={customerInfo}
                  policies={policies}
                  policyAccepted={policyAccepted}
                  onPolicyAcceptedChange={setPolicyAccepted}
                  onConfirm={handleConfirm}
                  isSubmitting={isSubmitting}
                  error={bookingError}
                  onBackToTime={() => { setStep(4); setBookingError('') }}
                  onEditService={() => { setNotice(''); setStep(1) }}
                  onEditBarber={() => { setNotice(''); setStep(2) }}
                  onEditDate={() => { setNotice(''); setStep(3) }}
                  onEditTime={() => { setNotice(''); setStep(4) }}
                  onEditInfo={() => { setNotice(''); setStep(5) }}
                />
              )}
              </motion.div>
              </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          {step > 1 && step < 6 ? (
            <Button
              variant="outline"
              onClick={() => setStep(step - 1)}
              className="border-accent/30 text-foreground hover:bg-accent/10 hover:border-accent/50"
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
          ) : (
            <div />
          )}

          {step < 5 && canProceed() && (
            <Button
              onClick={() => { setNotice(''); setStep(step + 1) }}
              className="bg-accent text-accent-foreground hover:brightness-110"
            >
              Continue <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>

        {bookingError && step === 6 && (
          <div className="mt-4 text-center">
            <Button
              variant="outline"
              onClick={() => {
                setStep(4)
                setBookingError('')
                setNotice('That time was just taken — here are the times available now.')
              }}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              See available times
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function BookPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-center">
            <Scissors className="mx-auto mb-4 h-12 w-12 animate-pulse text-accent" />
            <p className="text-muted-foreground">Loading booking system...</p>
          </div>
        </div>
      }
    >
      <BookingFlow />
    </Suspense>
  )
}

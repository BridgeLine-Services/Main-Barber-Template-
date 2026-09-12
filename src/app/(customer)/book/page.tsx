'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { BookingProgress } from '@/components/booking/BookingProgress'
import { ServiceStep } from '@/components/booking/ServiceStep'
import { BarberStep, type EarliestSlot } from '@/components/booking/BarberStep'
import { DateStep } from '@/components/booking/DateStep'
import { TimeStep } from '@/components/booking/TimeStep'
import { CustomerInfoStep } from '@/components/booking/CustomerInfoStep'
import { ReviewStep } from '@/components/booking/ReviewStep'
import { ArrowLeft, ArrowRight, Scissors, AlertCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

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

const STEPS = ['Service', 'Barber', 'Date', 'Time', 'Info', 'Confirm']

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
  const [policyVersion, setPolicyVersion] = useState<string | null>(null)
  const [policyAccepted, setPolicyAccepted] = useState(false)

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

  // Pre-fill from URL params
  useEffect(() => {
    const serviceParam = searchParams.get('serviceId')
    const barberParam = searchParams.get('barberId')
    if (serviceParam) setSelectedServiceId(serviceParam)
    if (barberParam) setSelectedBarberId(barberParam)
  }, [searchParams])

  // Fetch services and barbers on mount
  useEffect(() => {
    Promise.all([
      fetch('/api/services').then(r => r.json()),
      fetch('/api/barbers').then(r => r.json()),
      fetch('/api/public/policies').then(r => r.json()).catch(() => ({ policies: {}, version: null })),
    ]).then(([s, b, policyData]) => {
      // APIs return { services: [...] }, { barbers: [...] }, and optional policies.
      setServices(s.services || [])
      setBarbers(b.barbers || [])
      setPolicies(policyData.policies || {})
      setPolicyVersion(policyData.version || null)
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

  // ─── Bug Fix #1: Handle "First Available" selection ──────────────────────────
  // When the user clicks "First Available", the BarberStep returns an EarliestSlot
  // containing the specific barber, date, and time of the earliest available slot.
  // We store the specific barber ID (so the customer books with the right person),
  // pre-select the date, and jump directly to the Time step so they can confirm
  // or pick a different time on that date.
  const handleFirstAvailable = (slot: EarliestSlot) => {
    // "First Available" resolves the earliest real slot across all barbers.
    // Set barber + date + time from the computed slot and jump straight to
    // Customer Info — all three selections are handled automatically.
    setSelectedBarberId(slot.barberId)
    setResolvedBarberName(slot.barberName)
    setSelectedDate(new Date(slot.date + 'T00:00:00'))
    setSelectedTime(slot.time) // Auto-select the earliest available time
    setStep(5) // Jump to Customer Info step
  }

  // ─── Bug Fix #2: Capture specificBarberId from TimeStep ──────────────────────
  // When the user selects a time under "Any Available Barber" or "First Available",
  // the TimeStep returns (time, specificBarberId). We must capture the barber ID
  // so the booking goes to the correct barber, not "any".
  const handleTimeSelect = (time: string, specificBarberId?: string) => {
    if (specificBarberId && specificBarberId !== selectedBarberId) {
      // Resolve the barber name for the review step
      const barber = barbers.find(b => b.id === specificBarberId)
      if (barber) setResolvedBarberName(barber.name)
      setSelectedBarberId(specificBarberId)
    }
    setSelectedTime(time)
    setStep(5)
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
    } catch (err) {
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
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Book an Appointment</h1>
          <p className="mt-2 text-muted-foreground">Pay in person — no online payment required.</p>
        </div>

        {/* Progress */}
        <BookingProgress currentStep={step} totalSteps={6} />

        {/* Step content — animated transitions between steps.
            All step logic, preselection, and state handling is unchanged. */}
        <div className="mt-8">
          <Card className="border-border/70 bg-card shadow-xl shadow-black/20">
            <CardContent className="p-6 sm:p-8">
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
                  onSelect={(id) => { setSelectedServiceId(id); setStep(2) }}
                />
              )}

              {step === 2 && (
                <BarberStep
                  barbers={barbers}
                  selectedId={selectedBarberId}
                  onSelect={(id) => { setSelectedBarberId(id); setStep(3) }}
                  onSelectFirstAvailable={handleFirstAvailable}
                  serviceId={selectedServiceId}
                />
              )}

              {step === 3 && (
                <DateStep
                  selectedDate={selectedDate}
                  onSelect={(d) => { setSelectedDate(d); setStep(4) }}
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
                />
              )}
              </motion.div>
              </AnimatePresence>
            </CardContent>
          </Card>
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

          {step < 5 && canProceed() && step !== 1 && step !== 2 && (
            <Button
              onClick={() => setStep(step + 1)}
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
              onClick={() => { setStep(4); setBookingError('') }}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              Select a different time
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

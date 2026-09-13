'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, CheckCircle2, XCircle, CalendarCheck } from 'lucide-react'

function ClaimContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''
  const [state, setState] = useState<'claiming' | 'success' | 'taken' | 'expired' | 'error'>('claiming')
  const [confirmationNumber, setConfirmationNumber] = useState<string | null>(null)
  const attempted = useRef(false)

  useEffect(() => {
    if (!token) {
      setState('error')
      return
    }
    if (attempted.current) return
    attempted.current = true

    fetch('/api/public/waitlist/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          setConfirmationNumber(data.appointment?.confirmationNumber || data.confirmationNumber || null)
          setState('success')
        } else if (res.status === 410) {
          setState('expired')
        } else if (res.status === 409) {
          setState('taken')
        } else {
          setState('error')
        }
      })
      .catch(() => setState('error'))
  }, [token])

  if (state === 'claiming') {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-zinc-400">
        <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
        <p className="text-sm">Checking availability…</p>
      </div>
    )
  }

  if (state === 'success') {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <CheckCircle2 className="w-14 h-14 text-emerald-400" />
        <h2 className="text-2xl font-bold text-white font-poppins">You're booked!</h2>
        <p className="text-sm text-zinc-400 max-w-sm">
          The open slot is yours. We've sent you a confirmation
          {confirmationNumber ? (
            <> with confirmation number <strong className="text-amber-400 font-mono">{confirmationNumber}</strong></>
          ) : null}
          .
        </p>
        <a href="/book" className="mt-4 inline-flex rounded-lg bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400">
          View Booking Options
        </a>
      </div>
    )
  }

  const message =
    state === 'taken'
      ? "This slot was just claimed by someone else. It was re-checked at the moment you clicked, and it's no longer free."
      : state === 'expired'
        ? 'This offer has expired. Offers are held for a limited time after notification.'
        : 'This claim link is invalid or no longer available.'

  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <XCircle className="w-14 h-14 text-red-400" />
      <h2 className="text-2xl font-bold text-white font-poppins flex items-center gap-2">
        <CalendarCheck className="w-6 h-6 text-red-400" /> Slot no longer available
      </h2>
      <p className="text-sm text-zinc-400 max-w-sm">{message}</p>
      <a href="/book" className="mt-4 inline-flex rounded-lg bg-amber-500 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400">
        Book Another Time
      </a>
    </div>
  )
}

export default function WaitlistClaimPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
        <Suspense
          fallback={
            <div className="flex flex-col items-center gap-3 py-12 text-zinc-400">
              <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
            </div>
          }
        >
          <ClaimContent />
        </Suspense>
      </div>
    </div>
  )
}

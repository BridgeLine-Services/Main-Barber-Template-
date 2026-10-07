'use client'

/**
 * Public gift card purchase form (digital cards).
 *
 * Flow: pick amount + purchaser/recipient details → POST
 * /api/gift-cards/purchase (creates a PENDING Stripe PaymentIntent + a
 * PENDING card and returns the clientSecret) → mount Stripe's Payment
 * Element → confirmPayment → poll /api/gift-cards/status until the
 * webhook activates the card. The code is only revealed after the payment
 * succeeds.
 */
import { useEffect, useRef, useState } from 'react'
import { loadStripe, type Stripe, type StripeElements } from '@stripe/stripe-js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { AlertCircle, CheckCircle2, Gift, Loader2, Loader } from 'lucide-react'

interface PurchaseResult {
  giftCardId: string
  code: string
  amount: number
  clientSecret?: string
}

type Phase = 'details' | 'pay' | 'done'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MIN_AMOUNT = 1
const MAX_AMOUNT = 5000

export function GiftCardPurchaseForm({
  shopName,
  denominations,
  publishableKey,
}: {
  shopName: string
  denominations: number[]
  publishableKey: string
}) {
  const [phase, setPhase] = useState<Phase>('details')
  const [amount, setAmount] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [purchaserName, setPurchaserName] = useState('')
  const [purchaserEmail, setPurchaserEmail] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PurchaseResult | null>(null)
  const [cardStatus, setCardStatus] = useState<string | null>(null)
  const [stripe, setStripe] = useState<Stripe | null>(null)
  const elementsRef = useRef<StripeElements | null>(null)

  // Clean up the Stripe element when the component unmounts.
  useEffect(() => {
    return () => {
      elementsRef.current = null
    }
  }, [])

  const resolvedAmount = () => {
    if (amount !== null) return amount
    const parsed = Number.parseFloat(customAmount)
    if (!Number.isFinite(parsed)) return null
    return Math.round(parsed * 100) / 100
  }

  const validateDetails = (): string | null => {
    const value = resolvedAmount()
    if (value === null || value < MIN_AMOUNT || value > MAX_AMOUNT) {
      return `Choose an amount between $${MIN_AMOUNT} and $${MAX_AMOUNT}.`
    }
    if (!purchaserName.trim()) return 'Please enter your name.'
    if (!purchaserEmail.trim() || !EMAIL_RE.test(purchaserEmail.trim())) {
      return 'Please enter a valid email address.'
    }
    if (recipientEmail.trim() && !EMAIL_RE.test(recipientEmail.trim())) {
      return 'The recipient email is not valid.'
    }
    if (message.length > 300) return 'Message must be 300 characters or fewer.'
    return null
  }

  const startPayment = async () => {
    setError(null)
    const validation = validateDetails()
    if (validation) {
      setError(validation)
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/gift-cards/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: resolvedAmount(),
          purchaserName: purchaserName.trim(),
          purchaserEmail: purchaserEmail.trim(),
          recipientName: recipientName.trim() || undefined,
          recipientEmail: recipientEmail.trim() || undefined,
          message: message.trim() || undefined,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as Partial<PurchaseResult> & { error?: string }
      if (!res.ok || !data.clientSecret || !data.giftCardId) {
        setError(data.error ?? 'Could not start the purchase. Please try again.')
        return
      }

      const stripeInstance = await loadStripe(publishableKey)
      if (!stripeInstance) {
        setError('Payment system unavailable right now. Please try again shortly.')
        return
      }

      const elements = stripeInstance.elements({
        clientSecret: data.clientSecret,
        appearance: { theme: 'stripe', variables: { colorPrimary: '#1a1a1a' } },
      })
      const paymentElement = elements.create('payment')
      paymentElement.mount('#gift-card-payment-element')

      elementsRef.current = elements
      setStripe(stripeInstance)
      setResult({ giftCardId: data.giftCardId, code: data.code ?? '', amount: data.amount ?? resolvedAmount()! })
      setPhase('pay')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const confirmPayment = async () => {
    if (!stripe || !elementsRef.current) return
    setConfirming(true)
    setError(null)
    try {
      const { error: payError } = await stripe.confirmPayment({
        elements: elementsRef.current,
        redirect: 'if_required',
      })
      if (payError) {
        setError(payError.message ?? 'Payment failed. Please try again.')
        return
      }
      setPhase('done')
      void pollStatus()
    } catch {
      setError('Payment failed. Please try again.')
    } finally {
      setConfirming(false)
    }
  }

  const pollStatus = async () => {
    if (!result) return
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((r) => setTimeout(r, 2500))
      try {
        const res = await fetch(`/api/gift-cards/status?id=${encodeURIComponent(result.giftCardId)}`)
        if (res.ok) {
          const data = (await res.json()) as { status: string }
          setCardStatus(data.status)
          if (data.status === 'ACTIVE') return
        }
      } catch {
        // keep polling
      }
    }
  }

  const backToDetails = () => {
    setPhase('details')
    setResult(null)
    setStripe(null)
    elementsRef.current = null
  }

  // ─── Success screen ─────────────────────────────────────────────────────
  if (phase === 'done' && result) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden />
        <h2 className="mt-4 display-heading text-2xl font-semibold">Payment Complete</h2>
        <p className="mt-2 text-muted-foreground">
          Your ${result.amount.toFixed(2)} gift card for {shopName} is confirmed
          {recipientEmail.trim() ? ` and on its way to ${recipientEmail.trim()}` : ''}.
        </p>
        <div className="mt-6 rounded-lg bg-muted p-6">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Your gift card code</p>
          <p className="mt-2 text-2xl font-semibold tracking-widest break-all">{result.code}</p>
        </div>
        {cardStatus === 'ACTIVE' ? (
          <p className="mt-4 text-sm text-emerald-600 flex items-center justify-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Card activated — ready to use at checkout
          </p>
        ) : cardStatus ? (
          <p className="mt-4 text-sm text-muted-foreground flex items-center justify-center gap-1.5">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Card status: {cardStatus.toLowerCase()} —
            activation usually completes within a minute
          </p>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground flex items-center justify-center gap-1.5">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Activating your card…
          </p>
        )}
        <p className="mt-6 text-xs text-muted-foreground">
          We&apos;ve also emailed this code to you. Keep it safe — it works like cash at the shop.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card p-6 sm:p-8">
      {error && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {phase === 'details' ? (
        <div className="space-y-6">
          {/* Amount */}
          <div>
            <Label className="text-sm font-medium">Choose an amount</Label>
            <div className="mt-3 flex flex-wrap gap-2">
              {denominations.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setAmount(d)
                    setCustomAmount('')
                  }}
                  aria-pressed={amount === d}
                  className={`rounded-lg border px-5 py-2.5 text-sm font-semibold transition ${
                    amount === d
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-background hover:bg-accent'
                  }`}
                >
                  ${d}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <Label htmlFor="custom-amount" className="sr-only">
                Custom amount
              </Label>
              <Input
                id="custom-amount"
                type="number"
                min={MIN_AMOUNT}
                max={MAX_AMOUNT}
                step="0.01"
                inputMode="decimal"
                placeholder={`Or enter a custom amount ($${MIN_AMOUNT}–$${MAX_AMOUNT})`}
                value={customAmount}
                onChange={(e) => {
                  setCustomAmount(e.target.value)
                  setAmount(null)
                }}
                className="max-w-xs"
              />
            </div>
          </div>

          {/* Purchaser */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="purchaser-name">Your name *</Label>
              <Input
                id="purchaser-name"
                value={purchaserName}
                onChange={(e) => setPurchaserName(e.target.value)}
                autoComplete="name"
                required
              />
            </div>
            <div>
              <Label htmlFor="purchaser-email">Your email *</Label>
              <Input
                id="purchaser-email"
                type="email"
                value={purchaserEmail}
                onChange={(e) => setPurchaserEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
          </div>

          {/* Recipient (optional) */}
          <div>
            <p className="text-sm font-medium">Send to someone else? (optional)</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="recipient-name">Recipient name</Label>
                <Input id="recipient-name" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="recipient-email">Recipient email</Label>
                <Input
                  id="recipient-email"
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4">
              <Label htmlFor="gift-message">Personal message (optional)</Label>
              <Textarea
                id="gift-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder="Happy birthday! Enjoy a fresh cut on me."
              />
            </div>
          </div>

          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={startPayment}
            disabled={loading || !resolvedAmount()}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Gift className="mr-2 h-4 w-4" aria-hidden />}
            {resolvedAmount() ? `Continue — pay $${resolvedAmount()!.toFixed(2)}` : 'Continue to payment'}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Secure payment is processed by Stripe. The card code appears after payment.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg bg-muted p-4 text-sm">
            <p className="font-semibold">{purchaserName.trim()}</p>
            <p className="text-muted-foreground">
              ${resolvedAmount()?.toFixed(2)} gift card
              {recipientEmail.trim() ? ` for ${recipientName.trim() || recipientEmail.trim()}` : ''}
            </p>
          </div>
          <div>
            <Label className="mb-3 block text-sm font-medium">Payment details</Label>
            <div id="gift-card-payment-element" />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              size="lg"
              className="flex-1"
              onClick={confirmPayment}
              disabled={confirming}
            >
              {confirming ? (
                <>
                  <Loader className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Processing…
                </>
              ) : (
                `Pay $${resolvedAmount()?.toFixed(2)}`
              )}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={backToDetails}
              disabled={confirming}
            >
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

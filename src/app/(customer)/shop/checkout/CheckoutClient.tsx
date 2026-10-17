'use client'

/**
 * Guest checkout.
 *
 * Flow: review cart + contact details → POST /api/ecommerce/checkout?slug=
 * (server recomputes prices/stock and creates a PENDING order + optional
 * Stripe PaymentIntent) → mount Stripe Payment Element → confirmPayment →
 * poll the email-gated order-status endpoint until the webhook flips the
 * order to PAID. The cart is cleared only after a successful submission.
 *
 * The checkout POST is idempotency-keyed client-side: a double submission
 * (double click, retry) can never create two orders.
 */
import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { loadStripe, type Stripe, type StripeElements } from '@stripe/stripe-js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cartHasPhysical, cartLines, cartSubtotal, clearCart, EMPTY_CART, getCartSnapshot, subscribeCart } from '@/lib/shop/cart'
import { AlertCircle, CheckCircle2, Loader2, ShoppingBag } from 'lucide-react'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

type Phase = 'details' | 'pay' | 'done'

interface CheckoutResponse {
  orderId?: string
  orderNumber?: string
  status?: string
  total?: number
  clientSecret?: string | null
  onlinePaymentEnabled?: boolean
  error?: string
}

function formatPrice(n: number) {
  return `$${n.toFixed(2)}`
}

export function CheckoutClient({
  slug,
  shopName,
  enabled,
  publishableKey,
}: {
  slug: string
  shopName: string
  enabled: boolean
  publishableKey: string
}) {
  const [phase, setPhase] = useState<Phase>('details')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [line1, setLine1] = useState('')
  const [line2, setLine2] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [order, setOrder] = useState<{ orderNumber: string; orderId: string; total: number; paid: boolean } | null>(null)
  const [stripe, setStripe] = useState<Stripe | null>(null)
  const elementsRef = useRef<StripeElements | null>(null)
  const idempotencyRef = useRef<string | null>(null)

  const items = useSyncExternalStore(
    useCallback((cb) => subscribeCart(slug, cb), [slug]),
    () => getCartSnapshot(slug),
    () => EMPTY_CART
  )
  const ready = true

  if (!enabled) {
    return (
      <div className="text-center">
        <h1 className="display-heading text-display-3">Checkout</h1>
        <p className="mt-2 text-muted-foreground">The online shop is not available right now.</p>
      </div>
    )
  }

  if (!ready) return null

  if (items.length === 0) {
    return (
      <div className="text-center">
        <ShoppingBag className="mx-auto h-12 w-12 text-muted-foreground/50" aria-hidden />
        <h1 className="mt-4 display-heading text-display-3">Nothing to check out</h1>
        <Button asChild className="mt-6">
          <Link href="/shop">Back to the shop</Link>
        </Button>
      </div>
    )
  }

  const needsAddress = cartHasPhysical(slug)

  const validate = (): string | null => {
    if (!email.trim() || !EMAIL_RE.test(email.trim())) return 'Please enter a valid email address.'
    if (needsAddress) {
      if (!line1.trim()) return 'Street address is required for physical products.'
      if (!city.trim()) return 'City is required for physical products.'
      if (!state.trim()) return 'State is required for physical products.'
      if (!postalCode.trim()) return 'Postal code is required for physical products.'
    }
    return null
  }

  const submitOrder = async () => {
    setError(null)
    const validation = validate()
    if (validation) {
      setError(validation)
      return
    }
    setLoading(true)
    try {
      // One idempotency key per cart session: double submits collapse to
      // one order server-side.
      if (!idempotencyRef.current) {
        idempotencyRef.current =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
      const res = await fetch(`/api/ecommerce/checkout?slug=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: cartLines(slug),
          email: email.trim(),
          name: name.trim() || undefined,
          address: needsAddress
            ? { line1: line1.trim(), line2: line2.trim() || undefined, city: city.trim(), state: state.trim(), postalCode: postalCode.trim(), country: 'US' }
            : null,
          idempotencyKey: idempotencyRef.current,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as CheckoutResponse
      if (!res.ok || !data.orderId) {
        setError(data.error ?? 'Could not place the order. Please try again.')
        return
      }

      setOrder({
        orderNumber: data.orderNumber ?? '',
        orderId: data.orderId,
        total: data.total ?? cartSubtotal(slug),
        paid: false,
      })

      if (data.onlinePaymentEnabled && data.clientSecret) {
        const stripeInstance = publishableKey ? await loadStripe(publishableKey) : null
        if (!stripeInstance) {
          setError('Payment system unavailable right now. Your order is saved — the shop will contact you.')
          setPhase('done')
          return
        }
        const elements = stripeInstance.elements({
          clientSecret: data.clientSecret,
          appearance: { theme: 'stripe', variables: { colorPrimary: '#1a1a1a' } },
        })
        const paymentElement = elements.create('payment')
        paymentElement.mount('#shop-payment-element')
        elementsRef.current = elements
        setStripe(stripeInstance)
        setPhase('pay')
      } else {
        // No online payment configured: the order stands and the shop
        // settles it in store. Clear the cart and confirm to the customer.
        clearCart(slug)
        setPhase('done')
      }
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
      clearCart(slug)
      setPhase('done')
      void pollPaid()
    } catch {
      setError('Payment failed. Please try again.')
    } finally {
      setConfirming(false)
    }
  }

  /** Poll the email-gated status endpoint until the webhook flips PAID. */
  const pollPaid = async () => {
    if (!order) return
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((r) => setTimeout(r, 2500))
      try {
        const res = await fetch(
          `/api/ecommerce/order-status?slug=${encodeURIComponent(slug)}&orderId=${encodeURIComponent(order.orderId)}&email=${encodeURIComponent(email.trim())}`
        )
        if (res.ok) {
          const data = (await res.json()) as { status?: string }
          if (data.status === 'PAID' || data.status === 'PROCESSING') {
            setOrder((o) => (o ? { ...o, paid: true } : o))
            return
          }
        }
      } catch {
        // keep polling
      }
    }
  }

  // ─── Success screen ─────────────────────────────────────────────────────
  if (phase === 'done' && order) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden />
        <h1 className="mt-4 display-heading text-2xl font-semibold">Order {order.orderNumber} confirmed</h1>
        <p className="mt-2 text-muted-foreground">
          Thank you! Your order at {shopName} is {order.paid ? 'paid and confirmed' : 'received'}.
          A confirmation goes to <strong>{email.trim()}</strong> once payment settles.
        </p>
        <div className="mt-6 rounded-lg bg-muted p-6">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Order total</p>
          <p className="mt-1 text-2xl font-semibold">{formatPrice(order.total)}</p>
        </div>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/shop">Back to the shop</Link>
        </Button>
      </div>
    )
  }

  // ─── Payment phase ──────────────────────────────────────────────────────
  if (phase === 'pay') {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="display-heading text-display-3 mb-2">Payment</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Order {order?.orderNumber} — total <strong>{formatPrice(order?.total ?? 0)}</strong>
        </p>
        <Card>
          <CardContent className="p-6 space-y-4">
            <div id="shop-payment-element" />
            {error && (
              <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden /> {error}
              </p>
            )}
            <Button className="w-full" onClick={confirmPayment} disabled={confirming}>
              {confirming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Confirming…
                </>
              ) : (
                `Pay ${formatPrice(order?.total ?? 0)}`
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ─── Details phase ──────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="display-heading text-display-3 mb-8">Checkout</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Your order</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((i) => (
                <div key={i.productId} className="flex items-center justify-between text-sm">
                  <span>
                    {i.name} <span className="text-muted-foreground">× {i.quantity}</span>
                  </span>
                  <span className="font-medium">{formatPrice(i.price * i.quantity)}</span>
                </div>
              ))}
              <div className="border-t pt-3 flex items-center justify-between">
                <span className="text-muted-foreground">Subtotal (tax/shipping calculated at payment)</span>
                <span className="font-semibold">{formatPrice(cartSubtotal(slug))}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="checkout-name">Name (optional)</Label>
              <Input id="checkout-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={200} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="checkout-email">Email</Label>
              <Input
                id="checkout-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
              <p className="text-xs text-muted-foreground">Order confirmation and receipts go here.</p>
            </div>

            {needsAddress && (
              <div className="space-y-3 border-t pt-3">
                <p className="text-sm font-medium">Shipping address</p>
                <Input value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="Street address" autoComplete="address-line1" aria-label="Street address" />
                <Input value={line2} onChange={(e) => setLine2(e.target.value)} placeholder="Apartment, suite, etc. (optional)" autoComplete="address-line2" aria-label="Address line 2" />
                <div className="grid grid-cols-2 gap-3">
                  <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" autoComplete="address-level2" aria-label="City" />
                  <Input value={state} onChange={(e) => setState(e.target.value)} placeholder="State" autoComplete="address-level1" aria-label="State" />
                </div>
                <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="ZIP code" autoComplete="postal-code" aria-label="Postal code" />
              </div>
            )}

            {error && (
              <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden /> {error}
              </p>
            )}
            <Button className="w-full" onClick={submitOrder} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Placing order…
                </>
              ) : (
                publishableKey ? 'Continue to payment' : 'Place order'
              )}
            </Button>
            {!publishableKey && (
              <p className="text-xs text-muted-foreground">
                Online payment isn&apos;t configured — your order is placed and the shop will settle it with you in store.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

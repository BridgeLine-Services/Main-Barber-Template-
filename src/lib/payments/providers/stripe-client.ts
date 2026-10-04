/**
 * Stripe REST client — minimal fetch wrapper, server-side only.
 *
 * The secret key NEVER leaves this module's callers (all of them are
 * server code). No SDK dependency: form-encoded bodies, JSON responses,
 * Bearer auth, and a required Idempotency-Key header for every write.
 */
const STRIPE_API = 'https://api.stripe.com/v1'

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

export async function stripeApi(
  path: string,
  opts: {
    method: 'GET' | 'POST' | 'DELETE'
    body?: Record<string, string>
    idempotencyKey?: string
  },
): Promise<Record<string, unknown>> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey

  const res = await fetch(`${STRIPE_API}${path}`, {
    method: opts.method,
    headers,
    body: opts.body ? new URLSearchParams(opts.body).toString() : undefined,
    cache: 'no-store',
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    const err = json?.error as { message?: string } | undefined
    throw new Error(`Stripe API error (${res.status}): ${err?.message ?? 'unknown error'}`)
  }
  return json
}

/**
 * Verify a Stripe webhook signature per Stripe's documented scheme:
 * HMAC-SHA256 over `${timestamp}.${rawBody}` compared (timing-safe)
 * against the `v1=` signature header. STRIPE_WEBHOOK_SECRET is server-env
 * only. Returns the parsed event on success, null on mismatch.
 */
import { createHmac, timingSafeEqual } from 'crypto'

export function verifyStripeSignature(
  rawBody: string,
  sigHeader: string | null,
  secret = process.env.STRIPE_WEBHOOK_SECRET,
): Record<string, unknown> | null {
  if (!sigHeader || !secret) return null
  const parts = sigHeader.split(',').reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split('=')
    if (k && v) acc[k.trim()] = v.trim()
    return acc
  }, {})
  const timestamp = parts.t
  const signature = parts.v1
  if (!timestamp || !signature) return null
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    return JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return null
  }
}

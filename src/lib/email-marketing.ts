import { createHmac, timingSafeEqual } from 'node:crypto'
import { getAbsoluteUrl } from '@/lib/app-url'

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 180

type UnsubscribePayload = { businessId: string; customerId: string; exp: number }

function secret() {
  return process.env.NEXTAUTH_SECRET || process.env.CRON_SECRET || 'development-only-unsubscribe-secret'
}

function sign(value: string) {
  return createHmac('sha256', secret()).update(value).digest('base64url')
}

export function createUnsubscribeUrl(businessId: string, customerId: string, now = Date.now()) {
  const payload: UnsubscribePayload = { businessId, customerId, exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return getAbsoluteUrl(`/unsubscribe?token=${encoded}.${sign(encoded)}`)
}

export function verifyUnsubscribeToken(token: string, now = Date.now()): UnsubscribePayload | null {
  const [encoded, signature] = token.split('.')
  if (!encoded || !signature) return null
  const expected = sign(encoded)
  const provided = Buffer.from(signature)
  const actual = Buffer.from(expected)
  if (provided.length !== actual.length || !timingSafeEqual(provided, actual)) return null
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as UnsubscribePayload
    if (!payload.businessId || !payload.customerId || !Number.isInteger(payload.exp) || payload.exp < Math.floor(now / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function campaignPostalAddress(business: { address: string | null; city: string | null; state: string | null; zipCode: string | null }) {
  const address = [business.address, business.city, business.state, business.zipCode].filter((value): value is string => Boolean(value?.trim())).join(', ')
  return address || null
}

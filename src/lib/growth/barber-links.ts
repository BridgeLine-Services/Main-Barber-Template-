import { createHmac, timingSafeEqual } from 'node:crypto'

/** A barber's own booking link plus the referral token that rides on it. */
export function buildBarberLink(input: { appUrl: string; barberSlug: string }): string | null {
  const base = input.appUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\/[^\s]+$/i.test(base)) return null
  const slug = input.barberSlug.trim()
  if (!/^[a-z0-9-]{1,64}$/i.test(slug)) return null
  return `${base}/barbers/${slug}`
}

function secret(): string {
  // Reuses the declared session secret on purpose: a second secret would be one more
  // value the owner has to set, and the env registry already governs this one.
  return process.env.NEXTAUTH_SECRET?.trim() || ''
}

/** Signed attribution: tenant and barber are inside the token, so it cannot be edited. */
export function signReferral(payload: { businessId: string; barberId: string }, now = Date.now()): string | null {
  const key = secret()
  if (!key || !payload.businessId || !payload.barberId) return null
  const body = `${payload.businessId}.${payload.barberId}.${now}`
  const sig = createHmac('sha256', key).update(body).digest('base64url')
  return Buffer.from(`${body}.${sig}`).toString('base64url')
}

export function verifyReferral(token: string, ttlMs = 30 * 24 * 3600_000, now = Date.now()):
  | { businessId: string; barberId: string }
  | null {
  const key = secret()
  if (!key || !token) return null
  let raw: string
  try { raw = Buffer.from(token, 'base64url').toString('utf8') } catch { return null }
  const parts = raw.split('.')
  if (parts.length !== 4) return null
  const [businessId, barberId, issued, sig] = parts
  const expected = createHmac('sha256', key).update(`${businessId}.${barberId}.${issued}`).digest('base64url')
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const at = Number(issued)
  if (!Number.isFinite(at) || now - at > ttlMs) return null
  return { businessId, barberId }
}

/** A barber sharing their own link to themselves is not a referral. */
export function isSelfReferral(referrerCustomerId: string | null, visitorCustomerId: string | null): boolean {
  return Boolean(referrerCustomerId && visitorCustomerId && referrerCustomerId === visitorCustomerId)
}

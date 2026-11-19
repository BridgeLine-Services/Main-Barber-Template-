import { buildBarberLink, signReferral } from '../growth/barber-links'

export interface ShareLink { url: string; note: string }

export function buildShareLink(input: { appUrl: string | undefined; barberSlug: string | null; businessId: string; barberId: string; now?: number }): ShareLink | null {
  if (!input.barberSlug) return null
  const base = buildBarberLink({ appUrl: input.appUrl ?? '', barberSlug: input.barberSlug })
  if (!base) return null
  const token = signReferral({ businessId: input.businessId, barberId: input.barberId }, input.now)
  if (!token) return null
  return { url: base + '?ref=' + encodeURIComponent(token), note: 'Send this to a client. Bookings that arrive through it are credited to you.' }
}

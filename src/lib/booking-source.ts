// ============================================================================
// Prompt 8 — Canonical booking-source attribution
//
// ONE allowlist for every external booking entry point. External surfaces
// (Google Business Profile, Instagram, Facebook) do NOT get a second
// booking engine: they get validated, shop-specific links into the
// application's canonical public booking page, tagged with a source.
//
// The source is validated against the allowlist server-side at appointment
// creation and persisted on the Appointment row. Historical rows have no
// value and are reported as UNKNOWN — never backfilled.
// ============================================================================

import { BookingSource } from '@prisma/client'

export const BOOKING_SOURCE_VALUES: readonly BookingSource[] = [
  'WEBSITE',
  'GOOGLE',
  'INSTAGRAM',
  'FACEBOOK',
  'DIRECT',
  'REFERRAL',
  'UNKNOWN',
] as const

/** Values an EXTERNAL link may set. WEBSITE is the default for the public
 * flow; DIRECT/REFERRAL are staff-side values — external links cannot claim
 * them, so they are excluded from the public allowlist. */
export const PUBLIC_BOOKING_SOURCES: readonly BookingSource[] = [
  'WEBSITE',
  'GOOGLE',
  'INSTAGRAM',
  'FACEBOOK',
] as const

/** Lower-case wire forms accepted on the booking URL, e.g. ?source=google */
const SOURCE_ALIASES: Record<string, BookingSource> = {
  website: 'WEBSITE',
  web: 'WEBSITE',
  google: 'GOOGLE',
  gbp: 'GOOGLE',
  instagram: 'INSTAGRAM',
  ig: 'INSTAGRAM',
  facebook: 'FACEBOOK',
  fb: 'FACEBOOK',
  direct: 'DIRECT',
  referral: 'REFERRAL',
}

/** Normalize untrusted source input to the canonical enum.
 * Anything unknown, malformed, or not in the optional allowlist degrades to
 * UNKNOWN — invalid values are never stored and never throw. */
export function normalizeBookingSource(
  raw: unknown,
  allowlist?: readonly BookingSource[]
): BookingSource {
  if (typeof raw !== 'string') return 'UNKNOWN'
  const canonical = SOURCE_ALIASES[raw.trim().toLowerCase()]
  if (!canonical) return 'UNKNOWN'
  if (allowlist && !allowlist.includes(canonical)) return 'UNKNOWN'
  return canonical
}

/** Campaign tokens: short, conservative charset, bounded length. Prevents
 * attribution injection / XSS vectors through query parameters. */
export function isValidCampaignToken(raw: unknown): raw is string {
  return (
    typeof raw === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(raw)
  )
}

/** Normalize an untrusted campaign value — invalid tokens degrade to null. */
export function normalizeCampaign(raw: unknown): string | null {
  return isValidCampaignToken(raw) ? raw : null
}

// ─── Canonical booking URL builder ───────────────────────────────────────────
//
// External entry points point at the SAME public booking route. Only the
// source/campaign query params differ. The shop is selected by the app's
// normal tenant resolution (slug/domain) — never by a query param.

export interface BookingLinkParams {
  /** Public base URL of THIS application (e.g. https://shop.example.com). */
  appUrl: string
  source: BookingSource
  campaign?: string | null
}

/** Build the canonical booking link for an external surface.
 * Falls back to a clean appUrl when the base URL is unusable. */
export function buildBookingLink({ appUrl, source, campaign }: BookingLinkParams): string {
  const safeBase = isSafeAppUrl(appUrl) ? appUrl.replace(/\/+$/, '') : ''
  const src = BOOKING_SOURCE_VALUES.includes(source) && source !== 'UNKNOWN' ? source : 'WEBSITE'
  const params = new URLSearchParams({ source: src.toLowerCase() })
  const token = normalizeCampaign(campaign)
  if (token) params.set('campaign', token)
  return `${safeBase}/book?${params.toString()}`
}

/** A base app URL must be an http(s) URL with a hostname and no credentials
 * or embedded path — it is used verbatim in owner-facing links. */
export function isSafeAppUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    if (!u.hostname || u.username || u.password) return false
    if (u.pathname && u.pathname !== '/') return false
    return true
  } catch {
    return false
  }
}

// ─── External-surface capability matrix (authoritative, code-level) ────────
//
// Integration MODES — do not conflate them:
//   NATIVE      — provider API creates/reads appointments directly
//   LINK        — validated tracked link into the canonical booking engine
//   NOT_SUPPORTED — no legitimate path exists without provider approval
//
// Google Business Profile: the repo's GBP OAuth integration syncs business
// info and REVIEWS (src/lib/google-business.ts). Google's "Book" button is a
// provider-managed surface that requires an approved booking partner
// (reserve/booking provider) — NOT available to a template via public APIs.
// Mode: LINK (with the existing GBP review integration clearly labeled as
// NOT a booking integration).
//
// Instagram/Facebook: Meta's booking actions are partner/3P-integration
// surfaces requiring App Review + Business verification. No public API lets a
// template create appointments from DMs/profiles. Mode: LINK.
export type IntegrationMode = 'NATIVE' | 'LINK' | 'NOT_SUPPORTED'

export interface PlatformCapability {
  platform: 'google' | 'instagram' | 'facebook'
  mode: IntegrationMode
  label: string
  source: BookingSource
  /** Plain-English explanation shown verbatim in owner docs/UI. */
  explanation: string
  /** Remaining external setup the OWNER must do (platform-side). */
  ownerSetupSteps: string[]
}

export const BOOKING_PLATFORM_CAPABILITIES: PlatformCapability[] = [
  {
    platform: 'google',
    mode: 'LINK',
    label: 'Google Business Profile — external tracked booking link',
    source: 'GOOGLE',
    explanation:
      'Google requires an approved booking partner for its native "Book" button; a website template cannot register appointments into Google directly. This integration is a validated, tracked booking link that opens your own booking page. The existing Google Business Profile connection (used for business info and review sync) is a separate integration and is NOT a booking integration.',
    ownerSetupSteps: [
      'Copy the Google booking link below.',
      'In your Google Business Profile dashboard, add it as your appointment link / booking URL where Google offers an external booking URL field.',
      'Bookings made through that link are attributed to source "google" automatically.',
    ],
  },
  {
    platform: 'instagram',
    mode: 'LINK',
    label: 'Instagram — external tracked booking link',
    source: 'INSTAGRAM',
    explanation:
      "Meta's in-app booking actions require an approved business integration with App Review. This integration is a validated, tracked booking link suitable for your profile bio, link-in-bio tools, or story links. It is NOT a native Instagram booking integration.",
    ownerSetupSteps: [
      'Copy the Instagram booking link below.',
      'Add it to your Instagram profile (bio or action button where available).',
      'Bookings made through that link are attributed to source "instagram" automatically.',
    ],
  },
  {
    platform: 'facebook',
    mode: 'LINK',
    label: 'Facebook — external tracked booking link',
    source: 'FACEBOOK',
    explanation:
      "Meta's Page booking button for native flows requires an approved booking partner integration. This integration is a validated, tracked booking link suitable for your Page's button or posts. It is NOT a native Facebook booking integration.",
    ownerSetupSteps: [
      'Copy the Facebook booking link below.',
      'Add it to your Facebook Page (booking button or a post link).',
      'Bookings made through that link are attributed to source "facebook" automatically.',
    ],
  },
]

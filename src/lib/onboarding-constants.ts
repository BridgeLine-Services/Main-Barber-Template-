// ============================================================================
// ONBOARDING CONSTANTS — shared by the onboarding wizard (client) and the
// onboarding API (server). Single source of truth for slug rules, timezone
// options, and wizard step definitions.
//
// Nothing in this file contains customer-specific information — it is all
// reusable template logic. Customer data lives only in the database.
// ============================================================================

/** Wizard steps, in order. Persisted in Business.onboardingStep. */
export const ONBOARDING_STEP_LABELS: Record<string, string> = {
  business: 'Business Basics',
  branding: 'Branding',
  services: 'Services',
  team: 'Team',
  booking: 'Booking Settings',
  review: 'Review',
  done: 'Done',
}

/** Steps shown in the wizard progress indicator (implemented order). */
export const WIZARD_STEPS = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'business', label: 'Basics' },
  { key: 'branding', label: 'Branding' },
  { key: 'services', label: 'Services' },
  { key: 'team', label: 'Team' },
  { key: 'booking', label: 'Booking' },
  { key: 'review', label: 'Review' },
] as const

export type WizardStepKey = (typeof WIZARD_STEPS)[number]['key']

// ─── Slug rules ────────────────────────────────────────────────────────────

/**
 * Convert a business name to a URL slug:
 * lowercase, spaces → hyphens, disallowed characters stripped.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')                // split letters from diacritics
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks (é → e)
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')            // apostrophes removed, not hyphenated
    .replace(/[^a-z0-9]+/g, '-')     // everything else → hyphen
    .replace(/-+/g, '-')             // collapse runs
    .replace(/^-|-$/g, '')           // trim edges
    .slice(0, 80)
}

/**
 * Validate a slug. Returns an error message or null when valid.
 * Rules: lowercase letters/numbers/hyphens, no leading/trailing/double
 * hyphens, 2–80 chars.
 */
export function validateSlug(slug: string): string | null {
  if (!slug) return 'Slug is required'
  if (slug.length < 2) return 'Slug must be at least 2 characters'
  if (slug.length > 80) return 'Slug must be 80 characters or fewer'
  if (!/^[a-z0-9-]+$/.test(slug)) return 'Slug can only contain lowercase letters, numbers, and hyphens'
  if (slug.startsWith('-') || slug.endsWith('-')) return 'Slug cannot start or end with a hyphen'
  if (slug.includes('--')) return 'Slug cannot contain consecutive hyphens'
  return null
}

// ─── Timezones ─────────────────────────────────────────────────────────────

export interface TimezoneOption {
  value: string   // IANA identifier, e.g. "America/Los_Angeles"
  label: string   // display label with current UTC offset
}

/**
 * Returns the full IANA timezone list with current UTC offsets, generated at
 * runtime from the runtime's own locale database — NOT hardcoded, so the list
 * stays correct and complete for every region the template ships to.
 */
export function getTimezoneOptions(): TimezoneOption[] {
  const zones = safeSupportedTimezones()

  return zones
    .map((tz) => ({ value: tz, label: formatTimezoneLabel(tz) }))
    .sort((a, b) => a.value.localeCompare(b.value))
}

/** Display label: "America/Los_Angeles (UTC-07:00)" */
export function formatTimezoneLabel(tz: string): string {
  let offset = ''
  try {
    const offsetMinutes = -new Date().getTimezoneOffset()
    // Compute the zone's own offset (not the browser's) via Intl
    const dtf = Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    const part = dtf.formatToParts(new Date()).find((p) => p.type === 'timeZoneName')
    offset = part?.value || ''
  } catch {
    offset = ''
  }
  return offset ? `${tz} (${offset.replace('GMT', 'UTC')})` : tz
}

/**
 * Detect the user's timezone (browser preference). Falls back to null so the
 * form can show a neutral placeholder instead of a hardcoded zone.
 */
export function detectTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!tz) return null
    // Accept the browser's zone if it's in the runtime list; 'UTC' and
    // 'Etc/*' zones are always valid even when absent from the list.
    return safeSupportedTimezones().includes(tz) || tz === 'UTC' || tz.startsWith('Etc/')
      ? tz
      : null
  } catch {
    return null
  }
}

/** Runtime IANA list; small curated fallback only if the runtime lacks the API. */
function safeSupportedTimezones(): string[] {
  try {
    const anyIntl = Intl as any
    if (typeof anyIntl.supportedValuesOf === 'function') {
      const zones = anyIntl.supportedValuesOf('timeZone') as string[]
      if (Array.isArray(zones) && zones.length > 0) return zones
    }
  } catch {
    // fall through to fallback
  }
  return [
    'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Nairobi',
    'America/Anchorage', 'America/Bogota', 'America/Chicago', 'America/Denver',
    'America/Halifax', 'America/Lima', 'America/Los_Angeles', 'America/Mexico_City',
    'America/New_York', 'America/Phoenix', 'America/Sao_Paulo', 'America/Toronto',
    'America/Vancouver', 'Asia/Bangkok', 'Asia/Dubai', 'Asia/Hong_Kong',
    'Asia/Jakarta', 'Asia/Kolkata', 'Asia/Manila', 'Asia/Seoul',
    'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Melbourne',
    'Australia/Perth', 'Australia/Sydney', 'Europe/Amsterdam', 'Europe/Athens',
    'Europe/Berlin', 'Europe/Dublin', 'Europe/Helsinki', 'Europe/Istanbul',
    'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'Europe/Moscow',
    'Europe/Paris', 'Europe/Rome', 'Europe/Stockholm', 'Europe/Warsaw',
    'Pacific/Auckland', 'Pacific/Honolulu', 'UTC',
  ]
}

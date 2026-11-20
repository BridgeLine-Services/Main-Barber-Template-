/**
 * URL checks that parse instead of guessing.
 *
 * Substring checks ("does this string contain example.com?") are wrong in both
 * directions: `https://evil.test/?next=https://example.com` contains the trusted
 * name, and `https://example.com.evil.test` contains it too. Everything here
 * parses the value and compares the parts that actually decide where a browser
 * goes: the protocol and the hostname.
 *
 * Only `https:` is accepted. `http:` is refused for destinations we hand to a
 * browser or a redirect, because a shop that accepts `http:` links is one
 * downgrade away from leaking a session.
 */

export interface ParsedUrl {
  url: URL
  host: string
  /** Host with a leading "www." removed, lowercased, for friendly comparison. */
  bareHost: string
}

/** Parse a value as an absolute https URL, or return null. Never throws. */
export function parseHttpsUrl(value: string | null | undefined): ParsedUrl | null {
  if (!value || typeof value !== 'string') return null
  const trimmed = value.trim()
  // A relative path is not an external destination; refusing it here keeps the
  // caller from silently treating "/dashboard" as a host.
  if (!/^https:\/\//i.test(trimmed)) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  // A hostname is required, and credentials in the URL are never acceptable:
  // they are the classic way to make one host look like another.
  if (!url.hostname || url.username || url.password) return null
  const host = url.hostname.toLowerCase()
  return { url, host, bareHost: host.replace(/^www\./, '') }
}

/** The lowercased hostname of an https URL, or null. */
export function hostOf(value: string | null | undefined): string | null {
  return parseHttpsUrl(value)?.host ?? null
}

/**
 * True when `value` is an https URL whose host is `domain` or a subdomain of it.
 *
 * `evil-example.com` is not a subdomain of `example.com`; the dot in front of the
 * domain is what makes that true, which is why this compares label by label.
 */
export function isHostOfDomain(value: string | null | undefined, domain: string): boolean {
  const parsed = parseHttpsUrl(value)
  if (!parsed) return false
  const target = domain.toLowerCase().replace(/^www\./, '')
  const bare = parsed.bareHost
  return bare === target || bare.endsWith(`.${target}`)
}

/**
 * The lowercased hostname of any absolute URL, whatever its scheme.
 *
 * For non-browser destinations such as a Postgres connection string, where the question is
 * "which server is this pointing at" rather than "is this safe to hand to a browser". The
 * scheme must still be a real one, so `javascript:` and a bare path return null.
 */
export function hostOfAnyUrl(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null
  try {
    const url = new URL(trimmed)
    return url.hostname ? url.hostname.toLowerCase() : null
  } catch {
    return null
  }
}

/** True only for absolute https URLs with a host and no embedded credentials. */
export function isSafeExternalUrl(value: string | null | undefined): boolean {
  return parseHttpsUrl(value) !== null
}

/**
 * Strip HTML tags for text comparison.
 *
 * A single replace is not enough: `<<b>script>` becomes `<script>` after one
 * pass, so a tag can survive a naive filter. This repeats until the value stops
 * changing, with a bound so a hostile input cannot spin forever. It is for
 * comparing text in tests and static checks, not for rendering anything.
 */
export function stripHtmlTags(value: string): string {
  let current = value
  for (let pass = 0; pass < 10; pass++) {
    const next = current.replace(/<[^<>]*>/g, '')
    if (next === current) return next
    current = next
  }
  return current
}

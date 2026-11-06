/**
 * Trusted storage URLs.
 *
 * Several cleanup paths decide whether to call Vercel Blob's `del()` on a URL
 * that came out of the database. A substring test such as
 * a substring test on the hostname answers the wrong question: it is true for a
 * lookalike that merely contains the store's domain as a prefix, as a suffix,
 * or as a path segment, so a crafted record could point cleanup at a host this
 * application does not own.
 *
 * This module answers the actual question — "is this an object store URL this
 * application manages?" — by parsing and then checking every component.
 *
 * It deliberately does NOT decide ownership. Whether a URL belongs to a
 * business is decided by the database record and the authenticated business on
 * the request; callers must keep that check first and use this only to decide
 * whether storage cleanup may be attempted.
 */

/**
 * Vercel Blob serves objects from `<store-id>.public.blob.vercel-storage.com`.
 * `next.config.ts` already permits `**.public.blob.vercel-storage.com` for
 * images, which is the format this mirrors. The label is anchored at both ends
 * and cannot contain a dot, so lookalike suffixes and prefixes cannot match.
 */
const MANAGED_HOST = /^[a-z0-9][a-z0-9-]{0,62}\.public\.blob\.vercel-storage\.com$/i

/** Guards against pathological inputs before any parsing work happens. */
const MAX_URL_LENGTH = 2048

/**
 * Parse a value and return the URL only when it is a plain, secure object-store
 * URL this application could have written.
 */
export function parseTrustedStorageUrl(value: string | null | undefined): URL | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  // Objects are always served over TLS.
  if (url.protocol !== 'https:') return null
  // Credentials in the authority mean the host is not what it appears to be.
  if (url.username || url.password) return null
  // A non-default port is not something the storage provider issues.
  if (url.port) return null
  // A fragment has no meaning for an object key and suggests a hand-built URL.
  if (url.hash) return null
  if (!MANAGED_HOST.test(url.hostname)) return null

  return url
}

/** True only for URLs the application's own storage could have produced. */
export function isManagedStorageUrl(value: string | null | undefined): boolean {
  return parseTrustedStorageUrl(value) !== null
}

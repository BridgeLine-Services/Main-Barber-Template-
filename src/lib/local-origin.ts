/**
 * Local-origin request guard.
 *
 * Used by the font architecture test, which walks the built CSS and fetches the
 * font files it finds. The original check compared href strings with a prefix
 * test, which accepts `http://localhost:3000.attacker.example/...` and any
 * external host whose name merely starts with the trusted host.
 *
 * Two properties matter here:
 *   1. The destination is decided by the URL parser and an exact origin
 *      comparison, never by substring matching.
 *   2. Redirects are refused. Validating a URL and then letting fetch() follow
 *      a 302 off-origin would validate the wrong thing: the check would pass
 *      while the request went somewhere else.
 */

/** Parse `href` against `base` and require that it stays on the base origin. */
export function resolveLocalUrl(href: string, base: string): string {
  const baseUrl = new URL(base)
  let url: URL
  try {
    url = new URL(href, baseUrl)
  } catch {
    throw new Error(`refused to fetch an unparseable URL: ${href}`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`refused to fetch a non-http(s) URL: ${href}`)
  }

  // Credentials in a URL are a classic redirect/SSRF trick: the host reads as
  // trusted while the request carries different authorization.
  if (url.username || url.password) {
    throw new Error(`refused to fetch a URL containing credentials: ${href}`)
  }

  if (url.origin !== baseUrl.origin) {
    throw new Error(`refused to fetch a URL outside the base origin: ${href}`)
  }

  return url.toString()
}

/**
 * Fetch a same-origin resource, refusing any redirect.
 *
 * `redirect: 'error'` makes fetch() reject instead of following, so a redirect
 * away from the base origin cannot be silently traversed. The final response
 * URL is checked as well, because a response URL is only knowable afterwards.
 */
export async function fetchLocalUrl(href: string, base: string, init?: RequestInit): Promise<Response> {
  const target = new URL(resolveLocalUrl(href, base))
  const baseOrigin = new URL(base).origin

  const response = await fetch(target, { ...init, redirect: 'error' })

  if (response.url && new URL(response.url).origin !== baseOrigin) {
    throw new Error('refused a response whose final URL left the base origin')
  }

  return response
}

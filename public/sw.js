/* Service worker for the barber booking template.
 *
 * CACHING SAFETY RULES (do not weaken these):
 * 1. /api/* requests are ALWAYS network-only. Booking availability,
 *    queue state and every private/dashboard response must never be
 *    served from cache. A cached availability slot is a stale booking.
 * 2. Dashboard, login and auth routes are always network-only.
 * 3. Only immutable build assets and images are cache-first.
 * 4. HTML navigations are network-first; the cache is only an offline
 *    fallback shell, and responses carrying Set-Cookie are never cached.
 * 5. Cache is versioned; old versions are deleted on activation, so a
 *    new deployment invalidates the asset cache on next visit.
 */
const VERSION = 'v1'
const STATIC_CACHE = `barber-static-${VERSION}`
const PAGE_CACHE = `barber-pages-${VERSION}`
const OFFLINE_URL = '/offline'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PAGE_CACHE).then((c) => c.add(OFFLINE_URL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

const isStaticAsset = (url) =>
  url.pathname.startsWith('/_next/static/') ||
  url.pathname.startsWith('/icons/') ||
  url.pathname.startsWith('/images/') ||
  /\.(png|jpg|jpeg|gif|webp|svg|ico|woff|woff2)$/.test(url.pathname)

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Rule 1 + 2: dynamic data is always network-only.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/dashboard/') ||
    url.pathname.startsWith('/login') ||
    url.pathname.startsWith('/admin')
  ) {
    return // no respondWith: fetch goes straight to network
  }

  // Rule 3: immutable assets are cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(STATIC_CACHE).then((c) => c.put(request, copy))
            }
            return res
          })
      )
    )
    return
  }

  // Rule 4: HTML navigations are network-first with an offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && !res.headers.has('set-cookie')) {
            const copy = res.clone()
            caches.open(PAGE_CACHE).then((c) => c.put(request, copy))
          }
          return res
        })
        .catch(async () => {
          const hit = await caches.match(request)
          return hit || (await caches.match(OFFLINE_URL)) || Response.error()
        })
    )
  }
})

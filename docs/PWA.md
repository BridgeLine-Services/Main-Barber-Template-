# PWA Architecture

The template ships an installable, privacy-safe PWA foundation.

## Components

| Piece | Location | Notes |
| --- | --- | --- |
| Web app manifest | `src/app/manifest.ts` | Generated per business: name and `theme_color` come from the resolved shop's branding; generic fallback otherwise. |
| Icons | `public/icons/` | 192/512 PNG (any) + 512 maskable (full-bleed) + SVG. Template-generic barber-pole design, no client branding. |
| Service worker | `public/sw.js` | Versioned, conservative caching. |
| Offline page | `src/app/offline/page.tsx` | Static fallback; no business or customer state. |
| Registration | `src/components/pwa/PWARegister.tsx` | Production only; auto-unregisters in dev. |

## Caching rules (safety-critical)

1. **`/api/*` is always network-only.** Availability, queue and booking
   responses are never cached — a cached slot list is a stale booking.
2. **Dashboard, login and auth routes are network-only.** Private,
   session-rendered HTML is never stored in the SW cache.
3. **Static assets are cache-first.** `/_next/static`, icons, images and
   fonts are immutable build outputs.
4. **HTML navigations are network-first.** The cache is only an offline
   fallback, and any response carrying `Set-Cookie` is never cached.
5. **Cache invalidation:** caches are versioned (`barber-*-v1`); a new
   deployment that changes `sw.js` also changes the version constant,
   and activation deletes every older cache. Bump `VERSION` in
   `public/sw.js` whenever the offline behavior changes meaningfully.

## Testing checklist per deployment

- Desktop + mobile browser: install prompt appears, icon correct.
- Book an appointment with the SW active: availability is live (check
  the network tab: `/api/...` requests must not hit the SW cache).
- Kill the network: marketing pages show the offline fallback.
- After a redeploy: refresh twice; old asset caches are purged (verify
  in DevTools → Application → Cache Storage).

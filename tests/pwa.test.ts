// PWA foundation tests (requires live server on :3000).
// Verifies manifest, icons, service worker safety rules and the
// offline fallback page.

const BASE = 'http://localhost:3000'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

async function main() {
  // ── manifest ────────────────────────────────────────────────────────
  const mRes = await fetch(`${BASE}/manifest.webmanifest`)
  assert(mRes.status === 200, 'manifest is served (200)')
  const manifest = await mRes.json().catch(() => null)
  assert(!!manifest, 'manifest is valid JSON')
  assert(
    typeof manifest.name === 'string' && manifest.name.length > 0,
    `manifest has an application name ("${manifest?.name}")`
  )
  assert(manifest.display === 'standalone', 'display mode is standalone')
  assert(manifest.start_url === '/', 'start URL is the site root')
  assert(/^#[0-9a-f]{6}$/i.test(manifest.theme_color || ''), `theme color present ("${manifest.theme_color}")`)
  assert(/^#[0-9a-f]{6}$/i.test(manifest.background_color || ''), 'background color present')

  const iconSrcs: string[] = (manifest?.icons || []).map((i: { src: string }) => i.src)
  assert(
    iconSrcs.some((s: string) => s.includes('maskable')),
    'manifest includes a maskable icon'
  )
  for (const src of iconSrcs) {
    const r = await fetch(`${BASE}${src}`)
    assert(r.status === 200, `icon "${src}" is actually served (200)`)
  }

  // ── service worker ──────────────────────────────────────────────────
  const swRes = await fetch(`${BASE}/sw.js`)
  assert(swRes.status === 200, 'service worker is served at /sw.js')
  const sw = await swRes.text()

  assert(
    sw.includes("url.pathname.startsWith('/api/')"),
    'SW explicitly excludes /api/* from caching'
  )
  assert(
    sw.includes("url.pathname.startsWith('/dashboard/')"),
    'SW explicitly excludes /dashboard/* from caching'
  )
  assert(
    !/caches\.(put|add)\([^)]*api/.test(sw),
    'SW never puts an /api URL into a cache'
  )
  assert(
    sw.includes('set-cookie'),
    'SW refuses to cache responses that carry Set-Cookie'
  )
  assert(
    sw.includes('request.method !== \'GET\''),
    'SW ignores non-GET requests (mutations always hit the network)'
  )
  assert(
    /barber-(static|pages)-\$\{?VERSION/.test(sw),
    'SW caches are versioned'
  )
  assert(
    sw.includes('caches.keys()'),
    'SW deletes old cache versions on activation'
  )

  // ── offline fallback page ───────────────────────────────────────────
  const offRes = await fetch(`${BASE}/offline`)
  assert(offRes.status === 200, 'offline fallback page is served (200)')

  // ── registration is production-only ─────────────────────────────────
  const reg = (await import('fs')).readFileSync('src/components/pwa/PWARegister.tsx', 'utf8')
  assert(
    reg.includes("process.env.NODE_ENV === 'production'"),
    'SW registration is gated to production builds'
  )

  console.log(`\nPWA tests: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })

export {}

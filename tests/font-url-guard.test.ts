// Regression tests for the font test's local-origin request guard.
//
// The guard exists so the font architecture test can only ever fetch the app it
// built. These cases pin the properties that matter: parser-based resolution,
// exact origin equality, and no redirect following. A stub server on the guard's
// own origin makes the redirect case reproducible without needing the real app.

import http from 'http'
import { AddressInfo } from 'net'
import { resolveLocalUrl, fetchLocalUrl } from '../src/lib/local-origin'
import { FONT_FAMILY_VALUES, generateThemeCSS } from '../src/lib/theme'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

async function rejects(fn: () => Promise<unknown> | unknown, label: string) {
  try {
    await fn()
    assert(false, `${label} is refused`)
  } catch {
    assert(true, `${label} is refused`)
  }
}

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url === '/ok.css') {
      res.writeHead(200, { 'content-type': 'text/css' })
      res.end('@font-face{font-family:x;src:url(/font.woff2) format("woff2")}')
      return
    }
    if (req.url === '/font.woff2') {
      res.writeHead(200, { 'content-type': 'font/woff2' })
      res.end(Buffer.from('wOF2'))
      return
    }
    // Redirect that leaves the origin entirely.
    if (req.url === '/redirect-external') {
      res.writeHead(302, { location: 'http://attacker.example/evil.css' })
      res.end()
      return
    }
    // Redirect that stays inside the origin. Still refused: the guard's
    // contract is "no redirects", so a same-origin hop is not silently allowed.
    if (req.url === '/redirect-internal') {
      res.writeHead(302, { location: '/ok.css' })
      res.end()
      return
    }
    res.writeHead(404)
    res.end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const BASE = `http://localhost:${port}`

  try {
    // 1. Valid local relative URL
    assert(resolveLocalUrl('ok.css', BASE) === `${BASE}/ok.css`,
      'relative path resolves onto the local origin')

    // 2. Valid local absolute URL
    assert(resolveLocalUrl(`${BASE}/ok.css`, BASE) === `${BASE}/ok.css`,
      'absolute local URL is accepted')

    // 3. External hostname
    await rejects(() => resolveLocalUrl('http://attacker.example/ok.css', BASE), 'external host')

    // 4. Lookalike hostname that the old prefix check would have accepted
    await rejects(() => resolveLocalUrl(`http://localhost:${port}.attacker.example/ok.css`, BASE),
      'lookalike host that starts with the trusted host')

    // 5. Protocol-relative external URL
    await rejects(() => resolveLocalUrl('//attacker.example/ok.css', BASE), 'protocol-relative external URL')

    // 6. URL carrying credentials
    await rejects(() => resolveLocalUrl(`http://user:pass@localhost:${port}/ok.css`, BASE),
      'URL containing credentials')

    // 6b. Non-http scheme
    await rejects(() => resolveLocalUrl('file:///etc/passwd', BASE), 'file:// URL')

    // 7. Redirect leaving the origin
    await rejects(() => fetchLocalUrl('/redirect-external', BASE), 'redirect to an external origin')
    await rejects(() => fetchLocalUrl('/redirect-internal', BASE), 'same-origin redirect (no redirects at all)')

    // 8. Valid local CSS still loads
    const css = await fetchLocalUrl('/ok.css', BASE)
    assert(css.status === 200, 'local CSS file still loads (200)')
    assert((await css.text()).includes('@font-face'), 'local CSS body is returned intact')

    // 9. Valid local font file still loads
    const font = await fetchLocalUrl('/font.woff2', BASE)
    assert(font.status === 200, 'local font file still loads (200)')

    // 10. All seven supported families remain available
    assert(FONT_FAMILY_VALUES.length === 7, `seven font families are still supported (${FONT_FAMILY_VALUES.length})`)
    const allDefined = FONT_FAMILY_VALUES.every((fam) => {
      const cssText = generateThemeCSS({
        primaryColor: '#1a1a1a', accentColor: '#d4a853', secondaryColor: null,
        themeMode: 'dark', fontFamily: fam,
      })
      return cssText.includes(`--font-${fam}`)
    })
    assert(allDefined, 'every family still produces its CSS variable')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })

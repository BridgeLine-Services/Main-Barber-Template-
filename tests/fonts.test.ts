// §59 — self-hosted font architecture tests (live server on :3000).
// Verifies the production build serves every supported family from local
// files (no Google Fonts dependency), the layout declares all font CSS
// variables, and invalid font selections fall back to the default.

import { generateThemeCSS, FONT_FAMILY_VALUES } from '../src/lib/theme'

const BASE = 'http://localhost:3000'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

async function main() {
  // 1. Homepage HTML applies every font family class on <body>
  //    (next/font production class names are hashed `__variable_*`)
  const html = await fetch(`${BASE}/`).then((r) => r.text())
  // Class-name shape differs across Next.js build versions: older builds emit
  // `__variable_<hex>`, newer ones `inter_<hash>-module__<hash>__variable`.
  // Both formats contain the `__variable` marker exactly once per family.
  const variableClasses = (html.match(/__variable/g) || [])
  assert(variableClasses.length >= 7, `layout body carries all 7 font variable classes (found ${variableClasses.length})`)
  assert(html.includes('font-sans'), 'default font-sans class applied')

  // 2. Build output has no Google Fonts reference
  assert(!html.includes('fonts.googleapis.com') && !html.includes('fonts.gstatic.com'),
    'homepage HTML contains no Google Fonts reference')

  // 3. Every supported family resolves to a locally served @font-face
  const cssLinks = [...html.matchAll(/href="([^"]+\.css[^"]*)"/g)].map((m) => m[1])
  const css = await Promise.all(
    cssLinks.map((l) => fetch(l.startsWith('http') ? l : `${BASE}${l}`).then((r) => r.text()).catch(() => ''))
  ).then((all) => all.join('\n'))
  // Family-name shape also differs: older builds emit `font-family:__inter`,
  // newer ones `font-family:inter` (+ `inter Fallback`). Match the plain name
  // so the check holds across both formats.
  const families = ['inter', 'poppins', 'montserrat', 'playfair', 'roboto', 'oswald', 'lato']
  for (const fam of families) {
    assert(new RegExp(`font-family:${fam}(?: Fallback)?;`).test(css), `built CSS defines self-hosted @font-face for ${fam}`)
  }
  for (const v of ['--font-inter', '--font-poppins', '--font-montserrat', '--font-playfair',
    '--font-roboto', '--font-oswald', '--font-lato']) {
    assert(css.includes(`${v}:`), `CSS declares the ${v} custom property`)
  }
  assert(!css.includes('fonts.googleapis.com') && !css.includes('fonts.gstatic.com'),
    'built CSS contains no Google Fonts URL')

  // 4. Font files actually served from local /_next/static/media
  const woff2Refs = [...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map((m) => m[1])
  assert(woff2Refs.length >= 13, `CSS references ${woff2Refs.length} self-hosted font files (>=13 expected)`)
  const sample = woff2Refs[0]
  if (sample) {
    // url() refs are relative to the CSS file that declares them (e.g. the
    // chunk at /_next/static/css/*.css references ../media/*.woff2), so
    // resolve against the CSS link instead of naively concatenating BASE.
    const firstCss = cssLinks[0]
      ? (cssLinks[0].startsWith('http') ? cssLinks[0] : `${BASE}${cssLinks[0]}`)
      : null
    const sampleUrl = sample.startsWith('http')
      ? sample
      : firstCss ? new URL(sample, firstCss).href : `${BASE}${sample}`
    const res = await fetch(sampleUrl)
    assert(res.status === 200, 'font file is served locally (200)')
  }

  // 5. Unit: theme CSS uses the declared variables for every supported family
  for (const fam of FONT_FAMILY_VALUES) {
    const themeCss = generateThemeCSS({
      primaryColor: '#1a1a1a', accentColor: '#d4a853', secondaryColor: null,
      themeMode: 'dark', fontFamily: fam,
    })
    assert(themeCss.includes(`var(--font-${fam}`), `font choice '${fam}' renders via its CSS variable`)
  }

  // 6. Unit: invalid font falls back to default (no unstyled/missing family)
  const invalidCss = generateThemeCSS({
    primaryColor: '#1a1a1a', accentColor: '#d4a853', secondaryColor: null,
    themeMode: 'dark', fontFamily: 'not-a-real-font',
  })
  assert(!invalidCss.includes('var(--font-not-a-real-font'),
    'invalid font selection does not emit a dangling font variable')

  console.log(`\nFonts tests: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })

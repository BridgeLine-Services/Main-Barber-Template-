/* Themed-dashboard QA (unification phase 2):
   1. Publish each of the five presets to the seeded test business.
   2. Load the REAL dashboard (owner session) at mobile/tablet/desktop widths;
      measure horizontal overflow and viewport-wider elements.
   3. Contrast read-through: compute WCAG contrast of representative text
      elements (body, muted, sidebar, header, buttons, badges) — flags the
      light presets (Barber Heritage, Clean Club) since the dashboard was
      previously dark-only.
   4. Restore the original preset. */
import { chromium } from 'playwright'
import { PrismaClient } from '@prisma/client'
import fs from 'fs'

const prisma = new PrismaClient()
const BASE = 'http://second-test-shop:3000'
const OUT = '/app/conversations/6ab6cc4fb3b8526e5be9ca03/repo/.qa-screens'
const BUSINESS_ID = 'cmuhdcubh0003j3z5enty7epw'
const PRESETS = ['black-label', 'barber-heritage', 'street-cut', 'clean-club', 'modern-classic']
const PAGES = [
  ['/dashboard', 'overview'],
  ['/dashboard/appointments', 'appointments'],
  ['/dashboard/settings', 'settings'],
  ['/dashboard/inventory', 'inventory'],
  ['/dashboard/factory-launch', 'factory-launch'],
  ['/dashboard/audit-log', 'audit-log'],
]
const WIDTHS = [320, 390, 768, 1280]

fs.mkdirSync(OUT, { recursive: true })

// --- load owner2 session cookies from the curl jar into Playwright ---
const jar = fs.readFileSync('/tmp/cj2.txt', 'utf8')
const cookies = jar.split('\n')
  .filter((l) => l && !l.startsWith('# ') && l.trim() !== '' && !l.startsWith('# Netscape') && !l.startsWith('# https'))
  .map((l) => l.replace(/^#HttpOnly_/, ''))
  .map((l) => {
    const [domain, , path, secure, expires, name, value] = l.split('\t')
    const isSecure = String(secure).toLowerCase() === 'true'
    return {
      name, value,
      domain: domain.replace(/^\./, ''),
      path: path || '/',
      expires: Number(expires) || -1,
      secure: isSecure,
      httpOnly: true,
    }
  })

const orig = await prisma.websiteContent.findUnique({ where: { businessId: BUSINESS_ID } })
const origSnap = orig.publishedContent
const origPreset = (origSnap && origSnap.visualPreset) || orig.visualPreset

async function publish(preset) {
  const c = await prisma.websiteContent.findUnique({ where: { businessId: BUSINESS_ID } })
  const snap = { ...((c.publishedContent) || {}), visualPreset: preset }
  await prisma.websiteContent.update({
    where: { businessId: BUSINESS_ID },
    data: { visualPreset: preset, publishedContent: snap },
  })
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addCookies(cookies)

const lum = (r, g, b) => {
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a, b) => {
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

const overflow = []
const contrast = []

for (const preset of PRESETS) {
  await publish(preset)
  for (const [route, name] of PAGES) {
    for (const w of WIDTHS) {
      const page = await ctx.newPage()
      await page.setViewportSize({ width: w, height: 800 })
      await page.goto(BASE + route, { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)
      const m = await page.evaluate(() => {
        const d = document.scrollingElement
        const wide = []
        document.querySelectorAll('main *, aside *').forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.width > d.clientWidth + 1 && r.width < 6000 && wide.length < 2) {
            wide.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} (${Math.round(r.width)}px)`)
          }
        })
        return { sw: d.scrollWidth, cw: d.clientWidth, wide }
      })
      if (m.sw - m.cw > 0) overflow.push({ preset, route, w, by: m.sw - m.cw, wide: m.wide })
      if (w === 1280) {
        await page.screenshot({ path: `${OUT}/dash-${preset}-${name}.png` })
        // contrast read-through on the rendered page
        const c = await page.evaluate(() => {
          const effBg = (el) => {
            // walk to the nearest OPAQUE surface; skip translucent overlays
            let n = el
            while (n && n !== document.documentElement) {
              const bg = getComputedStyle(n).backgroundColor
              const m = bg.match(/rgba?\(([^)]+)\)/)?.[1].split(',').map(Number)
              if (m && (m.length === 3 || m[3] >= 0.95)) return m
              n = n.parentElement
            }
            const b = getComputedStyle(document.body).backgroundColor.match(/rgba?\(([^)]+)\)/)?.[1].split(',').map(Number)
            return b ?? [255, 255, 255]
          }
const parse = (s) => (s.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).slice(0, 3).map(Number)
          const samples = {}
          const pick = (key, selector) => {
            const el = document.querySelector(selector)
            if (!el) return
            const cs = getComputedStyle(el)
            samples[key] = { fg: cs.color, bg: effBg(el), size: cs.fontSize, tag: el.tagName }
          }
          pick('bodyText', 'main h1, main h2, main [class*="font-semibold"]')
          pick('mutedText', 'main p.text-muted-foreground, main .text-muted-foreground')
          pick('sidebarText', 'aside .text-muted-foreground, aside nav div')
          pick('primaryBtn', '.bg-primary')
          pick('badge', 'main [class*="rounded-full"]')
          pick('tableHead', 'table th, [role="columnheader"]')
          return samples
        })
        for (const [key, s] of Object.entries(c)) {
          if (!s) continue
          const fg = s.fg.match(/rgba?\(([^)]+)\)/)?.[1].split(',').map(Number)
          const bg = s.bg
          if (!fg || !bg) continue
          const r = ratio(lum(fg[0] / 255, fg[1] / 255, fg[2] / 255), lum(bg[0] / 255, bg[1] / 255, bg[2] / 255))
          if (r < 4.5) contrast.push({ preset, route, key, r: r.toFixed(2), ...s })
        }
      }
      await page.close()
    }
  }
  console.log('done', preset)
}

await browser.close()
await prisma.websiteContent.update({
  where: { businessId: BUSINESS_ID },
  data: { visualPreset: origPreset, publishedContent: origSnap },
})
console.log('preset restored:', origPreset)
console.log('OVERFLOW:', JSON.stringify(overflow.length ? overflow : 'none'))
console.log('LOW CONTRAST (<4.5):', JSON.stringify(contrast.length ? contrast : 'none'))

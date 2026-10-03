/* Pixel-level viewport QA (master instruction, mobile/preset verification).
   Runs IN the sandbox against the local production server. For each of the
   five presets: publish that preset to the seeded test business (owner2,
   second-test-shop), load the real customer routes at 320/375/390/430/768/
   1024/1280/1440px, measure horizontal overflow, stray elements wider than
   the viewport and broken images, and save full-page screenshots as review
   artifacts.

   Non-destructive: snapshots the exact original visualPreset +
   publishedContent BEFORE the first publish and restores them in a finally
   block — even when navigation or assertions throw. No hard-coded restore
   value. Artifacts → .qa-screens/ */
import { chromium } from 'playwright'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const BASE = 'http://second-test-shop:3000'
const OUT = '/app/conversations/6ab6cc4fb3b8526e5be9ca03/repo/.qa-screens'
const WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1440]
const ROUTES = [
  ['/', 'home'],
  ['/services', 'services'],
  ['/barbers', 'barbers'],
  ['/gallery', 'gallery'],
  ['/reviews', 'reviews'],
  ['/book', 'book'],
  ['/contact', 'contact'],
  ['/about', 'about'],
]
const PRESETS = ['modern-classic', 'black-label', 'barber-heritage', 'street-cut', 'clean-club']
const BUSINESS_ID = 'cmuhdcubh0003j3z5enty7epw'

const fs = await import('fs')
fs.mkdirSync(OUT, { recursive: true })

// ── Non-destructive snapshot: taken before the first mutation ────────────────
const originalContent = await prisma.websiteContent.findUnique({ where: { businessId: BUSINESS_ID } })
const SNAPSHOT = {
  visualPreset: originalContent.visualPreset,
  publishedContent: JSON.parse(JSON.stringify(originalContent.publishedContent ?? null)),
}

const browser = await chromium.launch()

async function publish(preset) {
  const content = await prisma.websiteContent.findUnique({ where: { businessId: BUSINESS_ID } })
  // draft = the editable column itself; publishedContent = the public snapshot
  await prisma.websiteContent.update({
    where: { businessId: BUSINESS_ID },
    data: {
      visualPreset: preset,
      publishedContent: { ...(content.publishedContent ?? {}), visualPreset: preset },
    },
  })
}

const results = []
try {
  for (const preset of PRESETS) {
    await publish(preset)
    const page = await browser.newPage()
    for (const [route, slug] of ROUTES) {
      for (const w of WIDTHS) {
        await page.setViewportSize({ width: w, height: w === 320 ? 568 : 800 })
        await page.goto(BASE + route, { waitUntil: 'networkidle' })
        await page.waitForTimeout(400)
        const m = await page.evaluate(() => {
          const d = document.scrollingElement
          const wide = []
          document.querySelectorAll('body *').forEach((el) => {
            const r = el.getBoundingClientRect()
            if (r.width > d.clientWidth + 1 && r.width < 6000 && !el.closest('[aria-hidden]')) {
              const cls = (el.className && String(el.className).slice(0, 60)) || el.tagName
              if (wide.length < 3) wide.push(`${el.tagName.toLowerCase()}.${cls} (${Math.round(r.width)}px)`)
            }
          })
          const broken = [...document.querySelectorAll('img')]
            .filter(i => i.complete && i.naturalWidth === 0 && i.getAttribute('src'))
            .map(i => i.getAttribute('src').slice(0, 60))
          return { scrollW: d.scrollWidth, clientW: d.clientWidth, wide, broken }
        })
        const overflow = m.scrollW - m.clientW
        results.push({ preset, route, w, overflow, wide: m.wide, broken: m.broken })
        await page.screenshot({ path: `${OUT}/${preset}-${slug}-${w}.png`, fullPage: w <= 430 })
      }
    }
    await page.close()
    console.log('done preset', preset)
  }
} finally {
  await browser.close()
  // Restore the EXACT pre-run state — not a hard-coded preset.
  await prisma.websiteContent.update({
    where: { businessId: BUSINESS_ID },
    data: {
      visualPreset: SNAPSHOT.visualPreset,
      publishedContent: SNAPSHOT.publishedContent,
    },
  })
  console.log(`original state restored (preset: ${SNAPSHOT.visualPreset})`)
  await prisma.$disconnect()
}

const bad = results.filter((r) => r.overflow > 0)
const broken = results.filter((r) => r.broken.length > 0)
console.log('OVERFLOW SUMMARY:', JSON.stringify(bad.length ? bad : 'none — all clean'))
console.log('BROKEN IMAGES:', JSON.stringify(broken.length ? broken : 'none — all clean'))
if (bad.length || broken.length) process.exit(1)

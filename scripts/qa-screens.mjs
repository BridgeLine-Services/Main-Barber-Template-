/* Pixel-level viewport QA (master instruction, mobile/preset verification).
   Runs IN the sandbox against the local production server. For each of the
   five presets: publish that preset to the seeded test business (owner2,
   second-test-shop), load the real customer homepage at 320/375/390/430/768/
   1024/1280/1440px, measure horizontal overflow + stray elements wider than
   the viewport, and save full-page screenshots as review artifacts. */
import { chromium } from 'playwright'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const BASE = 'http://second-test-shop:4321'
const OUT = '/app/conversations/6ab6cc4fb3b8526e5be9ca03/repo/.qa-screens'
const WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1440]
const ROUTES = [
  ['/', 'home'],
  ['/services', 'services'],
  ['/barbers', 'barbers'],
  ['/gallery', 'gallery'],
  ['/book', 'book'],
  ['/contact', 'contact'],
  ['/about', 'about'],
]
const PRESETS = ['modern-classic', 'black-label', 'barber-heritage', 'street-cut', 'clean-club']
const BUSINESS_ID = 'cmuhdcubh0003j3z5enty7epw'

const fs = await import('fs')
fs.mkdirSync(OUT, { recursive: true })

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
      return { scrollW: d.scrollWidth, clientW: d.clientWidth, wide }
    })
    const overflow = m.scrollW - m.clientW
    results.push({ preset, route, w, overflow, wide: m.wide })
    await page.screenshot({ path: `${OUT}/${preset}-${slug}-${w}.png`, fullPage: w <= 430 })
  }
  }
  await page.close()
  console.log('done preset', preset)
}
await browser.close()
// restore the seeded business's original preset so QA runs leave no trace
const orig = await prisma.websiteContent.findUnique({ where: { businessId: BUSINESS_ID } })
await prisma.websiteContent.update({
  where: { businessId: BUSINESS_ID },
  data: {
    visualPreset: 'modern-classic',
    publishedContent: { ...(orig.publishedContent ?? {}), visualPreset: 'modern-classic' },
  },
})
console.log('preset restored: modern-classic')
await prisma.$disconnect()
const bad = results.filter((r) => r.overflow > 0)
console.log('OVERFLOW SUMMARY:', JSON.stringify(bad.length ? bad : 'none — all clean'))

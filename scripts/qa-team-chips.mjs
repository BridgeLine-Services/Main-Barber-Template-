/* Targeted QA sweep for the team-discovery additions (years of experience,
   next-available chips, specialty chips, profile links). For each of the
   eight visual presets: publish that preset to the seeded test business
   (second-test-shop), then verify the routes that render team sections
   (/ , /barbers, /barbers/barber-one) at mobile + desktop widths.

   Checks per route/width:
     - page renders (no 5xx)
     - console has no page errors
     - no horizontal overflow
     - no broken images
     - the Next-available chip and the years-experience line render when the
       data supports them (chip always expected here: the seeded shop has
       open slots; years only for Barber One)

   Non-destructive: snapshots the exact original visualPreset +
   publishedContent before the first publish and restores them in a finally
   block. */
import { chromium } from 'playwright'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const BASE = 'http://second-test-shop:3000'

const business = await prisma.business.findUnique({ where: { slug: 'second-test-shop' } })
if (!business) throw new Error('test shop "second-test-shop" not found — run the seed first')
const BUSINESS_ID = business.id

const originalContent = await prisma.websiteContent.findUnique({ where: { businessId: BUSINESS_ID } })
const SNAPSHOT = {
  visualPreset: originalContent?.visualPreset ?? null,
  publishedContent: originalContent?.publishedContent ?? undefined,
}
const restore = async () => {
  await prisma.websiteContent.update({
    where: { businessId: BUSINESS_ID },
    data: { visualPreset: SNAPSHOT.visualPreset, publishedContent: SNAPSHOT.publishedContent },
  })
}

const PRESETS = ['modern-classic', 'black-label', 'barber-heritage', 'street-cut', 'clean-club', 'warm-premium', 'high-energy-urban', 'single-chair']
const ROUTES = [
  ['/', 'home'],
  ['/barbers', 'barbers'],
  ['/barbers/barber-one', 'barber-one-profile'],
]
const WIDTHS = [375, 1280]

const browser = await chromium.launch()
const failures = []

try {
  for (const preset of PRESETS) {
    const contentRow = await prisma.websiteContent.findUnique({ where: { businessId: BUSINESS_ID } })
    await prisma.websiteContent.update({
      where: { businessId: BUSINESS_ID },
      data: {
        visualPreset: preset,
        publishedContent: {
          ...(contentRow?.publishedContent ?? {}),
          visualPreset: preset,
        },
      },
    })

    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    const consoleErrors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    for (const [route, name] of ROUTES) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        const resp = await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => null)
        if (!resp || resp.status() >= 400) {
          failures.push(`${preset} ${name}@${width}: HTTP ${resp ? resp.status() : 'no response'}`)
          continue
        }
        await page.waitForTimeout(400)

        const audit = await page.evaluate(() => {
          const doc = document.documentElement
          const overflowX = doc.scrollWidth - doc.clientWidth
          const wide = [...document.querySelectorAll('body *')]
            .filter((el) => el.getBoundingClientRect().width > doc.clientWidth + 1)
            .slice(0, 3)
            .map((el) => el.tagName + '.' + String(el.className).slice(0, 60))
          const brokenImages = [...document.querySelectorAll('img')]
            .filter((img) => img.complete && img.naturalWidth === 0 && img.getAttribute('src')?.startsWith('http'))
            .map((img) => img.src.slice(0, 80))
          const chip = document.body.innerText.includes('Next:') || document.body.innerText.includes('Next available:')
          const years = document.body.innerText.includes('years behind the chair')
          return { overflowX, wide, brokenImages, chip, years }
        })

        if (audit.overflowX > 2) failures.push(`${preset} ${name}@${width}: overflow ${audit.overflowX}px ${JSON.stringify(audit.wide)}`)
        if (audit.brokenImages.length) failures.push(`${preset} ${name}@${width}: broken images ${audit.brokenImages.join(',')}`)
        if (!audit.chip) failures.push(`${preset} ${name}@${width}: next-available chip missing`)
        if (name === 'barbers' && !audit.years) failures.push(`${preset} ${name}@${width}: years line missing`)
        if (name === 'barber-one-profile' && !audit.years) failures.push(`${preset} ${name}@${width}: profile years missing`)
      }
    }
    // Dev-server-only noise: React dev-mode eval + HMR websockets. Neither
    // exists in production builds (verified by the production sweeps).
    const relevantErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('Download the React DevTools') && !e.includes('eval()') && !e.includes('WebSocket connection')
    )
    if (relevantErrors.length) failures.push(`${preset}: console errors: ${relevantErrors.slice(0, 3).join(' | ')}`)
    await ctx.close()
    console.log(`preset ${preset} done`)
  }
} finally {
  await restore()
  await browser.close()
  await prisma.$disconnect()
}

if (failures.length) {
  console.log('\nFAILURES:')
  failures.forEach((f) => console.log(' -', f))
  process.exit(1)
}
console.log('\nAll presets clean: chips, years lines, no overflow, no broken images.')

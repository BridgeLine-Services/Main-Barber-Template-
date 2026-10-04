/* Targeted QA sweep for the featured-work module (gap 8) + honest review
   signals (dates, Google badge) + parking note. For each of the eight visual
   presets: publish that preset to the seeded test business (second-test-shop),
   then drive the homepage at mobile + desktop widths with a real browser.

   Checks per preset/width:
     - page renders, no console errors, no horizontal overflow, no broken images
     - "Signature Work" section renders with the seeded strip (6 tiles)
     - category chips render (All + Beard + Kids + Specialty + Before & After)
     - clicking a chip filters the tiles and moves aria-pressed
     - clicking a tile opens the shared lightbox: caption, barber/service
       attribution, "Book This Service" + "Book With <barber>" deep links
     - "Book This Service" navigates to /book?serviceId=... (deep-link flow)
     - Escape closes the lightbox
     - review cards show a date; the Google review shows the Google badge
     - parking note renders when the business has parkingAvailable

   Non-destructive: snapshots visualPreset + publishedContent before the
   first publish and restores them in a finally block. */
import { chromium } from 'playwright'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
// Production-build QA (default) — the sandbox dev server can't complete React
// hydration (turbopack flight streams need the HMR websocket, which is blocked
// here), so interactive checks MUST run against `next start` on port 3100.
const BASE = process.env.QA_BASE ?? 'http://second-test-shop:3100'

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
const WIDTHS = [375, 1280]

const browser = await chromium.launch()
const failures = []

async function auditFeatured(page, label) {
  // Center the section in the viewport so the sticky bottom nav (mobile)
  // never intercepts chip/tile clicks.
  await page.evaluate(() => {
    document
      .querySelector('[aria-label="Filter featured work by category"]')
      ?.scrollIntoView({ block: 'center' })
  })

  // ── Section + chips ──
  const chipGroup = page.locator('[aria-label="Filter featured work by category"]')
  if ((await chipGroup.count()) !== 1) {
    failures.push(`${label}: featured-work chip group missing`)
    return
  }
  const chips = chipGroup.locator('button')
  // Chip labels carry a CSS text-transform on some presets — compare
  // case-insensitively against the rendered text.
  const chipLabels = (await chips.allInnerTexts()).map((t) => t.trim())
  const lowered = chipLabels.map((t) => t.toLowerCase())
  for (const expected of ['All', 'Beard', 'Kids', 'Specialty', 'Before & After']) {
    if (!lowered.includes(expected.toLowerCase())) failures.push(`${label}: chip "${expected}" missing (got ${chipLabels.join(',')})`)
  }
  const pressedCount = await chipGroup.locator('button[aria-pressed="true"]').count()
  if (pressedCount !== 1) failures.push(`${label}: expected 1 pressed chip, got ${pressedCount}`)

  // Featured section = ancestor section of the chip group
  const section = page.locator('section', { has: chipGroup })

  // ── Tiles ──
  const tiles = section.locator('button:has(img)')
  const allCount = await tiles.count()
  if (allCount !== 6) failures.push(`${label}: expected 6 tiles, got ${allCount}`)

  // ── Chip filtering: Kids ──
  await chipGroup.locator('button', { hasText: 'Kids' }).click()
  await page.waitForTimeout(150)
  const kidsCount = await tiles.count()
  if (kidsCount !== 1) failures.push(`${label}: Kids filter expected 1 tile, got ${kidsCount}`)
  const kidsPressed = await chipGroup.locator('button[aria-pressed="true"]').innerText()
  if (kidsPressed.trim().toLowerCase() !== 'kids') failures.push(`${label}: aria-pressed did not move to Kids (got ${kidsPressed})`)

  // ── Lightbox from filtered tile ──
  const tile = tiles.first()
  const tileLabel = await tile.getAttribute('aria-label')
  await tile.click()
  const dialog = page.locator('[role="dialog"]')
  await dialog.waitFor({ state: 'visible', timeout: 5000 })
  const dialogText = (await dialog.innerText()).toLowerCase()
  if (!dialogText.includes('1 of 1')) failures.push(`${label}: lightbox counter expected "1 of 1", got "${dialogText.match(/\d+ of \d+/)?.[0] ?? 'none'}"`)
  if (!tileLabel || !dialogText.includes(tileLabel.toLowerCase())) failures.push(`${label}: lightbox missing caption "${tileLabel}"`)
  if (!/by .+/.test(dialogText) || !dialogText.includes('kids haircut')) {
    failures.push(`${label}: lightbox attribution missing barber/service (tile=${tileLabel})`)
  }
  const bookService = dialog.locator('a', { hasText: 'Book This Service' })
  if ((await bookService.count()) !== 1) failures.push(`${label}: Book This Service link missing`)
  const bookWith = dialog.locator('a', { hasText: 'Book With ' })
  if ((await bookWith.count()) !== 1) failures.push(`${label}: Book With <barber> link missing`)
  const bookHref = await bookService.getAttribute('href')
  if (!bookHref || !/^\/book\?serviceId=[^&]+&barberId=/.test(bookHref)) {
    failures.push(`${label}: Book This Service href malformed: ${bookHref}`)
  }

  // ── Deep-link flow: Book This Service navigates to /book ──
  await bookService.click()
  await page.waitForURL(/\/book\?serviceId=/, { timeout: 10000 }).catch(() => {
    failures.push(`${label}: did not navigate to /book deep link (url=${page.url()})`)
  })
  // The /book page streams its service list after the URL flips — poll until
  // the deep-linked service shows up (or give up after 8s).
  let bookStatus = false
  for (let i = 0; i < 40 && !bookStatus; i++) {
    bookStatus = await page
      .evaluate(() => document.querySelector('main')?.textContent?.toLowerCase().includes('kids haircut') ?? false)
      .catch(() => false)
    if (!bookStatus) await page.waitForTimeout(200)
  }
  if (!bookStatus) failures.push(`${label}: /book deep link did not preselect "Kids Haircut"`)
  await page.goBack()
  await page.waitForTimeout(300)

  // ── Back to All, open unfiltered lightbox, Escape closes ──
  await chipGroup.locator('button', { hasText: 'All' }).first().click()
  await page.waitForTimeout(150)
  await tiles.nth(1).click()
  await dialog.waitFor({ state: 'visible', timeout: 5000 })
  const counterAll = ((await dialog.innerText()).match(/\d+ of \d+/i)?.[0] ?? '').toLowerCase()
  if (counterAll !== '2 of 6') failures.push(`${label}: unfiltered lightbox counter expected "2 of 6", got "${counterAll || 'none'}"`)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {
    failures.push(`${label}: Escape did not close lightbox`)
  })

  // ── Review signals + parking ──
  const bodyText = await page.evaluate(() => document.body.innerText)
  if (!/September 2026/.test(bodyText)) failures.push(`${label}: review date missing`)
  if (!/Google Review/.test(bodyText)) failures.push(`${label}: Google badge missing on Google review`)
  if (!/Parking available/i.test(bodyText)) failures.push(`${label}: parking note missing`)
}

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

    for (const width of WIDTHS) {
      const label = `${preset} home@${width}`
      await page.setViewportSize({ width, height: 900 })
      const resp = await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 45000 }).catch(() => null)
      if (!resp || resp.status() >= 400) {
        failures.push(`${label}: HTTP ${resp ? resp.status() : 'no response'}`)
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
        const eyebrow = /signature work/i.test(document.body.innerText)
        return { overflowX, wide, brokenImages, eyebrow }
      })

      if (audit.overflowX > 2) failures.push(`${label}: overflow ${audit.overflowX}px ${JSON.stringify(audit.wide)}`)
      if (audit.brokenImages.length) failures.push(`${label}: broken images ${audit.brokenImages.join(',')}`)
      if (!audit.eyebrow) failures.push(`${label}: Signature Work section missing`)

      await auditFeatured(page, label)
    }
    // Dev-server-only noise: React dev-mode eval + HMR websockets. Neither
    // exists in production builds (verified by the production sweeps).
    const relevantErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('Download the React DevTools') && !e.includes('eval()') && !e.includes('WebSocket connection')
    )
    if (relevantErrors.length) failures.push(`${preset}: console errors: ${relevantErrors.slice(0, 3).join(' | ')}`)
    await ctx.close()
    console.log(`swept ${preset}`)
  }
} finally {
  await restore()
  await browser.close()
  await prisma.$disconnect()
}

if (failures.length) {
  console.error(`\nFAILURES (${failures.length}):`)
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log('\nFeatured-work QA sweep: all checks passed across 8 presets x 2 widths')

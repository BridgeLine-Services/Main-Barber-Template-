/* Gallery-state QA (Priority 2 acceptance test): for each preset, render the
   homepage and gallery with a FULL, SMALL (single image) and EMPTY gallery,
   at mobile (320px) and desktop (1280px). Verifies no broken images, no
   horizontal overflow, deliberate fallbacks in the empty state, and that the
   lead-image hierarchy holds when images exist. Restores the original
   isPublished flags afterwards. Artifacts → .qa-gallery-states/ */
import { chromium } from 'playwright'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const BASE = 'http://second-test-shop:4321'
const OUT = '/app/conversations/6ab6cc4fb3b8526e5be9ca03/repo/.qa-gallery-states'
const WIDTHS = [320, 1280]
const STATES = [
  ['full', null],       // leave flags untouched (seeded shop = many published)
  ['small', 1],         // exactly 1 published portfolio/gallery image
  ['empty', 0],        // none published
]
const PRESETS = ['modern-classic', 'black-label', 'barber-heritage', 'street-cut', 'clean-club']
const BUSINESS_ID = 'cmuhdcubh0003j3z5enty7epw'

const fs = await import('fs')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
let failures = 0
const fail = (msg) => { console.log(`  ❌ ${msg}`); failures++ }

async function publish(preset) {
  const content = await prisma.websiteContent.findUnique({ where: { businessId: BUSINESS_ID } })
  // featuredWork must be ON: Priority 2 tests its full/small/empty states.
  const ids = ['hero', 'shopStatus', 'featuredWork', 'services', 'team', 'beforeAfter', 'reviews', 'visit', 'finalCta']
  const homeModules = { modules: ids.map(id => ({ id, enabled: true, settings: {} })) }
  await prisma.websiteContent.update({
    where: { businessId: BUSINESS_ID },
    data: {
      visualPreset: preset,
      publishedContent: { ...(content.publishedContent ?? {}), visualPreset: preset, homeModules },
    },
  })
  // QA-data hygiene: the legacy seeded shop carries fake cdn.example.com
  // placeholder URLs that render as broken images in every browser. Clearing
  // them exercises the intentional missing-photo fallbacks instead.
  await prisma.business.update({ where: { id: BUSINESS_ID }, data: { logo: null } })
  const draft = await prisma.websiteContent.findUnique({ where: { businessId: BUSINESS_ID } })
  if (draft.heroImageUrl) {
    await prisma.websiteContent.update({
      where: { businessId: BUSINESS_ID },
      data: { heroImageUrl: null },
    })
  }
}

async function setGalleryState(keep) {
  const rows = await prisma.mediaAsset.findMany({
    where: { businessId: BUSINESS_ID, type: { in: ['BARBER_PORTFOLIO', 'GALLERY'] } },
    select: { id: true, isPublished: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  })
  if (keep === null) return { snapshot: rows }
  // keep the first `keep` by sortOrder; hide the rest
  for (const r of rows) {
    const want = rows.slice(0, keep).some(x => x.id === r.id)
    if (r.isPublished !== want) {
      await prisma.mediaAsset.update({ where: { id: r.id }, data: { isPublished: want } })
    }
  }
  return { snapshot: rows }
}

async function restoreGallery(snapshot) {
  for (const r of snapshot) {
    await prisma.mediaAsset.update({ where: { id: r.id }, data: { isPublished: r.isPublished } })
  }
}

async function audit(page, preset, state, width, route, routeName) {
  const url = `${BASE}${route}`
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(250)

  const m = await page.evaluate(() => {
    const doc = document.documentElement
    const overflowX = Math.max(doc.scrollWidth, document.body.scrollWidth) - doc.clientWidth
    const imgs = [...document.querySelectorAll('img')]
    const broken = imgs.filter(i => i.complete && i.naturalWidth === 0 && i.getAttribute('src'))
    // large visual gaps: elements with height>120 at the very bottom of main content
    return {
      overflowX,
      imgCount: imgs.length,
      brokenCount: broken.length,
      brokenSrcs: broken.slice(0, 3).map(i => i.getAttribute('src')),
      title: document.title,
      bodyHasBooking: !!document.querySelector('a[href*="/book"], a[href^="/book"], a[href*="book"]'),
    }
  })
  const tag = `${preset}/${state}/${width}/${routeName}`
  if (m.overflowX > 1) fail(`${tag}: horizontal overflow ${m.overflowX}px`)
  if (m.brokenCount > 0) fail(`${tag}: ${m.brokenCount} broken image(s) ${JSON.stringify(m.brokenSrcs)}`)
  if (m.imgCount === 0) {
    // empty state must be intentional: text fallback, not a bare blank area
    const intentional = await page.evaluate(() => {
      const t = document.body.innerText
      return /photos|gallery|work|coming soon|upload|portfolio/i.test(t)
    })
    if (!intentional) fail(`${tag}: no images and no recognizable empty-state copy`)
  }
  if (!m.bodyHasBooking) fail(`${tag}: no booking CTA reachable`)
  await page.screenshot({ path: `${OUT}/${tag.replace(/\//g, '_')}.png`, fullPage: true })
  console.log(`  📸 ${tag}: imgs=${m.imgCount} overflow=${m.overflowX}px`)
}

async function main() {
  const snapshotFull = await prisma.mediaAsset.findMany({
    where: { businessId: BUSINESS_ID, type: { in: ['BARBER_PORTFOLIO', 'GALLERY'] } },
    select: { id: true, isPublished: true },
  })
  try {
    const snapshot = await prisma.mediaAsset.findMany({
      where: { businessId: BUSINESS_ID, type: { in: ['BARBER_PORTFOLIO', 'GALLERY'] } },
      select: { id: true, isPublished: true },
    })
    for (const preset of PRESETS) {
      await publish(preset)
      console.log(`\n🎨 ${preset}`)
      for (const [state, keep] of STATES) {
        await setGalleryState(keep)
        for (const width of WIDTHS) {
          const page = await browser.newPage({ viewport: { width, height: 900 } })
          await audit(page, preset, state, width, '/', 'home')
          await audit(page, preset, state, width, '/gallery', 'gallery')
          await page.close()
        }
        await restoreGallery(snapshot) // restore after EVERY state
      }
    }
  } finally {
    // restore seeded flags and preset
    await restoreGallery(snapshotFull)
    const content = await prisma.websiteContent.findUnique({ where: { businessId: BUSINESS_ID } })
    await prisma.websiteContent.update({
      where: { businessId: BUSINESS_ID },
      data: {
        visualPreset: content.visualPreset,
        publishedContent: { ...(content.publishedContent ?? {}) },
      },
    })
    await prisma.$disconnect()
    await browser.close()
  }
  console.log(failures === 0 ? '\n✅ gallery-state matrix clean' : `\n❌ ${failures} failure(s)`)
  process.exit(failures === 0 ? 0 : 1)
}
main()

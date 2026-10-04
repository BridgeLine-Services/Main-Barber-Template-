/* Computed-style audit of the rendered homepage: measures the real
   typography hierarchy, section spacing rhythm, button system, and card
   padding actually delivered to customers. Guides the polish pass with
   data instead of guesses. */
import { chromium } from 'playwright'
import fs from 'fs'

const BASE = 'http://second-test-shop:3000'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(1000)

const audit = await page.evaluate(() => {
  const px = (v) => parseFloat(v) || 0
  const out = { headings: [], buttons: [], sections: [], cards: [], paragraphs: [] }

  // 1. Heading hierarchy actually rendered
  Array.from(document.querySelectorAll('main h1, main h2, main h3')).forEach((h) => {
    const cs = getComputedStyle(h)
    out.headings.push({
      tag: h.tagName,
      text: h.textContent.trim().slice(0, 32),
      ctx: h.closest('section')?.querySelector('.eyebrow')?.textContent?.trim().slice(0,20) ?? h.closest('section')?.getAttribute('class')?.slice(0,20) ?? '?',
      size: px(cs.fontSize),
      weight: cs.fontWeight,
      tracking: cs.letterSpacing,
      lineHeight: cs.lineHeight,
    })
  })

  // 2. Buttons: geometry + type
  Array.from(document.querySelectorAll('main a[href*="book"], main button, main a[class*="inline-flex"]')).slice(0, 40).forEach((b) => {
    const cs = getComputedStyle(b)
    const r = b.getBoundingClientRect()
    if (r.height === 0) return
    out.buttons.push({
      text: b.textContent.trim().slice(0, 24),
      h: Math.round(r.height),
      w: Math.round(r.width),
      radius: cs.borderRadius,
      size: px(cs.fontSize),
      weight: cs.fontWeight,
      tracking: cs.letterSpacing,
      bg: cs.backgroundColor,
    })
  })

  // 3. Section vertical rhythm: gaps between successive top-level sections
  const sections = Array.from(document.querySelectorAll('main section'))
  let prevBottom = null
  sections.forEach((s) => {
    const r = s.getBoundingClientRect()
    const cs = getComputedStyle(s)
    out.sections.push({
      cls: (s.className || '').slice(0, 40),
      h: Math.round(r.height),
      padTop: cs.paddingTop,
      padBottom: cs.paddingBottom,
      bg: cs.backgroundColor,
      gapFromPrev: prevBottom === null ? null : Math.round(r.top + window.scrollY - prevBottom),
    })
    prevBottom = r.bottom + window.scrollY
  })

  // 4. Card internal padding consistency
  Array.from(document.querySelectorAll('main article')).slice(0, 20).forEach((c) => {
    const cs = getComputedStyle(c)
    out.cards.push({
      pad: cs.padding,
      radius: cs.borderRadius,
      border: cs.border,
      shadow: cs.boxShadow === 'none' ? 'none' : 'shadow',
      section: c.closest('section')?.querySelector('h2')?.textContent?.trim().slice(0, 24) ?? '?',
    })
  })

  // 5. Body/paragraph typography
  Array.from(document.querySelectorAll('main p')).slice(0, 15).forEach((p) => {
    const cs = getComputedStyle(p)
    out.paragraphs.push({
      text: p.textContent.trim().slice(0, 24),
      size: px(cs.fontSize),
      lh: cs.lineHeight,
      color: cs.color,
    })
  })

  return out
})

fs.writeFileSync('/tmp/polish/audit.json', JSON.stringify(audit, null, 1))
console.log('== HEADINGS ==')
const hSizes = [...new Set(audit.headings.map((h) => `${h.tag} ${h.size}px/${h.weight}`))]
hSizes.forEach((h) => console.log(' ', h))
console.log('== BUTTONS (unique h/size/weight/radius) ==')
const bKeys = new Map()
audit.buttons.forEach((b) => {
  const k = `${b.h}h ${b.size}px/${b.weight} r:${b.radius}`
  bKeys.set(k, (bKeys.get(k) || 0) + 1)
})
bKeys.forEach((v, k) => console.log(' ', v + 'x', k))
console.log('== SECTION RHYTHM ==')
audit.sections.forEach((s) =>
  console.log(' ', s.cls.slice(0, 30).padEnd(30), 'h:' + String(s.h).padEnd(5), 'pad:' + s.padTop + '/' + s.padBottom, 'gap:' + s.gapFromPrev)
)
console.log('== CARD PADDING (unique) ==')
const cKeys = new Map()
audit.cards.forEach((c) => cKeys.set(`${c.section} pad:${c.pad} r:${c.radius}`, (cKeys.get(`${c.section} pad:${c.pad} r:${c.radius}`) || 0) + 1))
cKeys.forEach((v, k) => console.log(' ', v + 'x', k))

await browser.close()

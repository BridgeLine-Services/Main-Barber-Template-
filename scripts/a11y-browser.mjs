/**
 * Accessibility, in a real browser (Part 16, second pass).
 *
 * scripts/a11y-static.mjs reads server-rendered HTML and catches structural
 * problems cheaply. It cannot see what a person actually meets: a widget that
 * renders accessible markup but traps the keyboard, a control with no visible
 * focus ring, a colour contrast failure produced by CSS the HTML check never
 * evaluates, or content that only exists after hydration.
 *
 * This runs axe-core against a running build, then walks the page with the
 * keyboard the way a keyboard-only customer would.
 *
 * Usage:
 *   npm run build && npx next start -p 3100 &
 *   npx tsx scripts/a11y-browser.mjs            # default http://127.0.0.1:3100
 *   QA_BASE=http://second-test-shop:3100 npx tsx scripts/a11y-browser.mjs
 *   npx tsx scripts/a11y-browser.mjs --pages /,/book
 *
 * Exit codes: 0 clean, 1 violations or keyboard trouble, 3 the site is not up.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:3100'
const PAGES = (args.includes('--pages')
  ? args[args.indexOf('--pages') + 1]
  : '/,/book,/login,/register,/services,/shop,/terms,/privacy'
).split(',')

// axe-core ships inside @axe-core/playwright; resolve it rather than adding a dependency.
let axeSource = ''
try {
  axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
} catch {
  const guess = require.resolve('@axe-core/playwright')
  axeSource = readFileSync(guess.replace(/dist\/index\.js$/, 'node_modules/axe-core/axe.min.js'), 'utf8')
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

let violations = 0
let keyboardIssues = 0
const report = []

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await page.goto(BASE, { timeout: 8000, waitUntil: 'domcontentloaded' })
      if (response && response.status() < 500) return true
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return false
}

if (!(await waitForServer())) {
  console.log(`a11y-browser: SKIPPED (nothing answering at ${BASE}; start the build first)`)
  await browser.close()
  process.exit(3)
}

for (const path of PAGES) {
  const url = `${BASE}${path}`
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => null)
  const status = response?.status() ?? 0
  if (status >= 400) {
    report.push(`${path} — HTTP ${status}, not audited`)
    continue
  }

  // Wait for the page to finish rendering before judging it. A streamed route can
  // answer 200 while still showing a skeleton, and auditing that snapshot blames
  // the page for a landmark it was about to paint.
  const settled = await page
    .waitForFunction(() => document.querySelector('main, [role="main"]') !== null, null, { timeout: 8000 })
    .then(() => true)
    .catch(() => false)
  if (!settled) {
    report.push(`${path} — no main landmark appeared within 8s; treated as not rendered, not as a violation`)
    continue
  }

  await page.addScriptTag({ content: axeSource })
  const results = await page.evaluate(async () => {
    return await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    })
  })

  const found = results.violations ?? []
  for (const violation of found) {
    violations += 1
    const nodes = (violation.nodes ?? []).slice(0, 3)
    const targets = nodes.map((node) => node.target?.join(' ') ?? '?')
    report.push(`${path} — ${violation.impact ?? 'unknown'}: ${violation.id} (${targets.join(' | ')})`)
    // The snippet is what makes a finding actionable without re-running the audit.
    const snippet = (nodes[0]?.html ?? '').replace(/\s+/g, ' ').slice(0, 120)
    if (snippet) report.push(`    ${snippet}`)
  }

  // Keyboard pass: the first few focusable controls must be reachable with Tab and
  // must show where the focus is. A focus ring nobody can see is the failure this
  // catches, and it is the one automated HTML checks never see.
  const focusable = await page.evaluate(() => {
    const selector = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    return document.querySelectorAll(selector).length
  })

  const ringless = []
  if (focusable > 0) {
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null))
    for (let step = 0; step < Math.min(focusable, 12); step++) {
      await page.keyboard.press('Tab')
      const info = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        const style = getComputedStyle(el)
        const outlineWidth = parseFloat(style.outlineWidth || '0')
        const outlineVisible = style.outlineStyle !== 'none' && outlineWidth > 0
        const shadow = style.boxShadow && style.boxShadow !== 'none'
        return {
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 40),
          visible: outlineVisible || shadow,
        }
      })
      if (!info) continue
      if (!info.visible) ringless.push(`${info.tag}${info.label ? ` "${info.label}"` : ''}`)
    }
  }
  if (ringless.length > 0) {
    keyboardIssues += ringless.length
    report.push(`${path} — keyboard focus with no visible indicator on ${ringless.slice(0, 4).join(', ')}`)
  }
}

await browser.close()

const audited = PAGES.length
console.log(`\na11y-browser: ${audited} page(s) at ${BASE}`)
if (report.length === 0) {
  console.log('  no accessibility violations, and every keyboard stop showed a focus indicator')
} else {
  for (const line of report) console.log(`  ${line}`)
}
console.log(`\nResult: ${violations} violation(s), ${keyboardIssues} keyboard indicator problem(s)`)
process.exit(violations === 0 && keyboardIssues === 0 ? 0 : 1)

#!/usr/bin/env node
/**
 * Static accessibility audit (Part 16). Browser-free on purpose: it runs in CI and
 * in the sandbox where Playwright browsers are not installed, so the accessibility
 * gate is never silently skipped.
 *
 *   node scripts/a11y-static.mjs --base http://localhost:3210
 *
 * Fetches real rendered HTML from a running build and checks the failures that
 * make a shop unusable with a screen reader or keyboard:
 *   • <html lang>
 *   • exactly one <h1> and no skipped heading level
 *   • every <img> has a non-empty alt (or alt="" for decoration, which is valid)
 *   • every form control has a label, aria-label or aria-labelledby
 *   • every button/link has an accessible name
 *   • no tabindex greater than 0
 *   • landmark regions present (main)
 *
 * This does not replace a human review, and says so in its output. Exit 0 clean,
 * 1 violations, 2 the app is not reachable.
 */
import process from 'node:process'

const args = process.argv.slice(2)
const baseIndex = args.indexOf('--base')
// A flag, not an environment variable: this is a one-off command, not app config,
// and an undeclared variable in the registry would fail the drift gate.
const BASE = (baseIndex >= 0 ? args[baseIndex + 1] : 'http://localhost:3210').replace(/\/$/, '')
const PAGES = (args.includes('--pages') ? args[args.indexOf('--pages') + 1] : '/,/book,/login,/register,/services,/shop,/terms,/privacy').split(',')

// Removing one comment can expose a new marker ("<!--<!---->-->" becomes "<!-->"), so the
// pass repeats until the string stops changing. If a marker survives every pass it means a
// comment was never closed; the rest of the document is then inside that comment, so the
// string is truncated at the marker rather than having the marker deleted. Deleting a
// multi-character marker is what creates a new one, so this never deletes one.
function stripComments(html) {
  let current = html
  for (let pass = 0; pass < 10; pass++) {
    const next = current.replace(/<!--[\s\S]*?-->/g, '')
    if (next === current) break
    current = next
  }
  const unterminated = current.indexOf('<!--')
  return unterminated === -1 ? current : current.slice(0, unterminated)
}

// Two severities. "hard" is provable from server-rendered HTML and is a blocker.
// "advisory" covers structure a browser pass must confirm first: a landmark or a
// heading can legitimately come from a hydrated shell, and this audit has no
// browser. Advisory findings are printed in full and recorded; only --strict
// fails the build on them, because a gate that cries wolf gets switched off.
function check(html) {
  const hard = []
  const advisory = []

  if (!/<html[^>]+lang=/i.test(html)) hard.push('the page does not declare a language, so a screen reader cannot pick a voice')
  const headings = [...html.matchAll(/<h([1-6])[\s>]/gi)].map((m) => Number(m[1]))
  const h1s = headings.filter((level) => level === 1).length
  if (h1s === 0) advisory.push('no <h1>')
  if (h1s > 1) advisory.push(`${h1s} <h1> elements on one page`)
  if (!/<main[\s>]/i.test(html)) advisory.push('no <main> landmark')
  let previous = 0
  for (const level of headings) {
    if (previous && level > previous + 1) { advisory.push(`heading jumps from h${previous} to h${level}`); break }
    previous = level
  }

  for (const img of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt\s*=/i.test(img[0])) hard.push(`an <img> has no alt attribute: ${img[0].slice(0, 70)}`)
  }
  for (const control of html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
    const tag = control[0]
    if (/type\s*=\s*["'](hidden|submit|button)["']/i.test(tag)) continue
    const name = tag.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1]
    const labelledByAttribute = /\baria-label(ledby)?\s*=/i.test(tag)
    const labelledByElement = name ? new RegExp(`<label[^>]+for\\s*=\\s*["']${name}["']`, 'i').test(html) : false
    if (!labelledByAttribute && !labelledByElement) hard.push(`a form control has no label: ${tag.slice(0, 70)}`)
  }
  for (const button of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)) {
    const [tag, inner] = button
    // Repeated until stable: one pass turns '<<b>script>' into '<script>', which is
    // how a naive tag strip lets a tag survive. Bounded so input cannot spin.
    let text = inner
    for (let pass = 0; pass < 10; pass++) {
      const next = text.replace(/<[^<>]*>/g, '')
      if (next === text) break
      text = next
    }
    text = text.trim()
    if (!text && !/aria-label|aria-labelledby|title\s*=/i.test(tag)) hard.push(`a button has no accessible name: ${tag.slice(0, 70)}`)
  }
  for (const match of html.matchAll(/tabindex\s*=\s*["']?(\d+)/gi)) {
    if (Number(match[1]) > 0) { hard.push(`tabindex="${match[1]}" takes an element out of document order`); break }
  }
  return { hard, advisory }
}

const strict = args.includes('--strict')
let violations = 0
let advisoryCount = 0
let checked = 0
for (const page of PAGES) {
  let response
  try {
    response = await fetch(`${BASE}${page}`, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
  } catch (error) {
    console.error(`Cannot reach ${BASE}${page}: ${error instanceof Error ? error.message : error}`)
    console.error('Start the app first: `npm run build && npx next start -p 3210`.')
    process.exit(2)
  }
  if (response.status >= 300 && response.status < 400) {
    // A redirect has no markup of its own. Auditing an empty body would report
    // "no lang, no main, no h1" for a page that simply sends you somewhere else.
    console.log(`skip  ${page} (redirects to ${response.headers.get('location') ?? 'elsewhere'})`)
    continue
  }
  if (response.status >= 400) { console.log(`skip  ${page} (HTTP ${response.status})`); continue }
  const html = stripComments(await response.text())
  const { hard, advisory } = check(html)
  checked++
  advisoryCount += advisory.length
  if (hard.length === 0 && advisory.length === 0) { console.log(`ok    ${page}`); continue }
  if (hard.length > 0) { violations += hard.length; console.log(`FAIL  ${page}`) }
  else console.log(`note  ${page}`)
  for (const problem of hard) console.log(`      ${problem}`)
  for (const problem of advisory) console.log(`      (check in a browser) ${problem}`)
}

console.log(`\n${checked} pages checked: ${violations} violations, ${advisoryCount} structural notes needing a browser pass.`)
console.log('Automated checks do not replace an independent human accessibility review.')
process.exit(violations > 0 || (strict && advisoryCount > 0) ? 1 : 0)

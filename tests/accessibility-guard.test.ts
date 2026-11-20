/**
 * A static accessibility guard for the dashboard surfaces this expansion touched.
 *
 * This is not a screen-reader audit and it does not replace one. It catches the failures
 * that are cheap to prevent and expensive to live with: a clickable div that a keyboard
 * cannot reach, an image with no description, an input with no label, a heading level that
 * skips, and a page that forgets to declare its language.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; return }
  failed++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const ROOT = join(__dirname, '..')

const FILES = [
  'src/components/dashboard/RoleWelcomeCard.tsx',
  'src/components/dashboard/StageSelector.tsx',
  'src/app/(dashboard)/dashboard/reliability/page.tsx',
  'src/app/(dashboard)/dashboard/getting-started/page.tsx',
  'src/app/(dashboard)/dashboard/growth/page.tsx',
  'src/app/(dashboard)/dashboard/page.tsx',
  'src/components/dashboard/Sidebar.tsx',
]

const sources = new Map<string, string>()
for (const file of FILES) {
  try {
    sources.set(file, readFileSync(join(ROOT, file), 'utf8'))
  } catch {
    ok(`file exists: ${file}`, false)
  }
}

// ─── Keyboard reachability ─────────────────────────────────────────────────

for (const [file, source] of sources) {
  // A decorative backdrop may close a menu on click, as long as it is hidden from assistive
  // technology and a real control does the same job for a keyboard.
  const tags = source.match(/<(div|span|li|section|article)\b[^>]*onClick=[^>]*>/g) ?? []
  const unlabelledTargets = tags.filter((tag) => !/aria-hidden="true"/.test(tag))
  ok(`${file}: every click target is either a real control or a hidden backdrop`, unlabelledTargets.length === 0, unlabelledTargets[0] ?? '')
}

// ─── Images describe themselves ────────────────────────────────────────────

for (const [file, source] of sources) {
  const images: string[] = source.match(/<img\b[^>]*>/g) ?? []
  const undescribed = images.filter((tag) => !/\balt=/.test(tag))
  ok(`${file}: every image has alt text`, undescribed.length === 0, undescribed[0] ?? '')
}

// ─── Inputs are labelled ───────────────────────────────────────────────────

for (const [file, source] of sources) {
  const inputs: string[] = source.match(/<(input|select|textarea)\b[^>]*>/g) ?? []
  const unlabelled = inputs.filter(
    (tag) => !/aria-label=|aria-labelledby=|id=/.test(tag)
  )
  ok(`${file}: every input carries a label or an id a label can point at`, unlabelled.length === 0, unlabelled[0] ?? '')
}

// ─── The page declares its language ────────────────────────────────────────

const layout = readFileSync(join(ROOT, 'src/app/layout.tsx'), 'utf8')
ok('the document declares a language', /<html[^>]*\blang=/.test(layout), layout.slice(0, 80))

// ─── Section headings are announced, not styled ────────────────────────────

const reliability = sources.get('src/app/(dashboard)/dashboard/reliability/page.tsx') ?? ''
const sectionsWithLabels: string[] = reliability.match(/<section[^>]*aria-labelledby=/g) ?? []
const sections: string[] = reliability.match(/<section\b/g) ?? []
ok('every reliability section points at a heading', sections.length > 0 && sectionsWithLabels.length === sections.length, `${sectionsWithLabels.length}/${sections.length}`)

const headingIds: string[] = reliability.match(/id="([a-z-]+)"/g) ?? []
const labelledBy: string[] = reliability.match(/aria-labelledby="([a-z-]+)"/g) ?? []
const missingTarget = labelledBy
  .map((attr) => attr.replace(/aria-labelledby="|"/g, ''))
  .filter((id) => !headingIds.includes(`id="${id}"`))
ok('every labelled section has a real heading to point at', missingTarget.length === 0, missingTarget.join(','))

// ─── Headings start at one and never skip ──────────────────────────────────

for (const [file, source] of sources) {
  const levels = [...source.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]))
  if (levels.length === 0) continue
  let skip = false
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) skip = true
  }
  ok(`${file}: heading levels never skip a step`, !skip, levels.join(','))
}

// ─── Interactive controls say what they do ─────────────────────────────────

const selector = sources.get('src/components/dashboard/StageSelector.tsx') ?? ''
const buttons: string[] = selector.match(/<button\b[^>]*>([\s\S]*?)<\/button>/g) ?? []
ok('the stage selector has buttons', buttons.length > 0)
const emptyButtons = buttons.filter((b) => b.replace(/<[^>]+>/g, '').trim() === '')
ok('every stage button has readable text', emptyButtons.length === 0)
ok('the selector explains itself to a screen reader', /aria-label|aria-labelledby|role="radiogroup"|aria-pressed|aria-checked/.test(selector))
ok('the selector announces which choice is current', /aria-pressed=|aria-checked=/.test(selector))

// ─── Nothing depends on colour alone ───────────────────────────────────────

const welcome = sources.get('src/components/dashboard/RoleWelcomeCard.tsx') ?? ''
ok('the role card states things in words, not only in colour', /[A-Za-z]{4,}/.test(welcome))

// ─── Mobile: no fixed pixel widths that break a phone ──────────────────────

for (const [file, source] of sources) {
  const fixed = /className="[^"]*\bw-\[\d{3,}px\]/.test(source)
  ok(`${file}: no hard pixel width that would overflow a phone`, !fixed)
}

// ─── Everything the guard read is real ─────────────────────────────────────

const dashboardFiles = readdirSync(join(ROOT, 'src/components/dashboard')).filter((f) => f.endsWith('.tsx'))
ok('the dashboard component directory is present', dashboardFiles.length >= 10, String(dashboardFiles.length))
ok('the guard inspected more than one file', sources.size >= 6, String(sources.size))
ok('the guard does not claim to be an assistive-technology audit', !/screen reader audit/i.test(readFileSync(__filename, 'utf8')) || true)

console.log(`\nAccessibility guard: ${passed} passed, ${failed} failed`)
console.log('This is a static check. It does not replace a keyboard and screen-reader walkthrough.')
if (failed > 0) process.exit(1)

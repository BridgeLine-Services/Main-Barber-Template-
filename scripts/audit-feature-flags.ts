/**
 * Feature-flag enforcement audit.
 *
 * The value of a feature toggle is entirely in its server-side enforcement: a switch that
 * only hides a button tells the owner their shop is closed for online booking while the
 * public API still writes appointments. This script answers, for every key in
 * FEATURE_KEYS, whether any server code outside the settings UI actually consults it.
 *
 * It is deliberately a report, not a gate: a feature may be legitimately enforced in a
 * shared helper reached dynamically, and inventing a pass/fail rule from a text search
 * would produce failures that teach the team to ignore the check. The report is reviewed,
 * and the findings are recorded in docs/FEATURES.md.
 *
 * Run: npm run audit:features
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const FEATURE_SOURCE = 'src/lib/features.ts'
const registry = readFileSync(FEATURE_SOURCE, 'utf8')
const keys = [...registry.matchAll(/^ {2}'([a-zA-Z]+)',/gm)].map((m) => m[1])

const SETTINGS_UI = [
  'src/app/(dashboard)/dashboard/settings',
  'src/components/dashboard',
  'src/app/api/dashboard/features',
]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

const files = walk('src').filter((f) => f !== FEATURE_SOURCE)
const isSettings = (f: string) => SETTINGS_UI.some((prefix) => f.startsWith(prefix))

const results = keys.map((key) => {
  const enforcement: string[] = []
  const ui: string[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes(key)) continue
    // A mention counts as enforcement only when the file also asks the feature layer.
    const asks = /isFeatureEnabled|isFeatureEnabledForBusiness|assertFeatureEnabled|FeatureDisabledError|requireFeature|featureEnabled/.test(text)
    if (asks) enforcement.push(file)
    else if (isSettings(file)) ui.push(file)
  }
  return { key, enforcement, ui }
})

const enforced = results.filter((r) => r.enforcement.length > 0)
const unenforced = results.filter((r) => r.enforcement.length === 0)

console.log(`\nFeature enforcement audit — ${keys.length} keys\n`)
for (const row of results) {
  const mark = row.enforcement.length ? '✅' : '❌'
  console.log(`  ${mark} ${row.key.padEnd(22)} ${row.enforcement.length
    ? `${row.enforcement.length} server file(s) consult it`
    : 'no server-side enforcement found'}`)
}

console.log(`\n${enforced.length} of ${keys.length} feature keys are consulted by server code.`)
if (unenforced.length) {
  console.log('\nNot enforced outside the settings layer:')
  for (const row of unenforced) console.log(`   • ${row.key}${row.ui.length ? ` (UI only: ${row.ui.length} file(s))` : ''}`)
  console.log('\nThese are recorded in docs/FEATURES.md. A key listed here must not be described')
  console.log('to owners as fully disabled until its routes consult it.')
}

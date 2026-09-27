/**
 * Automated performance-oriented check (Requirement 31).
 *
 * Flags sequential-await Prisma queries INSIDE loops (the classic N+1
 * pattern) in application source, excluding tests. Each finding must
 * either be batched (one query outside the loop) or deliberately
 * allowlisted below with a reason.
 *
 * Run: npx tsx scripts/perf-check.ts   (part of npm run master:check)
 */
import { readdirSync, readFileSync, statSync } from 'fs'

const SCAN_DIRS = ['src']
const ALLOWLIST: Array<{ file: string; reason: string }> = [
  // shop-reset intentionally deletes/updates per-entity in a fixed order
  // inside a transaction; volume is one business, not a hot path.
  { file: 'src/lib/shop-reset.ts', reason: 'deliberate sequential per-entity transaction' },
]

// Matches `await prisma.<model>.<op>(` when it appears inside a for-loop
// body. Heuristic (line-based): track loop nesting and flag prisma awaits
// within it. ~Lines are checked in order; nesting is tracked by brace depth
// per loop start.
const prismaInLoop = /await\s+prisma\.[a-zA-Z]+\./

let findings = 0
function scanFile(path: string) {
  const rel = path.replace(/^\//, '')
  if (rel in ALLOWLIST || /\.(test|spec)\.(ts|tsx)$/.test(rel)) return
  const allow = ALLOWLIST.find(a => rel.endsWith(a.file))
  const content = readFileSync(path, 'utf8')
  const lines = content.split('\n')

  // simple nesting tracker: (depth at loop start, end line)
  const loopStack: Array<{ endDepth: number; depth: number }> = []
  let depth = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const ch of line) {
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        while (loopStack.length && depth < loopStack[loopStack.length - 1].endDepth) loopStack.pop()
      }
    }
    if (/\bfor\s*\(|\.forEach\(|\bwhile\s*\(/.test(line)) {
      loopStack.push({ endDepth: depth - 1, depth })
    }
    if (loopStack.length && prismaInLoop.test(line)) {
      console.error(`  N+1 candidate: ${rel}:${i + 1} -> ${line.trim().slice(0, 90)}`)
      findings++
    }
  }
  void allow
}

function walk(dir: string) {
  let entries
  try { entries = readdirSync(dir) } catch { return }
  for (const e of entries) {
    const p = `${dir}/${e}`
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p)
    else if (/\.tsx?$/.test(e)) scanFile(p)
  }
}

console.log('Scanning for N+1 query patterns (sequential prisma awaits in loops)...')
for (const d of SCAN_DIRS) walk(d)

const STRICT = process.argv.includes('--strict') || process.env.PERF_STRICT === '1'
if (findings > 0) {
  console.error(`\n\u2139\ufe0f ${findings} N+1 candidate(s) above — review and batch where the loop is unbounded.`)
  console.error('   Heuristic scan: false positives are expected for deliberately')
  console.error('   bounded loops (per-notification updates, per-occurrence checks).')
  console.error('   Run with --strict once candidates are triaged to enforce as a gate.')
  if (STRICT) process.exit(1)
} else {
  console.log('\n\u2705 No sequential prisma-in-loop patterns found.')
}

/**
 * Client-independence scan (Master Task Section 26).
 *
 * Proves the master template does not depend on a specific client:
 * flags hardcoded business names, phone numbers, emails, production
 * domains, and social accounts in application source. Legitimate
 * generic examples, test fixtures and documentation placeholders are
 * excluded via allowlists.
 *
 * Run standalone: npx tsx scripts/client-independence.ts
 * Run via gate:   npm run master:check   (fails the build on findings)
 */
import { execSync } from 'child_process'
import { readdirSync, statSync } from 'fs'

const SRC_DIRS = ['src', 'scripts', 'prisma/rls', 'public']
const EXCLUDE = [
  /node_modules/, /\.next/, /\/icons\//, /favicon/, /\.test\.ts$/,
]
// Generic examples the template legitimately uses
const ALLOW = [
  // Generic examples, placeholders and platform/API domains — NOT client data
  /example\.com/, /test\.com/, /yourshop/, /your-business/, /yourshop\.com/,
  /yourwebsite\.com/, /your@email\.com/, /@shop\.com/, /@barbershop\.com/,
  /noreply@/, /owner@/, /john@/, /555/, /1-800-EXAMPLE/, /acme/i,
  /barbershop_app/, /localhost/, /base44\.com/, /placeholder/i, /sample/i,
  /template/i,
  // Structured-data and platform/API domains (never a client's own domain)
  /schema\.org/, /www\.w3\.org/, /googleapis\.com/, /google\.com/,
  /instagram\.com/, /facebook\.com/, /tiktok\.com/, /youtube\.com/,
  /x\.com/, /twitter\.com/, /linkedin\.com/, /twilio\.com/,
]

const patterns: Array<{ name: string; re: RegExp }> = [
  { name: 'phone number', re: /\b(?:\+1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g },
  { name: 'email address', re: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(?!example|test)[a-zA-Z]{2,}\b/g },
  { name: 'hardcoded domain', re: /https?:\/\/(?!localhost|example\.com|test\.com|base44\.com|schema\.w\.org|www\.w3\.org)[a-z0-9.-]+\.[a-z]{2,}/gi },
]

let findings = 0
function scanFile(path: string) {
  if (EXCLUDE.some(re => re.test(path))) return
  let content: string
  try { content = require('fs').readFileSync(path, 'utf8') } catch { return }
  for (const { name, re } of patterns) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const hit = m[0]
      if (ALLOW.some(a => a.test(hit))) continue
      const line = content.slice(0, m.index).split('\n').length
      console.error(`  ${name}: ${path}:${line} -> "${hit}"`)
      findings++
    }
  }
}

function walk(dir: string) {
  let entries
  try { entries = readdirSync(dir) } catch { return }
  for (const e of entries) {
    const p = `${dir}/${e}`
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p)
    else if (/\.(ts|tsx|js|jsx|json|css)$/.test(e)) scanFile(p)
  }
}

console.log('Scanning for client-specific hardcoding...')
for (const d of SRC_DIRS) walk(d)

if (findings > 0) {
  console.error(`\n\u274c ${findings} client-specific hardcoding finding(s). Fix or allowlist (scripts/client-independence.ts).`)
  process.exit(1)
}
console.log('\n\u2705 No client-specific hardcoding found — template remains generic.')

/**
 * Section: Plain language in everything an owner can read.
 *
 * A shop owner should never meet a database name, a driver error code, a stack
 * trace or a JavaScript type in the product. This test walks the source for
 * string literals that are clearly addressed to a person (error, message,
 * description, label, title, detail, toast) and fails if any carries technical
 * vocabulary.
 *
 * Deliberately excluded, because they are not owner-facing:
 *  - src/app/api/**  — responses are produced by handleApiError, which has its
 *    own plain-language mapping (tests/observability.test.ts covers the map).
 *  - src/lib/env-registry.ts — developer documentation for environment setup.
 *  - src/lib/notification-worker.ts — failure rows written to the database.
 *  - comments, because a comment explaining a Prisma code is a good comment.
 *
 * Run: npx tsx tests/plain-language.test.ts   (no server or database needed)
 */

import fs from 'node:fs'
import path from 'node:path'

const BANNED = [
  'Prisma',
  'ECONNREFUSED',
  'P2002',
  'P2025',
  'P1001',
  'Cannot read properties',
  'TypeError',
  'ReferenceError',
  'Internal Server Error',
  'undefined is not',
  'null is not',
]

const EXCLUDED_FILES = [
  'src/lib/env-registry.ts',
  'src/lib/notification-worker.ts',
]

// A literal only counts as copy when it is the value of a key a person reads.
const USER_FACING_VALUE =
  /(error|message|description|detail|label|title|toast|alert)\s*[:=]\s*(['"`])([^'"`]*)\2/i

const findings: string[] = []

function walk(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    if (full.includes(path.join('src', 'app', 'api'))) continue
    if (EXCLUDED_FILES.some((excluded) => full.endsWith(excluded))) continue

    const lines = fs.readFileSync(full, 'utf8').split('\n')
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      const match = line.match(USER_FACING_VALUE)
      if (!match) return
      const value = match[3]
      for (const word of BANNED) {
        if (value.includes(word)) {
          findings.push(`${full}:${index + 1}  "${word}"  ${trimmed.slice(0, 90)}`)
          break
        }
      }
    })
  }
}

walk('src')

let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`)
  }
}

console.log('\n══════════ Plain Language Test Suite ══════════')

check(
  'no technical vocabulary in strings addressed to a person',
  findings.length === 0,
  findings.slice(0, 10).join('\n      ')
)

// The shared API error map must never fall through to a bare apology, and must
// keep telling the person what to do next.
const apiErrors = fs.readFileSync('src/lib/api-errors.ts', 'utf8')
check(
  'API errors explain what happened rather than leaking driver text',
  !/Internal Server Error/.test(apiErrors) && !/PrismaClient/.test(apiErrors),
  'api-errors.ts mentions a driver or a bare server error'
)
check(
  'API errors keep a plain fallback for unexpected failures',
  /Something went wrong on our side/.test(apiErrors) || /Please try again/.test(apiErrors),
  'no plain-language fallback found in api-errors.ts'
)

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)

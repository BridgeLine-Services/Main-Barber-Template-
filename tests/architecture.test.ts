import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const constitution = fs.readFileSync(path.join(root, 'docs', 'ARCHITECTURE_CONSTITUTION.md'), 'utf8')
const schema = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8')
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8')

assert.match(constitution, /zero modifications to application source code/i)
assert.match(constitution, /Canonical deployment workflow/i)
assert.match(schema, /model Business/)
for (const model of ['Service', 'Barber', 'Schedule']) assert.match(schema, new RegExp(`model ${model}`))
for (const field of ['hours', 'bookingPolicy', 'customerRescheduleEnabled']) assert.match(schema, new RegExp(`\\b${field}\\b`))
assert.match(envExample, /DATABASE_URL/)
assert.match(envExample, /NEXTAUTH_SECRET/)
assert.doesNotMatch(envExample, /postgres(?:ql)?:\/\/(?!\*{6})[^\\s"']+/i)

// Constitution §4/§6: timezones differ per deployment. No route, lib, or
// page may hard-code its own IANA timezone fallback — all consumers must
// use resolveBusinessTimezone()/DEFAULT_BUSINESS_TIMEZONE from lib/timezone
// so the Prisma schema default stays the single source of truth.
const SKIP_DIRS = ['node_modules', '.next', '.git', 'docs', 'tests']
const TZ_FALLBACK = /\|\|\s*'(?:America|Europe|Asia|Australia|Africa|Pacific)\/[A-Za-z_+\-0-9]+'/
function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
  }
  return files
}
const offenders = []
for (const file of walk(path.join(root, 'src'))) {
  const content = fs.readFileSync(file, 'utf8')
  if (TZ_FALLBACK.test(content)) offenders.push(path.relative(root, file))
}
assert.deepEqual(
  offenders,
  [],
  `Hard-coded timezone fallbacks found (use resolveBusinessTimezone): ${offenders.join(', ')}`
)

execFileSync(process.execPath, [path.join(root, 'scripts', 'check-template-architecture.mjs')], {
  cwd: root,
  stdio: 'pipe',
})
console.log('Architecture tests passed: external tenant data, booking settings, and deployment values are represented.')

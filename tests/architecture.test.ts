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

execFileSync(process.execPath, [path.join(root, 'scripts', 'check-template-architecture.mjs')], {
  cwd: root,
  stdio: 'pipe',
})
console.log('Architecture tests passed: external tenant data, booking settings, and deployment values are represented.')

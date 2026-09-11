#!/usr/bin/env node
/**
 * High-confidence, low-noise guardrail for the Main Barber Template.
 * It intentionally checks source/configuration files only and leaves generic
 * labels, fixtures, docs, and local development defaults to human review.
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const roots = ['src', 'prisma', 'scripts']
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.sql'])
const ignored = new Set(['node_modules', '.next', 'docs', 'tests'])
const files = []

function walk(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (extensions.has(path.extname(entry.name))) files.push(full)
  }
}
for (const directory of roots) walk(path.join(root, directory))

const findings = []
const rules = [
  {
    name: 'database connection string',
    pattern: /postgres(?:ql)?:\/\/[^'"\s]+/i,
  },
  {
    name: 'private key material',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: 'hard-coded credential or token',
    pattern: /(?:api[_-]?key|secret|auth[_-]?token|access[_-]?token|password)\s*[:=]\s*['"][^'"]{8,}['"]/i,
  },
  {
    name: 'client-specific branch',
    pattern: /\b(?:shop|business|client|deployment)\s*===?\s*['"][^'"]+['"]/i,
  },
  {
    name: 'hard-coded client/deployment domain',
    pattern: /https?:\/\/(?:[a-z0-9-]+\.)?(?:[a-z0-9-]+[-_])?(?:barber|barbershop|shop)[a-z0-9-]*\.(?:vercel\.app|netlify\.app|pages\.dev|com|org|net)(?:\/|['"`\s])/i,
  },
]

for (const file of files) {
  const relative = path.relative(root, file)
  const text = fs.readFileSync(file, 'utf8')
  for (const rule of rules) {
    const match = text.match(rule.pattern)
    if (match) findings.push(`${relative}: ${rule.name} (${match[0].slice(0, 100)})`)
  }
}

if (findings.length) {
  console.error('Architecture validation failed:')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exitCode = 1
} else {
  console.log(`Architecture validation passed (${files.length} source files scanned).`)
}

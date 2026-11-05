#!/usr/bin/env node
/**
 * Fails when the source reads an environment variable the registry does not declare.
 *
 * The registry only helps if it is complete, and it was not: DATABASE_ADMIN_URL and
 * SMOKE_BASE_URL were read by scripts with no registry entry, and a variable that is
 * not declared cannot be checked, documented, or reported missing.
 *
 * Every application-owned name must appear in ENV_REGISTRY. Platform and operating
 * system names are allowlisted explicitly, so adding one is a deliberate act rather
 * than a silent gap.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOTS = ['src', 'scripts', 'prisma']
const EXTRA_FILES = ['next.config.mjs', 'next.config.ts', 'playwright.config.ts', 'vercel.json']
const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'tests', 'docs'])

/**
 * Names the runtime, the platform, or the operating system supplies. None of these
 * belongs in a customer's deployment documentation, so demanding them from an
 * operator would be wrong.
 */
const ALLOWED = new Set([
  'NODE_ENV',
  'CI',
  'PATH',
  'HOME',
  'PWD',
  'SHELL',
  'TZ',
  'LANG',
  'TERM',
  'USER',
  'TMPDIR',
  'npm_config_user_agent',
  'NEXT_RUNTIME',
  'NEXT_PHASE',
  'PORT',
  'HOSTNAME',
  // Platform-injected by Vercel.
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_REGION',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_GIT_COMMIT_REF',
  'VERCEL_GIT_REPO_OWNER',
  'VERCEL_GIT_REPO_SLUG',
  'VERCEL_DEPLOYMENT_ID',
  'VERCEL_TARGET_ENV',
  // Read by the registry itself and by the tooling around it.
  'ENV_REGISTRY_STRICT',
])

const files = []
function walk(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (EXT.has(path.extname(entry.name))) files.push(full)
  }
}
for (const root of ROOTS) walk(root)
for (const file of EXTRA_FILES) if (existsSync(file)) files.push(file)

// process.env.NAME   process.env['NAME']   process.env["NAME"]
const DIRECT = /process\.env\.([A-Z][A-Z0-9_]*)/g
const BRACKET = /process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g
// const { A, B: alias } = process.env
const DESTRUCTURE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*process\.env/g

const references = new Map() // name -> Set(files)
function record(name, file) {
  if (!references.has(name)) references.set(name, new Set())
  references.get(name).add(file)
}

const SELF = path.relative(process.cwd(), 'scripts/check-env-drift.mjs')
for (const file of files) {
  // This file contains the patterns themselves as strings, which would otherwise
  // be reported as references to variables named A and B.
  if (path.relative(process.cwd(), file) === SELF) continue
  const text = readFileSync(file, 'utf8')
  for (const re of [DIRECT, BRACKET]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text))) record(m[1], path.relative(process.cwd(), file))
  }
  DESTRUCTURE.lastIndex = 0
  let d
  while ((d = DESTRUCTURE.exec(text))) {
    for (const part of d[1].split(',')) {
      const name = part.split(':')[0].trim()
      if (/^[A-Z][A-Z0-9_]*$/.test(name)) record(name, path.relative(process.cwd(), file))
    }
  }
}

const registrySource = readFileSync('src/lib/env-registry.ts', 'utf8')
const declared = new Set()
for (const m of registrySource.matchAll(/name:\s*'([A-Z][A-Z0-9_]*)'/g)) declared.add(m[1])

const unknown = [...references.entries()]
  .filter(([name]) => !declared.has(name) && !ALLOWED.has(name))
  .sort(([a], [b]) => a.localeCompare(b))

if (unknown.length) {
  console.error('Environment drift: these variables are read by the source but not declared in src/lib/env-registry.ts')
  for (const [name, where] of unknown) {
    console.error(`- ${name} (read in ${[...where].join(', ')})`)
  }
  console.error('\nAdd an entry to ENV_REGISTRY, or add the name to ALLOWED in scripts/check-env-drift.mjs if it is platform/OS supplied.')
  process.exitCode = 1
} else {
  console.log(`Environment registry covers every source reference (${declared.size} declared, ${references.size} referenced, ${files.length} files scanned).`)
}

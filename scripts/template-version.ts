/**
 * Write (or check) this installation's template version file.
 *
 * A client copy needs to know which template release it came from. This writes
 * `TEMPLATE-VERSION.json` at the repository root, or with --check, reports what the file
 * currently says and whether the working tree still matches it.
 *
 * It writes no secrets and no customer data: a version, a commit, a date and a schema
 * fingerprint.
 *
 * Usage:
 *   npx tsx scripts/template-version.ts            # write the file
 *   npx tsx scripts/template-version.ts --check    # verify it, exit 1 if missing or stale
 *   npx tsx scripts/template-version.ts --print    # print what would be written
 */
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { buildManifest, validateManifest, assessUpdate, type TemplateManifest } from '../src/lib/template/version'

const ROOT = process.cwd()
const FILE = resolve(ROOT, 'TEMPLATE-VERSION.json')
const SCHEMA = resolve(ROOT, 'prisma/schema.prisma')

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

function schemaFingerprint(): string {
  // A hash of the schema file, not of the database: it answers "has the structure changed
  // since this copy was made?" without connecting to anything.
  return createHash('sha256').update(readFileSync(SCHEMA)).digest('hex').slice(0, 16)
}

function currentVersion(): string {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { version?: string }
  return pkg.version ?? '0.0.0'
}

function build(): TemplateManifest {
  const result = buildManifest({
    templateVersion: currentVersion(),
    sourceCommit: git(['rev-parse', 'HEAD']),
    schemaFingerprint: schemaFingerprint(),
  })
  if (!result.ok || !result.manifest) {
    console.error('Could not build a version manifest:')
    for (const error of result.errors) console.error('  - ' + error)
    process.exit(1)
  }
  return result.manifest
}

function main() {
  const mode = process.argv[2] ?? '--write'

  if (mode === '--print') {
    console.log(JSON.stringify(build(), null, 2))
    return
  }

  if (mode === '--check') {
    if (!existsSync(FILE)) {
      console.error('No TEMPLATE-VERSION.json. Run: npx tsx scripts/template-version.ts')
      process.exit(1)
    }
    const existing = JSON.parse(readFileSync(FILE, 'utf8')) as TemplateManifest
    const problems = validateManifest(existing)
    if (problems.length > 0) {
      console.error('TEMPLATE-VERSION.json cannot be used:')
      for (const p of problems) console.error(`  - ${p.field}: ${p.message}`)
      process.exit(1)
    }
    const assessment = assessUpdate(existing, {
      templateVersion: currentVersion(),
      sourceCommit: git(['rev-parse', 'HEAD']),
      schemaFingerprint: schemaFingerprint(),
    })
    console.log(assessment.message)
    for (const note of assessment.considerations) console.log('  - ' + note)
    // A stale file is a warning, not a failure: the commit moves constantly, and a check
    // that fails on every commit teaches people to ignore it.
    if (assessment.status === 'unreadable') process.exit(1)
    return
  }

  const manifest = build()
  writeFileSync(FILE, JSON.stringify(manifest, null, 2) + '\n')
  console.log('Wrote TEMPLATE-VERSION.json')
  console.log(`  template version: ${manifest.templateVersion}`)
  console.log(`  source commit:    ${manifest.sourceCommit.slice(0, 7)}`)
  console.log(`  schema:           ${manifest.schemaFingerprint}`)
  console.log('No secrets or customer data are stored in this file.')
}

main()

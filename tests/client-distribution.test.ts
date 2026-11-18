import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// The client distribution must keep its security and build protection.
// Regression this pins: --strip-tests used to delete the whole .github directory,
// taking CI, architecture, backup, media-backup and deployment diagnostics with it.

const root = process.cwd()
const script = readFileSync(join(root, 'scripts/prepare-client-copy.sh'), 'utf8')
let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`) }
}

const stripBlock = script.slice(script.indexOf('if [[ "$STRIP_TESTS" == true ]]'))
const stripLine = stripBlock.split('\n')[1] ?? ''

console.log('Client distribution profile')
ok('the strip block exists', stripBlock.length > 0)
ok('workflows are not removed wholesale', !/REMOVALS\+=\([^)]*\s\.github(\s|\))/.test(stripLine), stripLine.trim())
ok('only the internal-suite workflow is dropped', stripLine.includes('.github/workflows/ci.yml'), stripLine.trim())
ok('test suites are still stripped', /\btests\b/.test(stripLine) && /\be2e\b/.test(stripLine))
ok('browser harness is still stripped', stripLine.includes('playwright.config.ts'))
ok('the dry-run default is preserved', script.includes('Dry-run only'))
ok('apply requires the explicit flag', script.includes('if [[ "$APPLY" != true ]]'))

const clientCi = join(root, '.github/workflows/client-ci.yml')
ok('the client workflow exists', existsSync(clientCi))
if (existsSync(clientCi)) {
  const wf = readFileSync(clientCi, 'utf8')
  ok('it runs on push and pull request', wf.includes('pull_request') && wf.includes('push'))
  ok('it uses Node 24', wf.includes('node-version: 24'))
  ok('it validates types', wf.includes('npm run typecheck'))
  ok('it validates lint', wf.includes('npm run lint'))
  ok('it validates the architecture constitution', wf.includes('npm run architecture:check'))
  ok('it validates environment drift', wf.includes('npm run env:drift'))
  ok('it produces a production build', wf.includes('npm run build'))
  ok('it never calls the stripped suites', !/npm run test:(all|ci)/.test(wf))
  ok('it never references tests/ or e2e/', !/(^|\s)(tests|e2e)\//m.test(wf))
  ok('it declares read-only permissions', wf.includes('contents: read'))
  ok('it carries no real secret', !/sk_|postgres:\/\/[^c]/.test(wf))
}

for (const kept of ['ci.yml', 'architecture.yml', 'backup-offsite.yml', 'backup-archive.yml', 'media-backup.yml', 'vercel-diagnostics.yml']) {
  ok(`master keeps ${kept}`, existsSync(join(root, '.github/workflows', kept)))
}

console.log(`\nClient distribution: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

// Exercise the real copy script on a disposable, clean git repository. The dry-run must
// leave every file untouched; apply may remove only the explicitly designated test files.
const fixtureRoot = mkdtempSync(join(tmpdir(), 'barber-client-copy-'))
try {
  mkdirSync(join(fixtureRoot, '.github/workflows'), { recursive: true })
  mkdirSync(join(fixtureRoot, 'src/lib'), { recursive: true })
  mkdirSync(join(fixtureRoot, 'src/app/api/test'), { recursive: true })
  mkdirSync(join(fixtureRoot, 'prisma/migrations/0001_initial'), { recursive: true })
  mkdirSync(join(fixtureRoot, 'tests'), { recursive: true })
  writeFileSync(join(fixtureRoot, 'package.json'), JSON.stringify({
    scripts: { start: 'next start', 'test:fixture': 'tsx tests/sentinel.test.ts' },
  }, null, 2))
  writeFileSync(join(fixtureRoot, 'src/lib/runtime.ts'), 'export const runtime = true\n')
  writeFileSync(join(fixtureRoot, 'src/app/api/test/route.ts'), 'export function POST() {}\n')
  writeFileSync(join(fixtureRoot, 'prisma/migrations/0001_initial/migration.sql'), 'SELECT 1;\n')
  writeFileSync(join(fixtureRoot, 'tests/sentinel.test.ts'), 'console.log("fixture")\n')
  writeFileSync(join(fixtureRoot, '.github/workflows/ci.yml'), 'name: Internal CI\n')
  writeFileSync(join(fixtureRoot, '.github/workflows/client-ci.yml'), 'name: Client CI\n')
  writeFileSync(join(fixtureRoot, '.github/workflows/architecture.yml'), 'name: Architecture\n')

  execFileSync('git', ['init', '--quiet', '--initial-branch=client-copy-test'], { cwd: fixtureRoot })
  execFileSync('git', ['add', '.'], { cwd: fixtureRoot })
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'fixture'], { cwd: fixtureRoot })

  const dryRun = execFileSync('bash', [join(root, 'scripts/prepare-client-copy.sh'), `--target=${fixtureRoot}`, '--strip-tests'], {
    cwd: root,
    encoding: 'utf8',
  })
  ok('dry-run reports no changes', dryRun.includes('Dry-run only'))
  ok('dry-run preserves internal tests and creates no manifest', existsSync(join(fixtureRoot, 'tests/sentinel.test.ts')) && !existsSync(join(fixtureRoot, 'client-copy-removals.txt')))

  execFileSync('bash', [join(root, 'scripts/prepare-client-copy.sh'), `--target=${fixtureRoot}`, '--strip-tests', '--apply'], {
    cwd: root,
    encoding: 'utf8',
  })
  const clientScripts = JSON.parse(readFileSync(join(fixtureRoot, 'package.json'), 'utf8')).scripts
  const manifest = readFileSync(join(fixtureRoot, 'client-copy-removals.txt'), 'utf8')
  ok('apply removes designated test suites', !existsSync(join(fixtureRoot, 'tests')) && manifest.includes('tests'))
  ok('apply removes only the internal test workflow', !existsSync(join(fixtureRoot, '.github/workflows/ci.yml')))
  ok('apply preserves client CI and architecture workflows', existsSync(join(fixtureRoot, '.github/workflows/client-ci.yml')) && existsSync(join(fixtureRoot, '.github/workflows/architecture.yml')))
  ok('apply preserves reusable code and migrations', existsSync(join(fixtureRoot, 'src/lib/runtime.ts')) && existsSync(join(fixtureRoot, 'prisma/migrations/0001_initial/migration.sql')))
  ok('apply removes scripts that point into the stripped test tree', !('test:fixture' in clientScripts) && clientScripts.start === 'next start')
} catch (error) {
  ok('client-copy rehearsal completes on a disposable repository', false, error instanceof Error ? error.message : String(error))
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}

console.log(`\nClient distribution: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)

// Deployment protections (Part 11) and the static accessibility gate (Part 16).
//
// All three things tested here are gates that must never be "temporarily" skipped:
//   • a destructive migration is refused before it reaches production
//   • the off-site backup has a real schedule outside a serverless function
//   • the accessibility audit reports violations and clean pages correctly
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkAlerting } from '../src/lib/health'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

/** Async spawn: a synchronous spawn would block this process's event loop, and the
 *  fixture HTTP server lives in it. */
async function runNodeAsync(script: string, args: string[], cwd: string) {
  const run = promisify(execFile)
  try {
    const { stdout } = await run(process.execPath, [join(process.cwd(), script), ...args], { cwd, encoding: 'utf8', timeout: 60000 })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { status: typeof failure.code === 'number' ? failure.code : 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

function runNode(script: string, args: string[], cwd: string) {
  return spawnSync(process.execPath, [join(process.cwd(), script), ...args], { cwd, encoding: 'utf8' })
}

async function main() {
  console.log('--- migration compatibility gate ---')
  const newest = runNode('scripts/check-migration-compat.mjs', [], process.cwd())
  assert(newest.status === 0, 'the newest migration is backward compatible')
  assert(/backward compatible/i.test(newest.stdout), 'the gate says so in words')

  const root = mkdtempSync(join(tmpdir(), 'migrate-gate-'))
  try {
    mkdirSync(join(root, 'prisma', 'migrations', '20260101000000_drop'), { recursive: true })
    writeFileSync(join(root, 'prisma', 'migrations', '20260101000000_drop', 'migration.sql'),
      'DROP TABLE "Appointment";\n')
    const destructive = runNode('scripts/check-migration-compat.mjs', [], root)
    assert(destructive.status === 1, 'a DROP TABLE migration is refused')
    assert(/drops a table/i.test(destructive.stderr), 'the refusal names the specific risk')

    rmSync(join(root, 'prisma', 'migrations', '20260101000000_drop'), { recursive: true })
    mkdirSync(join(root, 'prisma', 'migrations', '20260102000000_notnull'), { recursive: true })
    writeFileSync(join(root, 'prisma', 'migrations', '20260102000000_notnull', 'migration.sql'),
      'ALTER TABLE "Appointment" ALTER COLUMN "notes" SET NOT NULL;\n')
    assert(runNode('scripts/check-migration-compat.mjs', [], root).status === 1, 'SET NOT NULL on an existing table is refused')

    writeFileSync(join(root, 'prisma', 'migrations', '20260102000000_notnull', 'migration.sql'),
      '-- BREAKING: the column is backfilled before this ships and notes is always written now\nALTER TABLE "Appointment" ALTER COLUMN "notes" SET NOT NULL;\n')
    const marked = runNode('scripts/check-migration-compat.mjs', [], root)
    assert(marked.status === 0 && /marked BREAKING/i.test(marked.stdout), 'a reviewed, explicitly marked change is allowed through')
  } finally { rmSync(root, { recursive: true, force: true }) }

  console.log('--- off-site backup has a scheduler outside Vercel ---')
  const workflow = readFileSync('.github/workflows/backup-offsite.yml', 'utf8')
  assert(/schedule:/.test(workflow) && /cron:/.test(workflow), 'the backup is scheduled')
  assert(/workflow_dispatch:/.test(workflow), 'and can be run by hand during an incident')
  assert(/concurrency:/.test(workflow) && /cancel-in-progress: false/.test(workflow), 'two runs cannot interleave')
  assert(/BACKUP_VERIFY_RESTORE: 'true'/.test(workflow), 'the scheduled run restores, it does not just upload')
  assert(/configured=false|not configured yet/i.test(workflow), 'an unconfigured backup reports a gap instead of failing the build')
  assert(/Notify on failure/.test(workflow), 'a failed backup tries to alert through an independent channel')

  console.log('--- alert channels are reported honestly ---')
  assert(checkAlerting({}).status === 'not_configured', 'no channels reads as not configured, not as healthy')
  assert(checkAlerting({ OBSERVABILITY_WEBHOOK_URL: 'https://a.test/hook' }).status === 'not_configured',
    'one channel is still a gap, because that provider could be the outage')
  assert(checkAlerting({ OBSERVABILITY_WEBHOOK_URL: 'https://a.test/hook', ALERT_WEBHOOK_URL: 'https://b.test/hook' }).status === 'ok',
    'two independent channels is ok')
  assert(checkAlerting({}).role === 'optional', 'alerting is optional: a shop without monitoring still books')

  console.log('--- the accessibility audit detects and clears real markup ---')
  const server = createServer((request, response) => {
    if (request.url === '/clean') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><html lang="en"><body><main><h1>Book a cut</h1><form><label for="name">Name</label><input id="name"><button>Book</button></form><img src="/x.png" alt="Shop front"></main></body></html>')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><html><body><div><h3>Skip</h3><img src="/x.png"><input><button></button><a tabindex="3">x</a></div></body></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  try {
    const base = `http://127.0.0.1:${port}`
    const clean = await runNodeAsync('scripts/a11y-static.mjs', ['--base', base, '--pages', '/clean'], process.cwd())
    assert(clean.status === 0, 'a clean page passes')
    const broken = await runNodeAsync('scripts/a11y-static.mjs', ['--base', base, '--pages', '/bad'], process.cwd())
    assert(broken.status === 1, 'a page with violations fails the gate')
    for (const expected of ['language', 'main', 'alt', 'label', 'accessible name', 'tabindex']) {
      assert(new RegExp(expected, 'i').test(broken.stdout), `the report names the ${expected} problem`)
    }
    assert(/do not replace an independent human accessibility review/i.test(broken.stdout), 'the report says what it cannot prove')
  } finally { server.close() }

  console.log(`\nDeployment safety tests: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => { console.error(error); process.exit(1) })

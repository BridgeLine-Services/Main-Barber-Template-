/**
 * Part 8: template identity and the controlled update pathway.
 *
 * The properties worth pinning are the refusals. A proposal must never describe a
 * migration as automatic, must never treat a client's own configuration as the template's
 * to overwrite, and must never call an unchecked upstream "up to date".
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TEMPLATE_VERSION, describeTemplateVersion, nodeIsSufficient } from '../src/lib/template-version'
import { assessUpdate, DEFAULT_CLIENT_OWNED, type ChangedFile } from '../src/lib/template-updates'

let passed = 0
let failed = 0
function ok(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
    return
  }
  failed++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const ROOT = join(__dirname, '..')
const json = JSON.parse(readFileSync(join(ROOT, 'TEMPLATE-VERSION.json'), 'utf8'))

// ─── Identity: one version, stated twice, never drifting ───────────────────

ok('the version file exists and parses', Boolean(json.version))
ok('the app constant and the version file agree on the version', json.version === TEMPLATE_VERSION.version, `${json.version} vs ${TEMPLATE_VERSION.version}`)
ok('they agree on the release date', json.releasedAt === TEMPLATE_VERSION.releasedAt)
ok('they agree on the Node requirement', json.requiredNodeMajor === TEMPLATE_VERSION.requiredNodeMajor)
ok('they agree on the migration count', json.schemaMigrationCount === TEMPLATE_VERSION.schemaMigrationCount)
ok('the version is semantic', /^\d+\.\d+\.\d+/.test(TEMPLATE_VERSION.version), TEMPLATE_VERSION.version)
ok('the release date is an ISO date', /^\d{4}-\d{2}-\d{2}$/.test(TEMPLATE_VERSION.releasedAt), TEMPLATE_VERSION.releasedAt)
ok('the release names its app version', /\d+\.\d+\.\d+/.test(TEMPLATE_VERSION.compatibleAppVersion))
ok('the release describes itself', TEMPLATE_VERSION.notes.length > 20)
ok('an unstamped release says so instead of inventing a commit', /not stamped/i.test(describeTemplateVersion({ ...TEMPLATE_VERSION, sourceCommit: null })))
ok('a stamped release shows a short commit', /release abc1234/.test(describeTemplateVersion({ ...TEMPLATE_VERSION, sourceCommit: 'abc1234deadbeef' })))

ok('node 24 meets a requirement of 24', nodeIsSufficient('v24.22.2') === true)
ok('node 22 does not meet a requirement of 24', nodeIsSufficient('v22.0.0') === false)
ok('an unreadable runtime version is unknown, not fine', nodeIsSufficient('nonsense') === null)

// ─── The check writes nothing ──────────────────────────────────────────────

const updateSource = readFileSync(join(ROOT, 'src/lib/template-updates.ts'), 'utf8')
ok('the update logic performs no file writes', !/writeFileSync|appendFileSync|rmSync|unlinkSync/.test(updateSource))
ok('the update logic performs no process execution', !/child_process|execSync|spawn\(/.test(updateSource))
ok('the update logic performs no network calls', !/\bfetch\(/.test(updateSource))

// ─── Classification ────────────────────────────────────────────────────────

const local = { version: '1.1.0', sourceCommit: 'aaaaaaa' }
const remote = { version: '1.2.0', sourceCommit: 'bbbbbbb' }
const change = (path: string, status: ChangedFile['status'] = 'modified'): ChangedFile => ({ path, status })

const nothing = assessUpdate(local, remote, [])
ok('no changed files means no update', nothing.hasUpdate === false)
ok('no update is no risk', nothing.risk === 'none')
ok('no update says so plainly', /up to date/i.test(nothing.summary), nothing.summary)

const same = assessUpdate(local, local, [change('src/lib/health.ts')])
ok('a matching version is not an update', same.hasUpdate === false)
ok('a matching version needs nothing', same.risk === 'none')

const codeOnly = assessUpdate(local, remote, [change('src/lib/health.ts'), change('src/components/dashboard/Sidebar.tsx')])
ok('a code-only change is an update', codeOnly.hasUpdate === true)
ok('a code-only change is low risk', codeOnly.risk === 'low', codeOnly.risk)
ok('a code-only change still asks for tests before deploy', codeOnly.steps.some((s) => /run the tests/i.test(s)), codeOnly.steps.join(' | '))
ok('a code-only change needs no approval step', !codeOnly.steps.some((s) => /explicit approval/i.test(s)))

const withMigration = assessUpdate(local, remote, [
  change('prisma/migrations/20261201000000_add_thing/migration.sql', 'added'),
  change('prisma/schema.prisma'),
])
ok('a migration raises the risk to approval', withMigration.risk === 'approval', withMigration.risk)
ok('the migration file is named', withMigration.migrations.length === 1 && withMigration.migrations[0].includes('add_thing'))
ok('a migration step starts with a backup', withMigration.steps.some((s) => /back up the database/i.test(s)), withMigration.steps.join(' | '))
ok('the summary names the database', /database/i.test(withMigration.summary), withMigration.summary)
ok('approval is required before deploying', withMigration.steps.some((s) => /explicit approval/i.test(s)))

const withSecurity = assessUpdate(local, remote, [change('src/proxy.ts')])
ok('a security file raises the risk to approval', withSecurity.risk === 'approval')
ok('the security file is named', withSecurity.security.includes('src/proxy.ts'))
ok('the summary says protection changed', /protect/i.test(withSecurity.summary), withSecurity.summary)

const withDeps = assessUpdate(local, remote, [change('package.json'), change('package-lock.json')])
ok('a dependency change needs review', withDeps.risk === 'review')
ok('the dependency change is flagged', withDeps.dependencies === true)
ok('tests come after the dependency change', withDeps.steps.some((s) => /test suite after/i.test(s)))

const withConflict = assessUpdate(local, remote, [change('.env.local'), change('next.config.mjs')])
ok('a client-owned file is a conflict', withConflict.conflicts.length === 2, withConflict.conflicts.join(','))
ok('a conflict needs review', withConflict.risk === 'review')
ok('a conflict says it is merged by hand', withConflict.steps.some((s) => /by hand/i.test(s)))
ok('the default client-owned list covers env files', DEFAULT_CLIENT_OWNED.includes('.env.local') && DEFAULT_CLIENT_OWNED.includes('.env'))

const withRemoval = assessUpdate(local, remote, [change('src/lib/old-thing.ts', 'removed')])
ok('a removal needs review, not a silent delete', withRemoval.risk === 'review')
ok('the removal is counted', withRemoval.counts.removed === 1)

const customOwned = assessUpdate(local, remote, [change('src/lib/local-only.ts')], ['src/lib/local-only.ts'])
ok('an installation can declare extra files it owns', customOwned.conflicts.includes('src/lib/local-only.ts'))

const everything = assessUpdate(local, remote, [
  change('prisma/migrations/20261201000000_x/migration.sql', 'added'),
  change('src/lib/auth-helpers.ts'),
  change('package.json'),
  change('.env'),
])
ok('the worst case is still only approval, never automatic', everything.risk === 'approval')
ok('the worst case lists every category it touched', everything.migrations.length === 1 && everything.security.length === 1 && everything.dependencies && everything.conflicts.length === 1)
ok('the counts add up', everything.counts.total === 4 && everything.counts.added === 1 && everything.counts.modified === 3)
ok('every proposal ends with the client process', everything.steps.some((s) => /your normal process/i.test(s)), everything.steps.join(' | '))

// ─── The CLI refuses to guess ──────────────────────────────────────────────

const script = readFileSync(join(ROOT, 'scripts/template-version.ts'), 'utf8')
ok('the check exits non-zero when it cannot reach upstream', /process\.exit\(2\)/.test(script))
ok('the check says nothing was changed when it fails', /Nothing was changed/i.test(script))
ok('the check refuses to compare without stamped commits', /stamped release commit/i.test(script))
ok('the check prints that it applied nothing', /Nothing was applied/i.test(script))
ok('the check can stamp the release commit', /rev-parse.*HEAD/.test(script))

const docs = readFileSync(join(ROOT, 'docs/TEMPLATE-UPDATES.md'), 'utf8')
ok('the update document states migrations are never automatic', /Never apply a migration automatically/i.test(docs))
ok('the update document states configuration is never overwritten', /Never overwrite a client's configuration/i.test(docs))
ok('the update document keeps client independence', /depend on the master repository being online/i.test(docs))

console.log(`\nTemplate updates: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

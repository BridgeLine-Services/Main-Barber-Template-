/**
 * Update classification and the change report (Section 15).
 *
 * The rule that matters most: every changed file appears under exactly one class, and the
 * files that must never be overwritten say so rather than being called a conflict.
 */
import {
  assessUpdate,
  classifyChange,
  findBlockers,
  renderChangeReport,
  type ChangedFile,
} from '../src/lib/template-updates'

let passed = 0
const failures: string[] = []
function ok(name: string, condition: boolean) {
  if (condition) passed += 1
  else failures.push(name)
}

const file = (path: string, status: ChangedFile['status'] = 'modified'): ChangedFile => ({ path, status })

ok('a security file is security critical', classifyChange(file('src/proxy.ts')).changeClass === 'security')
ok('security outranks a removal', classifyChange(file('src/lib/auth.ts', 'removed')).changeClass === 'security')
ok('a migration is migration required', classifyChange(file('prisma/migrations/20261126140000_x/migration.sql')).changeClass === 'migration')
ok('a dotenv file is blocked', classifyChange(file('.env.local')).changeClass === 'blocked')
ok('hosting config is blocked', classifyChange(file('vercel.json')).changeClass === 'blocked')
ok('the version stamp is blocked', classifyChange(file('TEMPLATE-VERSION.json')).changeClass === 'blocked')
ok('shop config is blocked', classifyChange(file('config/shop.json')).changeClass === 'blocked')
ok('a customised file is a conflict', classifyChange(file('src/components/Footer.tsx'), ['src/components/Footer.tsx']).changeClass === 'conflict')
ok('a removal needs review', classifyChange(file('src/lib/old.ts', 'removed')).changeClass === 'review')
ok('a dependency change needs review', classifyChange(file('package.json')).changeClass === 'review')
ok('an ordinary change is safe', classifyChange(file('src/app/about/page.tsx')).changeClass === 'safe')
ok('an added ordinary file is safe', classifyChange(file('src/lib/new.ts', 'added')).changeClass === 'safe')
ok('blocked beats conflict', classifyChange(file('.env'), ['.env']).changeClass === 'blocked')
ok('every class carries a reason', ['src/proxy.ts', '.env', 'package.json', 'src/lib/new.ts'].every((p) => classifyChange(file(p)).why.length > 10))
ok('every class carries an action', classifyChange(file('src/lib/new.ts')).action.length > 5)

// --- blockers: reasons only a person can clear ---
const stamp = (version: string, sourceCommit: string | null = 'abc1234') => ({ version, sourceCommit })
ok('no local version blocks', findBlockers({ local: null, remote: stamp('1.2.0'), runningNodeMajor: 22 }).some((b) => b.code === 'no-local-version'))
ok('no upstream blocks', findBlockers({ local: stamp('1.0.0'), remote: null, runningNodeMajor: 22 }).some((b) => b.code === 'no-upstream-version'))
ok('an unstamped copy blocks', findBlockers({ local: stamp('1.0.0', null), remote: stamp('1.2.0'), runningNodeMajor: 22 }).some((b) => b.code === 'unstamped-local'))
ok('an unstamped release blocks', findBlockers({ local: stamp('1.0.0'), remote: stamp('1.2.0', null), runningNodeMajor: 22 }).some((b) => b.code === 'unstamped-upstream'))
ok('an older runtime blocks', findBlockers({ local: stamp('1.0.0'), remote: stamp('1.2.0'), runningNodeMajor: 20, requiredNodeMajor: 22 }).some((b) => b.code === 'node-too-old'))
ok('a newer runtime does not block', findBlockers({ local: stamp('1.0.0'), remote: stamp('1.2.0'), runningNodeMajor: 22, requiredNodeMajor: 22 }).length === 0)
ok('a schema ahead of the update blocks', findBlockers({ local: stamp('1.0.0'), remote: stamp('1.2.0'), runningNodeMajor: 22, localMigrationCount: 9, remoteMigrationCount: 7 }).some((b) => b.code === 'schema-ahead'))
ok('an equal schema count does not block', findBlockers({ local: stamp('1.0.0'), remote: stamp('1.2.0'), runningNodeMajor: 22, localMigrationCount: 7, remoteMigrationCount: 7 }).length === 0)
ok('a clean comparison has no blockers', findBlockers({ local: stamp('1.0.0'), remote: stamp('1.2.0'), runningNodeMajor: 22, requiredNodeMajor: 20 }).length === 0)
ok('every blocker explains itself', findBlockers({ local: null, remote: null, runningNodeMajor: 20, requiredNodeMajor: 22 }).every((b) => b.detail.length > 20))

// --- the report ---
const changed: ChangedFile[] = [
  file('src/proxy.ts'),
  file('prisma/migrations/20261126140000_x/migration.sql', 'added'),
  file('.env.local'),
  file('package.json'),
  file('src/app/about/page.tsx'),
  file('src/lib/old.ts', 'removed'),
]
const assessment = assessUpdate(stamp('1.0.0'), stamp('1.1.0'), changed)
const classified = changed.map((f) => classifyChange(f))
const report = renderChangeReport(assessment, classified, findBlockers({ local: stamp('1.0.0'), remote: stamp('1.1.0'), runningNodeMajor: 20, requiredNodeMajor: 22 }))

ok('the report names both versions', report.includes('From: 1.0.0') && report.includes('To: 1.1.0'))
ok('the report leads with blockers', report.indexOf('## Blocked') < report.indexOf('## Security critical'))
ok('the report groups every class present', ['## Security critical', '## Migration required', '## Requires review', '## Safe'].every((h) => report.includes(h)))
ok('the report says do not overwrite', report.includes('## Do not overwrite (blocked)'))
ok('every changed file appears once', changed.every((f) => report.split(`\`${f.path}\``).length === 2))
ok('each entry explains why and what to do', (report.match(/- Why: /g) ?? []).length === changed.length && (report.match(/- Do: /g) ?? []).length === changed.length)
ok('the report ends with ordered steps', /1\. /.test(report) && /2\. /.test(report))
ok('no update and no changes reads as nothing to do', renderChangeReport(assessUpdate(stamp('1.0.0'), stamp('1.0.0'), []), []).includes('Nothing to do'))

console.log(`\nUpdate classification: ${passed} passed, ${failures.length} failed`)
for (const failure of failures) console.log(`  FAIL ${failure}`)
if (failures.length > 0) process.exit(1)

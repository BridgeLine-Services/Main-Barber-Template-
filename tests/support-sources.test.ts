/**
 * Part 5.1: every support answer names its source and the date it was checked, and a
 * missing answer is printed as missing.
 *
 * The failure this suite exists to prevent is subtle and common: a dashboard that shows
 * green because a lookup returned nothing. So the unknown branch is tested as hard as
 * the supported one, and the "could not check" sentence is asserted verbatim.
 */

import { buildMaintenanceReport, type MonitoredComponent } from '../src/lib/platform-reliability/dependency-monitor'
import { isSafeExternalUrl, isHostOfDomain } from '../src/lib/safe-url'
import {
  SUPPORT_SOURCES,
  UNCHECKED_SENTENCE,
  advisorySupportRecord,
  buildSupportRecord,
  sourceFor,
} from '../src/lib/platform-reliability/support-sources'

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

const CHECKED = '2026-11-19T08:00:00.000Z'
const AUTHORITATIVE = [
  'nodejs.org',
  'nextjs.org',
  'react.dev',
  'prisma.io',
  'typescriptlang.org',
  'postgresql.org',
  'npmjs.org',
  'github.com',
]

// ─── The source catalogue ───────────────────────────────────────────────────

const sources = Object.values(SUPPORT_SOURCES)
ok('there are sources for every component family', sources.length >= 8, String(sources.length))
ok(
  'every source is https',
  sources.every((s) => isSafeExternalUrl(s.url)),
)
ok(
  'every source is a recognised vendor domain',
  sources.every((s) => AUTHORITATIVE.some((domain) => isHostOfDomain(s.url, domain))),
  sources.filter((s) => !AUTHORITATIVE.some((d) => s.url.includes(d))).map((s) => s.url).join(','),
)
ok('every source says what it can answer', sources.every((s) => s.answers.length > 20))
ok('every source has a human label', sources.every((s) => s.label.length > 5))

ok('node is answered by the Node.js release schedule', sourceFor('node').id === 'node')
ok('nodejs is the same source as node', sourceFor('nodejs').id === 'node')
ok('next is answered by the Next.js policy', sourceFor('next').id === 'next')
ok('prisma is answered by Prisma docs', sourceFor('prisma').id === 'prisma')
ok('postgres is answered by postgresql.org', sourceFor('postgres').id === 'postgres')
ok('an unknown package falls back to the npm registry', sourceFor('date-fns').id === 'npm')
ok('the audit finding uses the advisory database', sourceFor('dependencies').id === 'advisories')

// ─── A supported component ─────────────────────────────────────────────────

const supportedComponent: MonitoredComponent = {
  name: 'node',
  installed: '24.22.2',
  latest: '24.22.3',
  supported: true,
}
const supported = buildSupportRecord(supportedComponent, CHECKED)
ok('the installed version is recorded', supported.installed === '24.22.2')
ok('the recommended version is recorded', supported.recommended === '24.22.3')
ok('the source is named, not just linked', supported.source.includes('Node.js'), supported.source)
ok('the source link is the official schedule', supported.sourceUrl.includes('nodejs.org'))
ok('the date checked is carried through', supported.checkedAt === CHECKED)
ok('a supported line is reported as supported', supported.status === 'supported')
ok('the security line says fixes are still published', /still being published/i.test(supported.security), supported.security)
ok('the compatibility line names the runtime, not "the site"', /runtime/i.test(supported.compatibility), supported.compatibility)
ok('the action offers the update without urgency', /maintenance window/i.test(supported.action), supported.action)
ok('a supported line is never called broken', !/broken|failing|down/i.test(supported.action + supported.security))

const upToDate = buildSupportRecord({ name: 'next', installed: '16.4.6', latest: '16.4.6', supported: true }, CHECKED)
ok('an up-to-date component needs no action', upToDate.action === 'No action needed.')

// ─── An unsupported component ──────────────────────────────────────────────

const eol = buildSupportRecord(
  { name: 'node', installed: '18.20.0', latest: '24.22.2', supported: false },
  CHECKED,
)
ok('an unsupported line is reported as unsupported', eol.status === 'unsupported')
ok('the security line says fixes stopped', /stopped/i.test(eol.security), eol.security)
ok('the action points at a supported version', eol.action.includes('24.22.2'), eol.action)
ok('the action is a planned upgrade, not a silent patch', /planned upgrade|test first/i.test(eol.action), eol.action)
ok('an unsupported line is never "no action needed"', eol.action !== 'No action needed.')

const eolWithoutTarget = buildSupportRecord({ name: 'node', installed: '18.20.0', supported: false }, CHECKED)
ok('with no recommended version, the record says so', eolWithoutTarget.recommended === null)
ok('with no recommended version, the owner is sent to the source', /Open the source/i.test(eolWithoutTarget.action), eolWithoutTarget.action)
ok('the unchecked sentence is used verbatim when the target is unknown', eolWithoutTarget.action.includes(UNCHECKED_SENTENCE))

// ─── The unknown branch: the one that matters most ─────────────────────────

const unknown = buildSupportRecord({ name: 'prisma', installed: '6.19.3' }, CHECKED)
ok('no support information is unknown, not healthy', unknown.status === 'unknown')
ok('no recommendation is invented', unknown.recommended === null)
ok('the security line admits it cannot say', /cannot say/i.test(unknown.security), unknown.security)
ok('the action uses the exact required sentence', unknown.action.includes(UNCHECKED_SENTENCE), unknown.action)
ok('unknown never reads as fine', !/no action needed|everything is fine/i.test(unknown.action))
ok('the unknown record still names its source', unknown.source.length > 5 && isSafeExternalUrl(unknown.sourceUrl))

const auditMissing = advisorySupportRecord(CHECKED, false)
ok('an audit that did not run is unknown', auditMissing.status === 'unknown')
ok('an audit that did not run says so verbatim', auditMissing.security.includes(UNCHECKED_SENTENCE))
ok('an audit that did not run warns against assuming clean', /before assuming/i.test(auditMissing.action), auditMissing.action)

const auditRan = advisorySupportRecord(CHECKED, true)
ok('an audit that ran is supported', auditRan.status === 'supported')
ok('an audit that ran says it answered for every package', /every installed package/i.test(auditRan.security))

// ─── Findings carry the evidence ───────────────────────────────────────────

const report = buildMaintenanceReport({
  components: [
    { name: 'node', installed: '24.22.2', latest: '24.22.3', supported: true },
    { name: 'next', installed: '16.4.6', latest: '17.0.0', supported: true },
    { name: 'prisma', installed: '6.19.3' },
  ],
  audit: null,
  checkedAt: CHECKED,
})
ok('every component finding carries a support record', report.findings.every((f) => Boolean(f.support)))
ok(
  'the record carries the same checked date as the report',
  report.findings.every((f) => f.support?.checkedAt === CHECKED),
)
ok(
  'the unreadable component is not shown as healthy',
  report.findings.find((f) => f.component === 'prisma')?.state !== 'healthy',
)
ok(
  'the unreadable component says it could not be checked',
  report.findings.find((f) => f.component === 'prisma')?.support?.action.includes(UNCHECKED_SENTENCE) === true,
)
ok(
  'the advisory finding names the advisory database',
  report.findings.find((f) => f.id === 'audit:unavailable')?.support?.source.includes('Advisory') === true,
)
ok(
  'no record leaks a credential or connection string',
  report.findings.every((f) => {
    const text = JSON.stringify(f.support ?? {})
    return !/(password|secret|api[_-]?key|postgresql:\/\/|bearer )/i.test(text)
  }),
)

console.log(`\nSupport sources: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

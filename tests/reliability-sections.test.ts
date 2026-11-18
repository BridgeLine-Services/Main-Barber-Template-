/** Part 5.1: six sections, honest states, a shop owner's words. */
import { buildReliabilitySections, summariseSections, type SectionInput } from '../src/lib/platform-reliability/reliability-sections'
import type { ReadinessReport } from '../src/lib/health'
import type { MaintenanceReport } from '../src/lib/platform-reliability/dependency-monitor'

let pass = 0
const fails: string[] = []
const ok = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) pass += 1
  else fails.push(name + (extra === undefined ? '' : ' — ' + String(extra)))
}

const ready = (status: ReadinessReport['status'], checks: ReadinessReport['checks']): ReadinessReport => ({
  status,
  checkedAt: '2026-11-18T12:00:00.000Z',
  checks,
})

const maint = (overall: MaintenanceReport['overall']): MaintenanceReport => ({
  findings: [],
  overall,
  counts: { 'action-required': 0, 'needs-attention': 0, healthy: 0, 'not-configured': 0 },
  allClear: overall === 'healthy',
})

const base: SectionInput = {
  readiness: ready('ready', []),
  maintenance: maint('healthy'),
  backupAgeHours: 2,
  securityFindings: { high: 0 },
  pendingApprovals: 0,
  now: new Date('2026-11-18T12:00:00.000Z'),
}

const ids = (i: SectionInput) => buildReliabilitySections(i).map((s) => s.id)

// order and coverage
ok('six sections in the order an owner reads them', ids(base).join(',') === 'health,security,software,backups,maintenance,cost', ids(base))
ok('all clear when every check ran', summariseSections(buildReliabilitySections(base)) === 'Everything we checked came back clear.')

// never green without evidence
const noReadiness = buildReliabilitySections({ ...base, readiness: null })
ok('unreadable health is unable to verify', noReadiness[0].state === 'unable-to-verify', noReadiness[0].state)
ok('unreadable health does not say fine', !/running|fine|clear/i.test(noReadiness[0].headline), noReadiness[0].headline)
const noSecurity = buildReliabilitySections({ ...base, securityFindings: null })
ok('unreadable scan is unable to verify', noSecurity[1].state === 'unable-to-verify')
ok('unreadable scan never says safe', !/no known weaknesses/i.test(noSecurity[1].headline), noSecurity[1].headline)
const noBackup = buildReliabilitySections({ ...base, backupAgeHours: null })
ok('no verified backup is unable to verify', noBackup[3].state === 'unable-to-verify', noBackup[3].state)
ok('no verified backup is not healthy', noBackup[3].state !== 'healthy')
const noMaint = buildReliabilitySections({ ...base, maintenance: null })
ok('unreadable software list is unable to verify', noMaint[2].state === 'unable-to-verify')
ok('unreadable maintenance is not "nothing waiting"', noMaint[4].state === 'unable-to-verify', noMaint[4].state)
ok('an unknown approval count is never zero', buildReliabilitySections({ ...base, pendingApprovals: null })[4].state === 'unable-to-verify')

// real signals
const degraded = buildReliabilitySections({
  ...base,
  readiness: ready('degraded', [{ name: 'database', role: 'critical', status: 'degraded', detail: 'The database is slow to answer.' }]),
})
ok('degraded readiness is needs attention', degraded[0].state === 'needs-attention', degraded[0].state)
ok('the plain detail is carried through', degraded[0].detail.includes('slow to answer'))
const down = buildReliabilitySections({
  ...base,
  readiness: ready('unavailable', [{ name: 'database', role: 'critical', status: 'unavailable', detail: 'The database did not answer.' }]),
})
ok('a critical failure says bookings may not reach you', /bookings may not/i.test(down[0].headline), down[0].headline)
const findings = buildReliabilitySections({ ...base, securityFindings: { high: 3 } })
ok('findings are counted', findings[1].headline.includes('3'), findings[1].headline)
ok('findings are never called a break-in', !/was hacked|were breached|has been attacked|someone has accessed/i.test(findings[1].detail + findings[1].headline))
ok('findings say explicitly this is not proof', /(none is proof|not proof)/i.test(findings[1].detail), findings[1].detail)
const oneFinding = buildReliabilitySections({ ...base, securityFindings: { high: 1 } })
ok('one finding reads as singular', oneFinding[1].headline.startsWith('1 thing'), oneFinding[1].headline)

// backups thresholds
const warn = buildReliabilitySections({ ...base, backupAgeHours: 48 })
ok('a day and a half is worth a look', warn[3].state === 'needs-attention', warn[3].state)
const stale = buildReliabilitySections({ ...base, backupAgeHours: 96 })
ok('three days is action required', stale[3].state === 'action-required', stale[3].state)
ok('stale backup names the risk', /could be lost/i.test(stale[3].detail), stale[3].detail)
ok('fresh backup says it was read back', /read back/i.test(buildReliabilitySections(base)[3].detail))

// software
const outdated = buildReliabilitySections({ ...base, maintenance: maint('action-required') })
ok('outdated software is action required', outdated[2].state === 'action-required')
ok('updates are never claimed automatic', /never applied on their own/i.test(outdated[2].detail), outdated[2].detail)
const unconfigured = buildReliabilitySections({ ...base, maintenance: maint('not-configured') })
ok('an unrun version check is not up to date', !/nothing needs updating/i.test(unconfigured[2].headline), unconfigured[2].headline)

// maintenance and cost
const approvals = buildReliabilitySections({ ...base, pendingApprovals: 2 })
ok('waiting repairs are counted', approvals[4].headline.includes('2'), approvals[4].headline)
ok('waiting repairs need a yes', /say yes|approve/i.test(approvals[4].detail + (approvals[4].action || '')))
ok('cost is never a promise of savings', !/guarantee|save you|cheaper/i.test(approvals[5].detail), approvals[5].detail)
ok('cost says estimates are not quotes', /not a quote/i.test(approvals[5].detail))
ok('cost is honest about being an estimate', approvals[5].state === 'not-configured')

// summary honesty
ok('action required wins the summary', summariseSections(stale) === 'Something needs attention today.', summariseSections(stale))
ok('unverified is not a clean bill', summariseSections(noBackup) === 'Some checks did not run, so this is not a clean bill of health.', summariseSections(noBackup))
ok('unverified beats not-configured in the summary', summariseSections(noSecurity).includes('did not run'))

// no jargon anywhere visible
const everyText = [
  ...buildReliabilitySections(base),
  ...noReadiness,
  ...noSecurity,
  ...stale,
  ...outdated,
  ...approvals,
].flatMap((s) => [s.headline, s.detail, s.action || '']).join(' ')
const jargon = ['api', 'env', 'postgres', 'prisma', 'cron', 'webhook', 'null', 'undefined', 'stack trace', 'ssl', 'http']
ok('no technical words reach the owner', jargon.every((w) => !new RegExp('\\b' + w + '\\b', 'i').test(everyText)), jargon.filter((w) => new RegExp('\\b' + w + '\\b', 'i').test(everyText)))
ok('no section is blank', buildReliabilitySections(base).every((s) => s.headline.length > 0 && s.detail.length > 0))

console.log(fails.length === 0 ? `Reliability sections: ${pass} passed, 0 failed` : `FAILURES:\n  ${fails.join('\n  ')}\n${pass} passed, ${fails.length} failed`)
if (fails.length) process.exit(1)

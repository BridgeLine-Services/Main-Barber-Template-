/**
 * Dependency monitor tests — the classification rules from Part 7.4.
 *
 * These are the rules that keep the maintenance system honest, so they are
 * pinned here rather than trusted: an unsupported runtime must never read as
 * healthy, an unknown check must never read as healthy, and no major upgrade,
 * migration or permission change may ever be classified as automatic.
 */

import {
  buildMaintenanceReport,
  repairClassFor,
  summariseMaintenance,
  type AuditSummary,
  type MonitoredComponent,
} from '../src/lib/platform-reliability/dependency-monitor'

let passed = 0
let failed = 0

function ok(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1
  } else {
    failed += 1
    console.log(`  FAIL ${label}${detail ? ` (said: ${detail})` : ''}`)
  }
}

const CHECKED_AT = '2026-11-18T00:00:00.000Z'

const node = (over: Partial<MonitoredComponent> = {}): MonitoredComponent => ({
  name: 'node',
  installed: '24.22.2',
  latest: '24.22.3',
  eolOn: '2028-04-30',
  supported: true,
  ...over,
})

const cleanAudit: AuditSummary = { critical: 0, high: 0, moderate: 0, low: 0 }

// ── repair classification ───────────────────────────────────────────────────
console.log('── repair classification ──')
ok('a patch update on the same line may be automatic', repairClassFor('16.4.6', '16.4.7') === 'automatic')
ok('a minor update needs approval', repairClassFor('16.4.6', '16.5.0') === 'approval')
ok('a major upgrade needs approval', repairClassFor('16.4.6', '17.0.0') === 'approval')
ok('an unknown target is manual', repairClassFor('16.4.6', null) === 'manual')
ok('an empty target is manual', repairClassFor('16.4.6', '') === 'manual')
ok('a v-prefixed runtime version is compared correctly', repairClassFor('v24.22.2', 'v24.22.3') === 'automatic')
ok('no major bump is ever automatic', !['15.0.0', '17.0.0', '20.0.0'].some((v) => repairClassFor('16.4.6', v) === 'automatic'))

// ── runtime support ─────────────────────────────────────────────────────────
console.log('── runtime support ──')
const supported = buildMaintenanceReport({ components: [node()], audit: cleanAudit, checkedAt: CHECKED_AT })
ok('a supported runtime is healthy', supported.findings[0].state === 'healthy')
ok('a healthy report is all clear', supported.allClear)

const eol = buildMaintenanceReport({
  components: [node({ installed: '20.20.2', latest: '24.22.3', eolOn: '2026-04-30', supported: false })],
  audit: cleanAudit,
  checkedAt: CHECKED_AT,
})
const eolFinding = eol.findings[0]
ok('an end-of-life runtime is action required', eolFinding.state === 'action-required')
ok('it is not classified as an automatic repair', eolFinding.repair === 'approval')
ok('it says how long ago support ended', /ended \d+ days? ago/.test(eolFinding.headline), eolFinding.headline)
ok('the overall state follows the worst finding', eol.overall === 'action-required')
ok('an end-of-life runtime is never all clear', !eol.allClear)

const future = buildMaintenanceReport({
  components: [node({ eolOn: '2026-12-01', supported: false })],
  audit: cleanAudit,
  checkedAt: CHECKED_AT,
})
ok('a future end date is reported in days remaining', /Support ends in \d+ days?\./.test(future.findings[0].headline), future.findings[0].headline)

// ── unknown support is not healthy ──────────────────────────────────────────
console.log('── unknown support ──')
const unknown = buildMaintenanceReport({ components: [node({ supported: null })], audit: cleanAudit, checkedAt: CHECKED_AT })
ok('an uncheckable component is not-configured', unknown.findings[0].state === 'not-configured')
ok('it never reads as healthy', unknown.findings[0].state !== 'healthy')
ok('it is never all clear', !unknown.allClear)
ok('the summary refuses to call it clean', /not a clean bill of health/i.test(summariseMaintenance(unknown)), summariseMaintenance(unknown))

// ── major behind ────────────────────────────────────────────────────────────
console.log('── versions behind ──')
const behind = buildMaintenanceReport({
  components: [node({ installed: '24.22.2', latest: '26.13.1', supported: true })],
  audit: cleanAudit,
  checkedAt: CHECKED_AT,
})
ok('a newer major line is needs-attention, not action-required', behind.findings[0].state === 'needs-attention')
ok('a newer major line needs approval', behind.findings[0].repair === 'approval')

// ── vulnerabilities ─────────────────────────────────────────────────────────
console.log('── vulnerabilities ──')
const vulnerable = buildMaintenanceReport({
  components: [node()],
  audit: { critical: 1, high: 2, moderate: 5, low: 0 },
  checkedAt: CHECKED_AT,
})
const vulnFinding = vulnerable.findings.find((f) => f.id === 'audit:vulnerable')!
ok('high and critical counts are added together', /^3 known security problems/.test(vulnFinding.headline), vulnFinding.headline)
ok('vulnerabilities are action required', vulnFinding.state === 'action-required')
ok('vulnerabilities need approval, not silent patching', vulnFinding.repair === 'approval')
ok('the wording never claims an attack happened', !/(has|have) been attacked|was breached|is compromised|were exposed/i.test(vulnFinding.impact), vulnFinding.impact)
ok('it says explicitly that this is not proof of an attack', /(none is proof|not proof)/i.test(vulnFinding.impact))

const moderateOnly = buildMaintenanceReport({
  components: [node()],
  audit: { critical: 0, high: 0, moderate: 4, low: 9 },
  checkedAt: CHECKED_AT,
})
const moderateFinding = moderateOnly.findings.find((f) => f.id === 'audit:moderate')!
ok('moderate only is needs-attention', moderateFinding.state === 'needs-attention')
ok('moderate only is not action required', moderateOnly.overall !== 'action-required')

const noAudit = buildMaintenanceReport({ components: [node()], audit: null, checkedAt: CHECKED_AT })
ok('a check that did not run is not-configured', noAudit.findings.find((f) => f.id === 'audit:unavailable')!.state === 'not-configured')
ok('a check that did not run is never all clear', !noAudit.allClear)

// ── summary language ────────────────────────────────────────────────────────
console.log('── summary language ──')
ok('a clean report says nothing needs the owner', /Nothing needs you/.test(summariseMaintenance(supported)))
ok('action required reassures that the shop still works', /shop keeps working/i.test(summariseMaintenance(vulnerable)))
ok('needs-attention says nothing is broken', /Nothing is broken/i.test(summariseMaintenance(moderateOnly)))
ok('no summary uses jargon', !/repo|npm|CVE|semver|patch-level/i.test(summariseMaintenance(vulnerable)))

// ── counts and ordering ─────────────────────────────────────────────────────
console.log('── counts ──')
const mixed = buildMaintenanceReport({
  components: [node(), node({ name: 'next', installed: '15.0.0', latest: '16.4.6', supported: true })],
  audit: cleanAudit,
  checkedAt: CHECKED_AT,
})
ok('counts add up to the number of findings', Object.values(mixed.counts).reduce((a, b) => a + b, 0) === mixed.findings.length)
ok('the overall state is the most serious one present', mixed.overall === 'needs-attention')

console.log(`\nDependency monitor: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

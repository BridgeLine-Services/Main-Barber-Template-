import {
  buildFactoryLaunchReport,
  buildDeploymentPreflight,
  deriveLaunchStage,
  evaluateDomainReadiness,
  getNextFactoryAction,
  type LaunchCheck,
} from '../src/lib/factory-launch'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const check = (key: string, status: LaunchCheck['status'], category = 'Environment'): LaunchCheck => ({
  key, category, label: key, status, required: status !== 'DISABLED', secret: false,
  detail: status, remediation: `Fix ${key}`,
})

assert(getNextFactoryAction([check('database', 'BLOCKED')]).key === 'database', 'next action prioritizes blocking work')
assert(getNextFactoryAction([check('domain', 'MANUAL', 'Domain')]).key === 'domain', 'next action identifies manual domain work')
assert(deriveLaunchStage([check('database', 'BLOCKED')]) === 'DEPLOYMENT_PREFLIGHT', 'blocked environment derives preflight stage')
assert(deriveLaunchStage([check('domain', 'MANUAL', 'Domain')]) === 'FINAL_REVIEW', 'manual work derives final review stage')

const report = buildFactoryLaunchReport([
  check('database', 'PASS'),
  check('email', 'DISABLED', 'Integrations'),
  check('domain', 'MANUAL', 'Domain'),
  // Mirrors the static 'migrations' check composed by verifyFactoryLaunch —
  // runtime migration status is intentionally never auto-detected.
  check('migrations', 'MANUAL', 'Database'),
])
assert(report.overall === 'MANUAL_REVIEW', 'manual review is distinct from ready')
assert(report.counts.passed === 1 && report.counts.manual === 2 && report.counts.warnings === 0, 'launch counts distinguish pass, manual, and warnings')
assert(report.checks.every((item) => !item.detail.includes('postgresql://')), 'launch metadata does not expose connection strings')
assert(report.checks.some((item) => item.key === 'migrations' && item.status === 'MANUAL'), 'migration status stays manual when runtime detection is unavailable')
assert(evaluateDomainReadiness().some((item) => item.key === 'domain-ownership' && item.status === 'MANUAL'), 'domain ownership remains a human verification step')
assert(buildDeploymentPreflight().every((item) => !item.detail.match(/secret|token|password|postgresql:\/\//i)), 'environment preflight does not expose secret values')

console.log(`\nFactory launch tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

import { executePolicyBoundRepair, type RepairExecutionAdapter } from '../src/lib/platform-reliability/repair-executor'
import type { RepairIntent } from '../src/lib/platform-reliability/repair-policy'

let passed = 0
let failed = 0
function ok(condition: boolean, message: string) {
  if (condition) passed++
  else { failed++; console.error(`FAIL ${message}`) }
}

function makeRequest(intent: RepairIntent, overrides: Partial<import('../src/lib/platform-reliability/repair-executor').RepairExecutionRequest> = {}) {
  return {
    intent,
    requestedBy: 'owner-1',
    proposedChange: 'Apply the reviewed dependency/database change on an isolated branch.',
    requiredTests: ['npm run typecheck', 'npm run test:ci'],
    ...overrides,
  }
}

function adapter(overrides: Partial<RepairExecutionAdapter> = {}) {
  const calls: string[] = []
  const base: RepairExecutionAdapter = {
    recordProposal: async () => { calls.push('proposal'); return true },
    runReadOnlyCheck: async () => { calls.push('check'); return true },
    ensureVerifiedBackup: async () => { calls.push('backup'); return true },
    verifyIsolation: async () => { calls.push('isolation'); return true },
    applyInIsolation: async () => { calls.push('apply'); return { rollbackInstructions: 'restore previous snapshot' } },
    runRequiredTests: async () => { calls.push('tests'); return true },
    rollback: async () => { calls.push('rollback'); return true },
    record: async () => { calls.push('record') },
  }
  return { service: { ...base, ...overrides }, calls }
}

async function main() {
  const readOnly: RepairIntent = { key: 'health-check', component: 'website', description: 'Check service health.' }
  const automatic = adapter()
  const autoResult = await executePolicyBoundRepair(makeRequest(readOnly), automatic.service)
  ok(autoResult.state === 'succeeded', 'policy-approved read-only check runs')
  ok(!automatic.calls.includes('apply'), 'read-only checks do not run a mutation adapter')

  const unsafe: RepairIntent = { key: 'dependency-upgrade', component: 'auth', description: 'Respond to possible credential theft.', involvesSecurityIncident: true }
  const specialist = adapter()
  const specialistResult = await executePolicyBoundRepair(makeRequest(unsafe, { approvedBy: 'owner-2' }), specialist.service)
  ok(specialistResult.state === 'refused', 'specialist-only incidents are refused')
  ok(!specialist.calls.includes('proposal') && !specialist.calls.includes('apply'), 'specialist incidents never reach execution')

  const migration: RepairIntent = { key: 'database-migration', component: 'database', description: 'Apply a reviewed migration.', changesSchema: true }
  const missingApproval = adapter()
  const noApproval = await executePolicyBoundRepair(makeRequest(migration), missingApproval.service)
  ok(noApproval.state === 'refused', 'missing approval blocks the repair')
  ok(!missingApproval.calls.includes('backup'), 'approval is checked before backup work')

  const missingChange = adapter()
  const missingChangeResult = await executePolicyBoundRepair(makeRequest(migration, { proposedChange: ' ', approvedBy: 'owner-2', secondApprover: 'owner-3' }), missingChange.service)
  ok(missingChangeResult.state === 'refused', 'an unspecified exact change is refused')
  ok(!missingChange.calls.includes('backup'), 'backup creation cannot begin before the exact change is recorded')

  const missingTests = adapter()
  const missingTestsResult = await executePolicyBoundRepair(makeRequest(migration, { requiredTests: [], approvedBy: 'owner-2', secondApprover: 'owner-3' }), missingTests.service)
  ok(missingTestsResult.state === 'refused', 'an approved repair without required tests is refused')

  const sameApprover = await executePolicyBoundRepair(makeRequest(migration, { approvedBy: 'owner-1', secondApprover: 'owner-2' }), adapter().service)
  ok(sameApprover.state === 'refused', 'requesters cannot approve their own change')
  const missingSecond = await executePolicyBoundRepair(makeRequest(migration, { approvedBy: 'owner-2' }), adapter().service)
  ok(missingSecond.state === 'refused', 'schema changes need a second independent approver')

  const noBackup = adapter({ ensureVerifiedBackup: async () => false })
  const backupResult = await executePolicyBoundRepair(makeRequest(migration, { approvedBy: 'owner-2', secondApprover: 'owner-3' }), noBackup.service)
  ok(backupResult.state === 'refused', 'unverified backup blocks a schema change')
  ok(!noBackup.calls.includes('apply'), 'change never starts without backup')

  const noIsolation = adapter({ verifyIsolation: async () => false })
  const isolationResult = await executePolicyBoundRepair(makeRequest(migration, { approvedBy: 'owner-2', secondApprover: 'owner-3' }), noIsolation.service)
  ok(isolationResult.state === 'refused', 'unverified isolation blocks execution')
  ok(!noIsolation.calls.includes('apply'), 'isolated operation is not called before isolation is verified')

  const failedTests = adapter({ runRequiredTests: async () => false })
  const failedResult = await executePolicyBoundRepair(makeRequest(migration, { approvedBy: 'owner-2', secondApprover: 'owner-3' }), failedTests.service)
  ok(failedResult.state === 'rolled-back', 'failed tests trigger rollback')
  ok(failedTests.calls.includes('rollback'), 'rollback is attempted after failed tests')

  const failedRollback = adapter({ runRequiredTests: async () => false, rollback: async () => false })
  const rollbackResult = await executePolicyBoundRepair(makeRequest(migration, { approvedBy: 'owner-2', secondApprover: 'owner-3' }), failedRollback.service)
  ok(rollbackResult.state === 'failed', 'unverified rollback is not reported as successful')

  const historyUnavailable = adapter({ recordProposal: async () => false })
  const historyResult = await executePolicyBoundRepair(makeRequest(migration, { approvedBy: 'owner-2', secondApprover: 'owner-3' }), historyUnavailable.service)
  ok(historyResult.state === 'refused', 'unavailable history blocks execution')
  ok(!historyUnavailable.calls.includes('apply'), 'no repair starts without a durable proposal record')

  console.log(`Repair executor: ${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}

main().catch((error) => { console.error(error); process.exit(1) })

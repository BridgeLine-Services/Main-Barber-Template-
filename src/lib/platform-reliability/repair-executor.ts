import { classifyRepair, repairGate, type RepairIntent, type RepairVerdict } from './repair-policy'

export interface RepairExecutionRequest {
  intent: RepairIntent
  requestedBy: string
  /** Exact version/configuration change being prepared; never inferred by the executor. */
  proposedChange: string
  /** Commands the owner has been told will run; an empty list blocks approved repairs. */
  requiredTests: string[]
  approvedBy?: string | null
  secondApprover?: string | null
}

export interface RepairExecutionResult {
  state: 'refused' | 'succeeded' | 'failed' | 'rolled-back'
  verdict: RepairVerdict
  message: string
  backupVerified: boolean
  isolated: boolean
  testsPassed: boolean | null
  rollbackAttempted: boolean
  rollbackInstructions?: string | null
}

/** The adapter owns the sandbox, backup verification, tests, rollback and durable audit write. */
export interface RepairExecutionAdapter {
  recordProposal(request: RepairExecutionRequest, verdict: RepairVerdict): Promise<boolean>
  runReadOnlyCheck(intent: RepairIntent): Promise<boolean>
  ensureVerifiedBackup(intent: RepairIntent): Promise<boolean>
  verifyIsolation(intent: RepairIntent): Promise<boolean>
  applyInIsolation(intent: RepairIntent, proposedChange: string): Promise<{ rollbackInstructions: string }>
  runRequiredTests(intent: RepairIntent, requiredTests: string[]): Promise<boolean>
  rollback(intent: RepairIntent, instructions: string): Promise<boolean>
  record(result: RepairExecutionResult): Promise<void>
}

function refusal(verdict: RepairVerdict, message: string): RepairExecutionResult {
  return {
    state: 'refused', verdict, message,
    backupVerified: false, isolated: false, testsPassed: null, rollbackAttempted: false,
  }
}

/**
 * Policy is evaluated before any adapter method can mutate state. Specialist incidents
 * never reach the adapter. Approval-class work requires independent approvers, a verified
 * backup when policy requires one, explicit isolation, passing tests, and rollback on failure.
 * This function has no deploy or merge capability.
 */
export async function executePolicyBoundRepair(
  request: RepairExecutionRequest,
  adapter: RepairExecutionAdapter,
): Promise<RepairExecutionResult> {
  const verdict = classifyRepair(request.intent)
  if (verdict.category === 'specialist') {
    const result = refusal(verdict, repairGate(verdict, false).message)
    await adapter.record(result)
    return result
  }

  const approver = request.approvedBy?.trim() || ''
  const requester = request.requestedBy.trim()
  if (verdict.category === 'approval' && (!request.proposedChange.trim() || request.requiredTests.length === 0 || request.requiredTests.some((test) => !test.trim()))) {
    const result = refusal(verdict, 'The exact proposed change and its required tests must be recorded before approval can be executed.')
    await adapter.record(result)
    return result
  }
  const secondApprover = request.secondApprover?.trim() || ''
  if (verdict.category === 'approval') {
    if (!requester || !approver || requester === approver) {
      const result = refusal(verdict, 'Owner approval by a second, named person is required. Nothing was changed.')
      await adapter.record(result)
      return result
    }
    if (verdict.requiresSecondApprover && (!secondApprover || secondApprover === requester || secondApprover === approver)) {
      const result = refusal(verdict, 'A second independent approver is required for this change. Nothing was changed.')
      await adapter.record(result)
      return result
    }
  }

  const gate = repairGate(verdict, verdict.category === 'automatic' || Boolean(approver))
  if (!gate.mayRun) {
    const result = refusal(verdict, gate.message)
    await adapter.record(result)
    return result
  }

  const proposalRecorded = await adapter.recordProposal(request, verdict).catch(() => false)
  if (!proposalRecorded) {
    const result = refusal(verdict, 'The repair could not be recorded before execution. Nothing was changed.')
    return result
  }

  if (verdict.category === 'automatic') {
    let passed = false
    try { passed = await adapter.runReadOnlyCheck(request.intent) } catch { passed = false }
    const result: RepairExecutionResult = {
      state: passed ? 'succeeded' : 'failed', verdict,
      message: passed ? 'The read-only check completed.' : 'The read-only check could not be completed.',
      backupVerified: false, isolated: true, testsPassed: passed, rollbackAttempted: false,
    }
    await adapter.record(result)
    return result
  }

  let backupVerified = false
  if (verdict.requiresBackup) {
    backupVerified = await adapter.ensureVerifiedBackup(request.intent).catch(() => false)
    if (!backupVerified) {
      const result = refusal(verdict, 'A usable backup could not be verified. The repair was not started.')
      await adapter.record(result)
      return result
    }
  }

  const isolated = await adapter.verifyIsolation(request.intent).catch(() => false)
  if (!isolated) {
    const result = refusal(verdict, 'The executor could not verify an isolated environment. It refused to start the repair.')
    await adapter.record(result)
    return result
  }

  let application: { rollbackInstructions: string }
  try {
    application = await adapter.applyInIsolation(request.intent, request.proposedChange)
  } catch {
    const result: RepairExecutionResult = {
      state: 'failed', verdict, message: 'The isolated repair could not be prepared. No deployment was attempted.',
      backupVerified, isolated: false, testsPassed: null, rollbackAttempted: false,
    }
    await adapter.record(result)
    return result
  }
  let testsPassed = false
  try {
    testsPassed = await adapter.runRequiredTests(request.intent, request.requiredTests)
  } catch {
    testsPassed = false
  }
  if (!testsPassed) {
    let rolledBack = false
    try {
      rolledBack = await adapter.rollback(request.intent, application.rollbackInstructions)
    } catch {
      rolledBack = false
    }
    const result: RepairExecutionResult = {
      state: rolledBack ? 'rolled-back' : 'failed', verdict,
      message: rolledBack
        ? 'Required tests failed; the isolated change was rolled back. Nothing was deployed.'
        : 'Required tests failed and rollback could not be verified. Stop and contact a specialist.',
      backupVerified, isolated: true, testsPassed: false, rollbackAttempted: true,
      rollbackInstructions: application.rollbackInstructions,
    }
    await adapter.record(result)
    return result
  }

  const result: RepairExecutionResult = {
    state: 'succeeded', verdict,
    message: 'The isolated change passed its required tests. It has not been merged or deployed; review and approve the release separately.',
    backupVerified, isolated: true, testsPassed: true, rollbackAttempted: false,
    rollbackInstructions: application.rollbackInstructions,
  }
  await adapter.record(result)
  return result
}

/**
 * Maintenance history (Part 5.3), implemented as domain logic that is ready to switch on.
 *
 * The directive asks for a record of what was detected, what was recommended, whether it
 * was automatic or approval-required, who approved it, what changed, whether tests passed,
 * whether deployment succeeded and whether a rollback happened — and it forbids recording
 * passwords, tokens, API keys or secret environment values.
 *
 * It also forbids creating a migration without approval, so nothing here writes to the
 * database and no table exists yet. What is real today is the part that is hard to get
 * right later: the state machine, the two-party approval rule, and the redaction that makes
 * it impossible to store a secret by accident. When the owner approves the small additive
 * table in docs/PROPOSED-MAINTENANCE-HISTORY-MIGRATION.md, a store implementation plugs in
 * underneath and none of these rules have to be revisited.
 *
 * This module deliberately imports nothing from prisma. A test asserts that.
 */

import type { RepairClass } from './dependency-monitor'

export type ApprovalState = 'proposed' | 'approved' | 'rejected'
export type ExecutionState = 'not-started' | 'running' | 'succeeded' | 'failed' | 'rolled-back'

export interface MaintenanceRecord {
  /** Stable identifier for the kind of repair, e.g. "node-major-upgrade". */
  actionKey: string
  component: string
  repairClass: RepairClass
  approvalState: ApprovalState
  executionState: ExecutionState
  /** What it was before. Already redacted. */
  previousValue?: string | null
  /** What it would become. Already redacted. */
  proposedValue?: string | null
  requestedBy?: string | null
  approvedBy?: string | null
  /** One sentence the owner can read. Already redacted. */
  result?: string | null
  /** How to undo it, if the platform knows. */
  rollbackRef?: string | null
  proposedAt?: string | null
  approvedAt?: string | null
  startedAt?: string | null
  completedAt?: string | null
  testsPassed?: boolean | null
  deploymentSucceeded?: boolean | null
}

export interface HistoryAvailability {
  enabled: boolean
  /** Plain English, shown on the page when it is not enabled. */
  reason: string
}

/**
 * History is not enabled. It needs one additive table, and the directive requires the owner
 * to approve that before it is created. Saying so is the honest state, not a placeholder.
 */
export function historyAvailability(options?: { tableReady?: boolean }): HistoryAvailability {
  if (options?.tableReady) {
    return {
      enabled: true,
      reason:
        'Every repair is recorded here: what was found, what was recommended, who approved it, what changed, ' +
        'whether the checks passed, and whether it was undone. Secrets and customer details are never recorded.',
    }
  }
  return {
    enabled: false,
    reason:
      'Maintenance history is designed and ready but is not switched on for this installation yet. ' +
      'It needs one small addition to your database that only adds a new record of repairs; it does not change ' +
      'anything you already have. Your approval is needed before that is created.',
  }
}

// ─── Redaction: a secret must never reach a history record ──────────────────

const SECRET_KEY = /(password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|authorization|cookie|session)/i
/** A long unbroken run of base64/hex characters, the shape of a key. */
const SECRET_SHAPE = /\b[A-Za-z0-9_\-+/=]{24,}\b/
/** A connection string with an embedded user and password. */
const CONNECTION_STRING = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/i
const REMOVED = '[removed]'

/**
 * Returns a value that is safe to store. Over-redaction is acceptable here; a stored secret
 * is not. Anything shaped like a key, anything under a secret-sounding name, and any URL
 * carrying credentials is replaced rather than trimmed.
 */
export function redactForHistory(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = typeof value === 'string' ? value : safeStringify(value)
  if (text.trim() === '') return null
  if (CONNECTION_STRING.test(text)) return REMOVED
  if (SECRET_SHAPE.test(text)) return REMOVED
  return text
}

/** Redacts a `name: value` pair when the name itself is secret-sounding. */
export function redactNamedValue(name: string, value: unknown): string | null {
  if (SECRET_KEY.test(name)) return REMOVED
  return redactForHistory(value)
}

/** Builds a record with every free-text field passed through redaction. */
export function createRecord(input: {
  actionKey: string
  component: string
  repairClass: RepairClass
  previousValue?: unknown
  proposedValue?: unknown
  requestedBy?: string | null
  result?: string | null
  rollbackRef?: string | null
  at?: string
}): MaintenanceRecord {
  const at = input.at ?? new Date().toISOString()
  return {
    actionKey: input.actionKey,
    component: input.component,
    repairClass: input.repairClass,
    approvalState: input.repairClass === 'automatic' ? 'approved' : 'proposed',
    executionState: 'not-started',
    previousValue: redactNamedValue('previousValue', input.previousValue),
    proposedValue: redactNamedValue('proposedValue', input.proposedValue),
    requestedBy: input.requestedBy ?? null,
    approvedBy: null,
    result: redactForHistory(input.result),
    rollbackRef: redactForHistory(input.rollbackRef),
    proposedAt: at,
    approvedAt: input.repairClass === 'automatic' ? at : null,
    startedAt: null,
    completedAt: null,
    testsPassed: null,
    deploymentSucceeded: null,
  }
}

// ─── The state machine ─────────────────────────────────────────────────────

export interface TransitionResult {
  ok: boolean
  record?: MaintenanceRecord
  /** Why it was refused, in plain English, when ok is false. */
  reason?: string
}

const ALLOWED: Record<ExecutionState, ExecutionState[]> = {
  'not-started': ['running', 'succeeded', 'failed'],
  running: ['succeeded', 'failed'],
  succeeded: ['rolled-back'],
  failed: ['rolled-back', 'running'],
  'rolled-back': [],
}

/**
 * Records an approval decision. The person approving must not be the person who asked, for
 * anything that touches the running system: a change that needs approval needs a second pair
 * of eyes, and an owner clicking "approve" on their own request is not that.
 *
 * Category C (manual specialist) can never be approved for automatic execution here; it can
 * only be marked as handed to a specialist, because the platform must not pretend it can fix
 * a suspected data breach or a failed restore.
 */
export function decide(
  record: MaintenanceRecord,
  decision: 'approved' | 'rejected',
  actor: string,
  at = new Date().toISOString()
): TransitionResult {
  if (!actor.trim()) return { ok: false, reason: 'We need to know who made this decision.' }
  if (record.repairClass === 'manual') {
    return {
      ok: false,
      reason:
        'This one needs a specialist. The platform will not approve it for itself, because getting it wrong could ' +
        'affect customer records or payments.',
    }
  }
  if (record.approvalState !== 'proposed') {
    return { ok: false, reason: 'This has already been decided.' }
  }
  if (decision === 'approved' && record.requestedBy && record.requestedBy === actor) {
    return {
      ok: false,
      reason: 'A change that needs approval has to be approved by someone else, so one person cannot approve their own.',
    }
  }
  return {
    ok: true,
    record: {
      ...record,
      approvalState: decision,
      approvedBy: decision === 'approved' ? actor : null,
      approvedAt: at,
      executionState: decision === 'rejected' ? 'not-started' : record.executionState,
    },
  }
}

/** Moves a record along its execution path, refusing anything the rules do not allow. */
export function transition(
  record: MaintenanceRecord,
  to: ExecutionState,
  at = new Date().toISOString()
): TransitionResult {
  if (record.repairClass === 'manual' && (to === 'running' || to === 'succeeded')) {
    return { ok: false, reason: 'A specialist handles this one; the platform does not run it.' }
  }
  if (record.repairClass === 'approval' && record.approvalState !== 'approved') {
    return { ok: false, reason: 'This still needs approval before anything is changed.' }
  }
  if (!ALLOWED[record.executionState].includes(to)) {
    return { ok: false, reason: `A repair that is ${record.executionState.replace('-', ' ')} cannot become ${to.replace('-', ' ')}.` }
  }
  return {
    ok: true,
    record: {
      ...record,
      executionState: to,
      startedAt: to === 'running' ? at : record.startedAt,
      completedAt: to === 'succeeded' || to === 'failed' || to === 'rolled-back' ? at : record.completedAt,
    },
  }
}

/**
 * Records the outcome of the checks that follow a change. A repair is not "done" because it
 * was applied: it is done when the tests passed and, where relevant, the deployment worked.
 */
export function recordOutcome(
  record: MaintenanceRecord,
  outcome: { testsPassed?: boolean | null; deploymentSucceeded?: boolean | null; result?: string | null }
): MaintenanceRecord {
  return {
    ...record,
    testsPassed: outcome.testsPassed ?? record.testsPassed ?? null,
    deploymentSucceeded: outcome.deploymentSucceeded ?? record.deploymentSucceeded ?? null,
    result: outcome.result === undefined ? record.result : redactForHistory(outcome.result),
  }
}

/** True only when the work is genuinely finished and safe to describe as done. */
export function isComplete(record: MaintenanceRecord): boolean {
  if (record.executionState === 'rolled-back') return true
  return record.executionState === 'succeeded' && record.testsPassed === true && record.deploymentSucceeded !== false
}

// ─── Owner-facing wording ──────────────────────────────────────────────────

const CLASS_WORDS: Record<RepairClass, string> = {
  automatic: 'Handled automatically',
  approval: 'Needs your approval',
  manual: 'Needs a specialist',
}

const STATE_WORDS: Record<ExecutionState, string> = {
  'not-started': 'not started',
  running: 'in progress',
  succeeded: 'finished',
  failed: 'did not work',
  'rolled-back': 'undone',
}

/** One line an owner can read without knowing what any of the underlying parts are called. */
export function describeRecord(record: MaintenanceRecord): string {
  const what = record.component.replace(/\s+/g, ' ').trim()
  const decision =
    record.approvalState === 'proposed'
      ? 'waiting for a decision'
      : record.approvalState === 'rejected'
        ? 'you said no'
        : 'approved'

  if (record.repairClass === 'manual') {
    return `${what}: ${CLASS_WORDS.manual.toLowerCase()}. ${record.result ?? 'Nothing has been changed.'}`
  }

  const progress = STATE_WORDS[record.executionState]
  const tests =
    record.testsPassed === true ? ', checks passed' : record.testsPassed === false ? ', checks failed' : ''
  return `${what}: ${CLASS_WORDS[record.repairClass].toLowerCase()}, ${decision}, ${progress}${tests}.`
}

export interface HistorySummary {
  total: number
  awaitingDecision: number
  completed: number
  rolledBack: number
  sentence: string
}

export function summariseHistory(records: MaintenanceRecord[]): HistorySummary {
  const awaitingDecision = records.filter((r) => r.approvalState === 'proposed' && r.repairClass !== 'manual').length
  const completed = records.filter(isComplete).length
  const rolledBack = records.filter((r) => r.executionState === 'rolled-back').length

  if (records.length === 0) {
    return {
      total: 0,
      awaitingDecision: 0,
      completed: 0,
      rolledBack: 0,
      sentence: 'Nothing has needed repairing yet, so there is nothing to show here.',
    }
  }

  const parts = [`${records.length} ${records.length === 1 ? 'repair' : 'repairs'} recorded`]
  if (awaitingDecision > 0) parts.push(`${awaitingDecision} waiting for your decision`)
  if (completed > 0) parts.push(`${completed} finished`)
  if (rolledBack > 0) parts.push(`${rolledBack} undone`)
  return { total: records.length, awaitingDecision, completed, rolledBack, sentence: parts.join(', ') + '.' }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

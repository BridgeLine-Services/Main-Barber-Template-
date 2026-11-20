/**
 * Repair automation (Priority 1, part E).
 *
 * Three categories govern every repair, and this module is the only place that decides
 * which one applies. It errs toward stopping: any sign of a security incident, a failed
 * restore, a payment mismatch, corrupted records or a tenant-isolation failure moves the
 * repair to "specialist required" and turns automation off, because a repair that guesses
 * in those situations destroys evidence and can make the damage worse.
 *
 * Every verdict carries the five things the directive requires an owner to be told:
 * what it does, what it changes, who may authorise it, whether it can be undone, and what
 * happens if it goes wrong.
 */

export type RepairCategory = 'automatic' | 'approval' | 'specialist'

export interface RepairIntent {
  /** Stable key, e.g. "dependency-upgrade". */
  key: string
  component: string
  /** One sentence, owner-facing. */
  description: string
  touchesCustomerData?: boolean
  touchesProductionConfig?: boolean
  changesSchema?: boolean
  destructive?: boolean
  involvesSecurityIncident?: boolean
  involvesFailedRestore?: boolean
  involvesPaymentReconciliation?: boolean
  involvesCorruptedRecords?: boolean
  involvesTenantIsolation?: boolean
}

export interface RepairExplanation {
  whatItDoes: string
  whatChanges: string
  whoMayApprove: string
  canBeUndone: string
  ifSomethingGoesWrong: string
}

export interface RepairVerdict {
  key: string
  component: string
  category: RepairCategory
  /** True only for category A. */
  mayRunAutomatically: boolean
  requiresApproval: boolean
  requiresSecondApprover: boolean
  requiresBackup: boolean
  requiresTests: boolean
  /** True when the platform must stop and keep the evidence intact. */
  stopAutomation: boolean
  preserveEvidence: boolean
  reasons: string[]
  steps: string[]
  explanation: RepairExplanation
}

/** Operations that are safe to run with no human in the loop. */
export const AUTOMATIC_OPERATIONS = new Set([
  'dependency-check',
  'compatibility-check',
  'environment-validation',
  'health-check',
  'maintenance-report',
  'unsupported-software-detection',
  'backup-verification-read',
])

/** Operations that always need a person to say yes. */
export const APPROVAL_OPERATIONS = new Set([
  'dependency-upgrade',
  'node-major-upgrade',
  'security-configuration-change',
  'database-migration',
  'production-configuration-change',
  'framework-major-upgrade',
  'runtime-upgrade',
])

const SPECIALIST_TRIGGERS: Array<{ flag: keyof RepairIntent; reason: string }> = [
  { flag: 'involvesSecurityIncident', reason: 'A suspected security incident is involved.' },
  { flag: 'involvesFailedRestore', reason: 'A database restore has already failed once.' },
  { flag: 'involvesPaymentReconciliation', reason: 'Payments do not reconcile, so money may be wrong.' },
  { flag: 'involvesCorruptedRecords', reason: 'Business records appear corrupted.' },
  { flag: 'involvesTenantIsolation', reason: 'Tenant isolation may have failed, so one shop may see another.' },
]

function explain(intent: RepairIntent, category: RepairCategory): RepairExplanation {
  const undoable = category === 'automatic' || intent.changesSchema || intent.destructive
    ? 'Not always. Take a backup first so the change can be reversed.'
    : 'Yes, by reverting the change and restoring the previous setting.'
  return {
    whatItDoes: intent.description,
    whatChanges:
      category === 'automatic'
        ? 'Nothing is changed. This only reads and reports.'
        : [
            intent.changesSchema ? 'the structure of your database' : null,
            intent.touchesProductionConfig ? 'the settings your live site runs with' : null,
            intent.touchesCustomerData ? 'customer or appointment records' : null,
          ].filter(Boolean).join(', ') || 'the software version only',
    whoMayApprove:
      category === 'specialist'
        ? 'A qualified specialist, together with the owner.'
        : category === 'approval'
          ? 'The owner, or a co-owner the owner has authorised. A second person must confirm any database or production change.'
          : 'No approval needed: this is a read-only check.',
    canBeUndone: category === 'specialist' ? 'Only with specialist help. Do not attempt it unaided.' : undoable,
    ifSomethingGoesWrong:
      category === 'specialist'
        ? 'Automation is stopped and the evidence is kept. Contact a qualified specialist or your support provider before doing anything else.'
        : category === 'approval'
          ? 'The change is not deployed. The prepared change, its tests and its rollback stay available for review.'
          : 'Nothing is affected, because nothing is written.',
  }
}

export function classifyRepair(intent: RepairIntent): RepairVerdict {
  const reasons: string[] = []
  const specialist = SPECIALIST_TRIGGERS.filter((t) => Boolean(intent[t.flag]))
  if (specialist.length > 0) {
    for (const trigger of specialist) reasons.push(trigger.reason)
    return {
      key: intent.key,
      component: intent.component,
      category: 'specialist',
      mayRunAutomatically: false,
      requiresApproval: true,
      requiresSecondApprover: true,
      requiresBackup: false,
      requiresTests: false,
      stopAutomation: true,
      preserveEvidence: true,
      reasons,
      steps: [
        'Stop automated repair for this component.',
        'Keep logs, database snapshots and the exact state of the records involved.',
        'Do not retry the repair or delete anything.',
        'Contact a qualified specialist and give them this record.',
      ],
      explanation: explain(intent, 'specialist'),
    }
  }

  const isAutomatic = AUTOMATIC_OPERATIONS.has(intent.key)
  const isApproval = APPROVAL_OPERATIONS.has(intent.key)

  if (isAutomatic && !intent.touchesCustomerData && !intent.touchesProductionConfig && !intent.changesSchema && !intent.destructive) {
    reasons.push('This is a read-only check from the automatic list.')
    return {
      key: intent.key,
      component: intent.component,
      category: 'automatic',
      mayRunAutomatically: true,
      requiresApproval: false,
      requiresSecondApprover: false,
      requiresBackup: false,
      requiresTests: false,
      stopAutomation: false,
      preserveEvidence: false,
      reasons,
      steps: ['Run the check.', 'Record the result in the maintenance history.', 'Take no other action.'],
      explanation: explain(intent, 'automatic'),
    }
  }

  // Anything that writes, or any key that is not on the automatic list, needs approval.
  if (intent.touchesCustomerData) reasons.push('Customer data would be changed.')
  if (intent.touchesProductionConfig) reasons.push('Live site settings would be changed.')
  if (intent.changesSchema) reasons.push('The database structure would change.')
  if (intent.destructive) reasons.push('The change removes something.')
  if (isApproval) reasons.push('This operation is on the approval-required list.')
  if (!isAutomatic && !isApproval) reasons.push('This operation is not on the automatic list, so it is treated as needing approval.')

  const requiresSecondApprover = Boolean(intent.changesSchema || intent.touchesProductionConfig || intent.destructive)

  return {
    key: intent.key,
    component: intent.component,
    category: 'approval',
    mayRunAutomatically: false,
    requiresApproval: true,
    requiresSecondApprover,
    requiresBackup: Boolean(intent.changesSchema || intent.touchesCustomerData || intent.destructive),
    requiresTests: true,
    stopAutomation: false,
    preserveEvidence: false,
    reasons,
    steps: [
      'Prepare the change on a branch.',
      intent.changesSchema || intent.touchesCustomerData || intent.destructive
        ? 'Take a database backup and verify it can be restored.'
        : 'Record the current version and configuration.',
      'Run the full test suite.',
      'Write the plain-English explanation and the rollback steps into the repair record.',
      requiresSecondApprover ? 'Ask the owner and a second authorised person to approve.' : 'Ask the owner to approve.',
      'Deploy only after approval, then verify the result.',
    ],
    explanation: explain(intent, 'approval'),
  }
}

export interface RepairGate {
  mayRun: boolean
  category: RepairCategory
  message: string
}

/**
 * The single gate a caller should consult before doing anything. A specialist case never
 * passes, and an approval case passes only when the caller states that approval exists.
 */
export function repairGate(verdict: RepairVerdict, approvalRecorded: boolean): RepairGate {
  if (verdict.category === 'specialist') {
    return { mayRun: false, category: 'specialist', message: 'Stopped: this needs a specialist. Automation will not continue.' }
  }
  if (verdict.category === 'approval' && !approvalRecorded) {
    return { mayRun: false, category: 'approval', message: 'Waiting for approval. Nothing has been changed.' }
  }
  return { mayRun: true, category: verdict.category, message: verdict.category === 'automatic' ? 'Safe to run: this only reads and reports.' : 'Approved. Run it, then verify the result.' }
}

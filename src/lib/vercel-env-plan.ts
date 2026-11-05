// ============================================================================
// Planning a Vercel environment sync, without touching Vercel.
//
// The wizard could only print `vercel env add NAME production` and hope. Planning is
// separable from doing, and the part that decides *what* is wrong — a variable absent,
// present only in the wrong environment, present but whitespace, or existing and must
// not be overwritten — is the part most worth testing. It lives here so it can be
// exercised without an account, a token, or a network call.
// ============================================================================

import type { EnvVarSpec } from './env-registry'

export type VercelTarget = 'production' | 'preview' | 'development'

/** What Vercel reports for one variable name. */
export interface RemoteVar {
  key: string
  /** Environments the variable is assigned to. Values are never fetched. */
  targets: VercelTarget[]
}

export type SyncAction =
  | { kind: 'ADD'; name: string; targets: VercelTarget[]; reason: string }
  | { kind: 'ADD_TARGET'; name: string; targets: VercelTarget[]; reason: string }
  | { kind: 'PRESERVE'; name: string; reason: string }
  | { kind: 'IGNORE'; name: string; reason: string }

export interface SyncPlan {
  actions: SyncAction[]
  /** Actions that need a value from the operator before they can run. */
  needsValue: string[]
  /** True when nothing would be written. */
  clean: boolean
}

export interface PlanInput {
  specs: EnvVarSpec[]
  remote: RemoteVar[]
  local: Record<string, string | undefined>
  /** Environments this deployment must cover. Production shops need both. */
  requiredTargets?: VercelTarget[]
  /**
   * Integrations the operator switched on for THIS deployment (email, sms, ...).
   * Their variables are required here even though the registry marks them
   * optional: a shop that has enabled SMS cannot be reported ready while its
   * Twilio values are still missing.
   */
  enabledFeatures?: string[]
}

const isPresent = (value: string | undefined): boolean => Boolean(value && value.trim())

/**
 * Production and Preview are both required for a shop: Preview is where a change is
 * proven before it reaches customers, and a Preview that cannot rate-limit or reach
 * its database proves nothing.
 */
export function planVercelSync(input: PlanInput): SyncPlan {
  const requiredTargets = input.requiredTargets ?? ['production', 'preview']
  const remoteByName = new Map(input.remote.map((r) => [r.key, r]))
  const actions: SyncAction[] = []
  const needsValue: string[] = []

  for (const spec of input.specs) {
    // Retired, platform-managed and internal/development variables are not a
    // customer deployment's business.
    if (spec.retired || spec.platformManaged) {
      actions.push({ kind: 'IGNORE', name: spec.name, reason: spec.retired ? 'retired' : 'platform-managed' })
      continue
    }
    if (spec.category === 'INTERNAL' || spec.category === 'DEVELOPMENT_ONLY') {
      actions.push({ kind: 'IGNORE', name: spec.name, reason: `${spec.category.toLowerCase()} variable` })
      continue
    }

    const requiredByTarget = spec.requiredIn.some((env) => requiredTargets.includes(env as VercelTarget))
    // A feature-gated variable becomes required when its feature is on. The
    // planner used to read only requiredIn, so enabling email or SMS in the
    // wizard left those variables classified as unnecessary and the shop could
    // be pronounced ready with dead notifications.
    const requiredByFeature = Boolean(spec.feature) && (input.enabledFeatures ?? []).includes(String(spec.feature))
    const wantsHere = requiredByTarget || requiredByFeature
    const remote = remoteByName.get(spec.name)

    if (!wantsHere) {
      actions.push({
        kind: remote ? 'PRESERVE' : 'IGNORE',
        name: spec.name,
        reason: remote ? 'present in Vercel but not required here; left untouched' : 'not required in these environments',
      })
      continue
    }

    if (!remote) {
      // Absent in Vercel. It can only be added if we have a value to add, and the
      // value must come from the operator's environment, never from a file we wrote.
      if (isPresent(input.local[spec.name])) {
        actions.push({
          kind: 'ADD',
          name: spec.name,
          targets: requiredTargets,
          reason: `missing from Vercel; a value is available locally${spec.secret ? ' (secret: never printed)' : ''}`,
        })
      } else {
        actions.push({ kind: 'ADD', name: spec.name, targets: requiredTargets, reason: 'missing from Vercel and no local value to add' })
        needsValue.push(spec.name)
      }
      continue
    }

    const missingTargets = requiredTargets.filter((t) => !remote.targets.includes(t))
    if (missingTargets.length > 0) {
      actions.push({
        kind: 'ADD_TARGET',
        name: spec.name,
        targets: missingTargets,
        reason: `already exists but not assigned to ${missingTargets.join(', ')}`,
      })
      if (!isPresent(input.local[spec.name])) needsValue.push(spec.name)
      continue
    }

    if (remote.targets.length > 0 && !isPresent(input.local[spec.name])) {
      // It exists remotely and we hold no value. Preserve: replacing a working
      // credential with nothing would be worse than leaving it alone.
      actions.push({ kind: 'PRESERVE', name: spec.name, reason: 'present in the required environments; no local value, so left untouched' })
      continue
    }

    actions.push({
      kind: 'PRESERVE',
      name: spec.name,
      reason: 'present in the required environments; existing value is never overwritten',
    })
  }

  const clean = !actions.some((a) => a.kind === 'ADD' || a.kind === 'ADD_TARGET')
  return { actions, needsValue, clean }
}

/** Human summary that never contains a value. */
export function describePlan(plan: SyncPlan): string[] {
  const lines: string[] = []
  for (const action of plan.actions) {
    if (action.kind === 'IGNORE') continue
    if (action.kind === 'PRESERVE') {
      lines.push(`  = ${action.name}  ${action.reason}`)
      continue
    }
    const targets = action.targets.join(' + ')
    const mark = action.kind === 'ADD' ? '+' : '~'
    lines.push(`  ${mark} ${action.name}  (${targets})  ${action.reason}`)
  }
  if (lines.length === 0) lines.push('  nothing to do')
  return lines
}


export interface DeployDecision {
  deploy: boolean
  reason: string
}

/**
 * Whether to run `vercel --prod` after a sync.
 *
 * This exists because the wizard wrote `if (redeploy && confirm('Deploy now?'))`.
 * confirm() returns a Promise, a Promise is always truthy, and so answering "No"
 * deployed anyway — the one thing a confirmation prompt must never do.
 */
export function shouldDeploy(input: {
  requested: boolean
  assumeYes: boolean
  confirmed: boolean
  checksPassed: boolean
}): DeployDecision {
  if (!input.requested) return { deploy: false, reason: 'Redeploy not requested.' }
  if (input.assumeYes) {
    return { deploy: false, reason: 'Redeploy needs an explicit answer, so --yes never deploys. Run without --yes to be asked.' }
  }
  if (!input.checksPassed) {
    return { deploy: false, reason: 'Not deploying: the environment still does not match. Fix that first, then redeploy.' }
  }
  if (!input.confirmed) return { deploy: false, reason: 'Redeploy declined.' }
  return { deploy: true, reason: 'Deploying.' }
}
